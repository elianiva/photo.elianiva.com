/**
 * The `settings.sections` codec — the stored representation of the public Folio
 * nav (see CONTEXT.md). The schemas live in `@photo/shared` because they are
 * wire shape; the JSON <-> array dance lives here for the same reason
 * `encodeCursor` lives beside the metadata parser: it is a persistence detail
 * of the column, not part of the contract.
 */

import { Effect, Schema as S } from 'effect'
import { InvalidInput, SiteSections, type SiteSection } from '@photo/shared'

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
