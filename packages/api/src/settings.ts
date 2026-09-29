/**
 * The `settings.sections` codec — the stored representation of the public Folio
 * nav (see CONTEXT.md) — and the read of the site copy the public site prints.
 * The schemas live in `@photo/shared` because they are wire shape; the JSON <->
 * array dance lives here for the same reason `encodeCursor` lives beside the
 * metadata parser: it is a persistence detail of the column, not part of the
 * contract.
 */

import { Effect, Schema as S } from 'effect'
import {
  InvalidInput,
  SiteSections,
  StorageError,
  describeCause,
  type SiteSection,
} from '@photo/shared'
import type { Gateway } from './gateway'

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
