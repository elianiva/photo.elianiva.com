/**
 * The `settings.sections` codec — the stored representation of the public Folio
 * nav (see CONTEXT.md) — the read of the site copy the public site prints, and
 * the `SettingsService` that owns the singleton row. The schemas live in
 * `@photo/shared` because they are wire shape; the JSON <-> array dance lives
 * here for the same reason `encodeCursor` lives beside the metadata parser: it
 * is a persistence detail of the column, not part of the contract.
 */

import { Context, DateTime, Effect, Layer, Option, Schema as S } from 'effect'
import {
  InvalidInput,
  RenditionFormat,
  MatColour,
  Settings,
  SettingsInput,
  SiteSections,
  StorageError,
  WatermarkPosition,
  describeCause,
  type SiteSection,
} from '@photo/shared'
import { Gateway } from './gateway'

/**
 * Decode the column. `null` is "never authored", which is an empty nav and not
 * an error; anything present that is not a sections array is a failure, so a
 * corrupted row surfaces instead of quietly publishing a nav with no links.
 */
export const decodeSections = (
  raw: string | null,
): Effect.Effect<ReadonlyArray<SiteSection>, InvalidInput> => {
  if (raw === null) return Effect.succeed([])
  return Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(raw),
      catch: () => new InvalidInput({ message: 'settings.sections is not valid JSON' }),
    })
    return yield* S.decodeUnknownEffect(SiteSections, { onExcessProperty: 'error' })(parsed).pipe(
      Effect.mapError(
        (error) =>
          new InvalidInput({
            message: `settings.sections is not a sections list: ${error.message}`,
          }),
      ),
    )
  })
}

/** Encode the nav for the column. */
export const encodeSections = (sections: ReadonlyArray<SiteSection>): string =>
  JSON.stringify(S.encodeSync(SiteSections)(sections))

/** The SITE copy the public Masthead, Folio nav and Colophon print. */
export interface SiteCopy {
  /** `VOL. V` — authored, not derived from a count. */
  readonly volume: string
  /** The Masthead's centred line. Null before it is written. */
  readonly motto: string | null
  /** The Colophon's About column. Null before it is written. */
  readonly aboutCopy: string | null
  /** The Folio nav, decoded. An empty nav is not an error. */
  readonly sections: ReadonlyArray<SiteSection>
}

/**
 * The Settings row's site half, as the public site reads it.
 *
 * Migration 0005 inserts the singleton, so a row that is missing is a database
 * that was never migrated rather than a Photo problem; the volume falls back
 * to the column default and the nullable copy to null, and the nav to empty.
 * The sections column is the one that is decoded rather than defaulted: a
 * corrupt nav surfaces as an InvalidInput instead of quietly publishing a
 * Folio with no links.
 */
export const readSiteCopy = (
  db: (typeof Gateway.Service)['db'],
): Effect.Effect<SiteCopy, StorageError | InvalidInput> =>
  Effect.gen(function* () {
    const found = yield* Effect.tryPromise({
      try: () =>
        db.prepare(`SELECT volume, motto, aboutCopy, sections FROM settings WHERE id = 1`).first<{
          volume: string
          motto: string | null
          aboutCopy: string | null
          sections: string | null
        }>(),
      catch: (cause) =>
        new StorageError({ message: 'Failed to read the site copy', cause: describeCause(cause) }),
    })
    const sections = yield* decodeSections(found?.sections ?? null)
    return {
      volume: found?.volume ?? 'V',
      motto: found?.motto ?? null,
      aboutCopy: found?.aboutCopy ?? null,
      sections,
    }
  })

// ---------------------------------------------------------------------------
// the singleton row
// ---------------------------------------------------------------------------

/** Every column of the row, in one string so the read and the write cannot
 *  name different ones. The booleans are the 0/1 the INTEGER columns are
 *  declared with, and the two nullable columns are the nullable ones. */
const SETTINGS_COLUMNS =
  'updatedAt, defaultPreviewLongEdge, defaultPreviewFormat, defaultPreviewQuality, defaultFullQuality, watermarkEnabled, watermarkColour, watermarkPosition, defaultKeepExif, defaultRemoveGps, copyright, retainForever, volume, motto, aboutCopy, sections'

interface DbSettingsRow {
  readonly updatedAt: string
  readonly defaultPreviewLongEdge: number
  readonly defaultPreviewFormat: string
  readonly defaultPreviewQuality: number
  readonly defaultFullQuality: number
  readonly watermarkEnabled: number
  readonly watermarkColour: string
  readonly watermarkPosition: string
  readonly defaultKeepExif: number
  readonly defaultRemoveGps: number
  readonly copyright: string | null
  readonly retainForever: number
  readonly volume: string
  readonly motto: string | null
  readonly aboutCopy: string | null
  readonly sections: string | null
}

/** What migration 0005 gives a row that was never written: the column defaults,
 *  no copy, an empty nav. The same tolerance `readSiteCopy` has for a
 *  database the migration never reached. */
const DEFAULT_SETTINGS: SettingsInput = {
  defaultPreviewLongEdge: 1200,
  defaultPreviewFormat: 'avif',
  defaultPreviewQuality: 82,
  defaultFullQuality: 92,
  watermarkEnabled: false,
  watermarkColour: 'white',
  watermarkPosition: 'bottom-right',
  defaultKeepExif: true,
  defaultRemoveGps: true,
  copyright: null,
  retainForever: true,
  volume: 'V',
  motto: null,
  aboutCopy: null,
  sections: [],
}

/** The three TEXT columns the wire narrows to a literal union, and which carry
 *  no CHECK: a row another build wrote can hold a value the wire has no name
 *  for. The column default is the honest answer, and decoding strictly would
 *  make a whole Settings page unreadable over one column. */
const literalOr = <A extends string>(
  decode: (raw: unknown) => Option.Option<A>,
  raw: string,
  fallback: A,
): A => Option.getOrElse(decode(raw), () => fallback)

export interface SettingsServiceContract {
  /** The whole singleton, nav decoded. A row that is not there answers with
   *  the column defaults rather than failing: the row is missing on a database
   *  the migration never reached, and a Settings page that cannot be drawn is
   *  a worse answer than a fresh one. */
  readonly read: Effect.Effect<Settings, StorageError | InvalidInput>
  /** Write the whole row and read it back, so a save answers with the stored
   *  truth and never with the request. Every save stamps a new `updatedAt`,
   *  including one that changes nothing, because "saved" is a fact about the
   *  write. */
  readonly update: (input: SettingsInput) => Effect.Effect<Settings, InvalidInput | StorageError>
}

export class SettingsService extends Context.Service<SettingsService, SettingsServiceContract>()(
  'photo/SettingsService',
) {}

export const SettingsServiceLive = Layer.effect(
  SettingsService,
  Effect.gen(function* () {
    const gateway = yield* Gateway
    const db = gateway.db

    const readRow = () =>
      Effect.tryPromise({
        try: () =>
          db
            .prepare(`SELECT ${SETTINGS_COLUMNS} FROM settings WHERE id = 1`)
            .first<DbSettingsRow>(),
        catch: (cause) =>
          new StorageError({ message: 'Failed to read settings', cause: describeCause(cause) }),
      })

    const read: SettingsServiceContract['read'] = Effect.gen(function* () {
      const row = yield* readRow()
      const sections = yield* decodeSections(row?.sections ?? null)
      if (row === null) return { ...DEFAULT_SETTINGS, updatedAt: null, sections }
      return {
        updatedAt: row.updatedAt,
        defaultPreviewLongEdge: row.defaultPreviewLongEdge,
        defaultPreviewFormat: literalOr(
          S.decodeUnknownOption(RenditionFormat),
          row.defaultPreviewFormat,
          DEFAULT_SETTINGS.defaultPreviewFormat,
        ),
        defaultPreviewQuality: row.defaultPreviewQuality,
        defaultFullQuality: row.defaultFullQuality,
        watermarkEnabled: row.watermarkEnabled !== 0,
        watermarkColour: literalOr(
          S.decodeUnknownOption(MatColour),
          row.watermarkColour,
          DEFAULT_SETTINGS.watermarkColour,
        ),
        watermarkPosition: literalOr(
          S.decodeUnknownOption(WatermarkPosition),
          row.watermarkPosition,
          DEFAULT_SETTINGS.watermarkPosition,
        ),
        defaultKeepExif: row.defaultKeepExif !== 0,
        defaultRemoveGps: row.defaultRemoveGps !== 0,
        copyright: row.copyright,
        retainForever: row.retainForever !== 0,
        volume: row.volume,
        motto: row.motto,
        aboutCopy: row.aboutCopy,
        sections,
      }
    })

    const update: SettingsServiceContract['update'] = (input) =>
      Effect.gen(function* () {
        // The write is guarded by the wire schema rather than by SQLite: the
        // quality columns and the long edge carry no CHECK, and a long edge of
        // zero is a Rendition generator's divide by zero, not a preference.
        const validated = yield* S.decodeUnknownEffect(SettingsInput)(input).pipe(
          Effect.mapError((error) => new InvalidInput({ message: `settings: ${error.message}` })),
        )
        yield* Effect.tryPromise({
          try: () =>
            db
              .prepare(
                `UPDATE settings SET updatedAt = ?, defaultPreviewLongEdge = ?, defaultPreviewFormat = ?,
                    defaultPreviewQuality = ?, defaultFullQuality = ?, watermarkEnabled = ?,
                    watermarkColour = ?, watermarkPosition = ?, defaultKeepExif = ?, defaultRemoveGps = ?,
                    copyright = ?, retainForever = ?, volume = ?, motto = ?, aboutCopy = ?, sections = ?
                  WHERE id = 1`,
              )
              .bind(
                DateTime.formatIso(DateTime.nowUnsafe()),
                validated.defaultPreviewLongEdge,
                validated.defaultPreviewFormat,
                validated.defaultPreviewQuality,
                validated.defaultFullQuality,
                validated.watermarkEnabled ? 1 : 0,
                validated.watermarkColour,
                validated.watermarkPosition,
                validated.defaultKeepExif ? 1 : 0,
                validated.defaultRemoveGps ? 1 : 0,
                validated.copyright,
                validated.retainForever ? 1 : 0,
                validated.volume,
                validated.motto,
                validated.aboutCopy,
                encodeSections(validated.sections),
              )
              .run(),
          catch: (cause) =>
            new StorageError({ message: 'Failed to update settings', cause: describeCause(cause) }),
        })
        return yield* read
      })

    return SettingsService.of({ read, update })
  }),
)
