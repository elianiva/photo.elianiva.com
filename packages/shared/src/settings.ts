import { Schema as S } from 'effect'
import { MatColour, PhotoRatio, RenditionFormat } from './photo'

/**
 * Where the watermark sits on an exported frame.
 *
 * The design draws POSITION as a read-out — `BOTTOM RIGHT` — and lists no
 * alternatives, so there is nothing for the setting to choose between. A Select
 * with one option is a control that lies about what it can do, so the value set
 * is the four corners plus the centre: every position a watermark can
 * actually take. `bottom-right` is the value migration 0005 gives the column,
 * and it leads the list for the same reason.
 */
export const WATERMARK_POSITIONS = [
  'bottom-left',
  'bottom-right',
  'top-left',
  'top-right',
  'centre',
] as const

export const WatermarkPosition = S.Literals(WATERMARK_POSITIONS)
export type WatermarkPosition = typeof WatermarkPosition.Type

/**
 * One non-trashed Photo as the Storage block's CSV index reads it: the columns
 * the index names, nothing else. Narrower than `PhotoWithTags` on purpose — the
 * export does not want an `r2Key`, a Blurhash or a Tag id on the wire, only a
 * number, the copy, where the frame was taken, its labels and its size.
 */
export const PhotoIndexRow = S.Struct({
  /** The site's serial. Null for a Photo that was never numbered. */
  number: S.NullOr(S.Number),
  title: S.String,
  slug: S.String,
  ratio: S.NullOr(PhotoRatio),
  takenAt: S.NullOr(S.String),
  /** The Photo's place — `metadata.location` in the blob, `Place` in the CSV
   *  header. */
  place: S.NullOr(S.String),
  /** Tag labels, alphabetical. Whatever formats them joins them. */
  tags: S.Array(S.String),
  bytes: S.NullOr(S.Number),
})
export type PhotoIndexRow = typeof PhotoIndexRow.Type

/**
 * The Settings singleton as one wire value: the export defaults a new upload is
 * seeded from, the watermark and metadata policy and the retention setting —
 * the four things the photograph pipeline actually reads. There is no site copy
 * here on purpose: every line the public site prints is authored in
 * `home/content.ts`, and a second, editable source for the same sentence is
 * copy nobody can find (migration 0008).
 *
 * The fields live in one map because `SettingsInput` is this value without
 * `updatedAt`, and the two must not be able to drift apart.
 */
const settingsFields = {
  defaultPreviewLongEdge: S.Number.pipe(S.check(S.isGreaterThan(0))),
  defaultPreviewFormat: RenditionFormat,
  defaultPreviewQuality: S.Number.pipe(S.check(S.isBetween({ minimum: 1, maximum: 100 }))),
  defaultFullQuality: S.Number.pipe(S.check(S.isBetween({ minimum: 1, maximum: 100 }))),
  watermarkEnabled: S.Boolean,
  watermarkColour: MatColour,
  watermarkPosition: WatermarkPosition,
  defaultKeepExif: S.Boolean,
  defaultRemoveGps: S.Boolean,
  retainForever: S.Boolean,
} as const

export const Settings = S.Struct({
  /** ISO-8601, stamped by the server on every save. Null on a row that has
   *  never been saved, which the Settings header prints rather than turning
   *  into a date: "when this was last saved" is a fact about a write, and
   *  there has not been one. */
  updatedAt: S.NullOr(S.String),
  ...settingsFields,
})
export type Settings = typeof Settings.Type

/** What a save carries: the whole singleton minus the stamp, which the server
 *  owns because "when this was saved" is a fact about the write and not about
 *  what the operator typed. */
export const SettingsInput = S.Struct(settingsFields)
export type SettingsInput = typeof SettingsInput.Type
