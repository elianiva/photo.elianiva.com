/**
 * The `SettingsService` that owns the singleton row: the export defaults a new
 * upload is seeded from, the watermark and metadata policy, and the retention
 * setting — the four things the photograph pipeline reads.
 *
 * The row holds no site copy. The Masthead, the lede, the Colophon and the
 * Folio nav are authored text in the Front's `content.ts`; a settings column
 * holding the same sentence was a second source for copy nobody could find, and
 * the public read no longer joins this table at all (migration 0008).
 */

import { Context, DateTime, Effect, Layer, Option, Schema as S } from 'effect'
import {
  InvalidInput,
  RenditionFormat,
  MatColour,
  Settings,
  SettingsInput,
  StorageError,
  WatermarkPosition,
  describeCause,
} from '@photo/shared'
import * as SqlClient from 'effect/sql/SqlClient'
import { firstRow } from './photo'

// ---------------------------------------------------------------------------
// the singleton row
// ---------------------------------------------------------------------------

/** Every column of the row, in one string so the read and the write cannot
 *  name different ones. The booleans are the 0/1 the INTEGER columns are
 *  declared with. */
const SETTINGS_COLUMNS =
  'updatedAt, defaultPreviewLongEdge, defaultPreviewFormat, defaultPreviewQuality, defaultFullQuality, watermarkEnabled, watermarkColour, watermarkPosition, defaultKeepExif, defaultRemoveGps, retainForever'

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
  readonly retainForever: number
}

/** What migration 0005 gives a row that was never written: the column defaults.
 *  The same tolerance the read has for a database the migration never reached. */
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
  retainForever: true,
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
  /** The whole singleton. A row that is not there answers with the column
   *  defaults rather than failing: the row is missing on a database the
   *  migration never reached, and a Settings page that cannot be drawn is a
   *  worse answer than a fresh one. */
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
    const sql = yield* SqlClient.SqlClient

    /** The single Settings row, or null when nothing has ever been saved. The
     *  defaults are the caller's answer for that, not a row inserted here. */
    const readRow = () =>
      Effect.mapError(
        sql<DbSettingsRow>`SELECT ${sql.literal(SETTINGS_COLUMNS)} FROM settings WHERE id = 1`,
        (cause) =>
          new StorageError({ message: 'Failed to read settings', cause: describeCause(cause) }),
      ).pipe(Effect.map(firstRow))

    const read: SettingsServiceContract['read'] = Effect.gen(function* () {
      const row = yield* readRow()
      if (row === null) return { ...DEFAULT_SETTINGS, updatedAt: null }
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
        retainForever: row.retainForever !== 0,
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
        yield* Effect.mapError(
          sql`UPDATE settings SET updatedAt = ${DateTime.formatIso(DateTime.nowUnsafe())},
                defaultPreviewLongEdge = ${validated.defaultPreviewLongEdge},
                defaultPreviewFormat = ${validated.defaultPreviewFormat},
                defaultPreviewQuality = ${validated.defaultPreviewQuality},
                defaultFullQuality = ${validated.defaultFullQuality},
                watermarkEnabled = ${validated.watermarkEnabled ? 1 : 0},
                watermarkColour = ${validated.watermarkColour},
                watermarkPosition = ${validated.watermarkPosition},
                defaultKeepExif = ${validated.defaultKeepExif ? 1 : 0},
                defaultRemoveGps = ${validated.defaultRemoveGps ? 1 : 0},
                retainForever = ${validated.retainForever ? 1 : 0}
              WHERE id = 1`.raw,
          (cause) =>
            new StorageError({ message: 'Failed to update settings', cause: describeCause(cause) }),
        )
        return yield* read
      })

    return SettingsService.of({ read, update })
  }),
)
