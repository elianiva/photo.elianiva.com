import { Schema as S } from 'effect'
import { MatColour, PhotoRatio, RenditionFormat } from './photo'

/**
 * Site Section — one entry in the public Folio nav, authored as an ordered list
 * in the Admin's settings singleton (see CONTEXT.md).
 *
 * The design draws SECTIONS as a single `ALL · STREET · LANDSCAPE · SERIES ·
 * ABOUT` string. That string cannot be routed, so a Section carries its own
 * destination: `kind` says what the destination is, `target` names it, and only
 * the three kinds that go somewhere carry one. The union is deliberate — a
 * Section that cannot point anywhere is not representable.
 */

const label = S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(40)))

/** A Tag's slug, or a page name — the shape `slugify` produces. */
const target = S.String.pipe(
  S.check(S.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  S.check(S.isMaxLength(80)),
)

/** The Front itself. */
const allSection = S.Struct({ kind: S.Literal('all'), label })

/** A Tag's page, ordered by takenAt. */
const tagSection = S.Struct({ kind: S.Literal('tag'), label, target })

/** A curated group, linked from a Tag's slug. A Series page *is* a Tag page
 *  (ADR 0008); the kind records how the author meant the entry. */
const seriesSection = S.Struct({ kind: S.Literal('series'), label, target })

/** A page of the site, named by its path segment. */
const pageSection = S.Struct({ kind: S.Literal('page'), label, target })

export const SiteSection = S.Union([allSection, tagSection, seriesSection, pageSection])
export type SiteSection = typeof SiteSection.Type

/** The whole nav, in the order it renders. */
export const SiteSections = S.Array(SiteSection).pipe(S.check(S.isMaxLength(16)))
export type SiteSections = typeof SiteSections.Type

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
 * seeded from, the watermark and metadata policy, the retention setting and the
 * SITE copy, all of it. `sections` is the decoded nav, never the column's JSON —
 * the codec is a storage detail, and the public `readSiteCopy` path stays the
 * one that reads it.
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
  /** Free text, so nullable rather than absent. */
  copyright: S.NullOr(S.String),
  retainForever: S.Boolean,
  /** `VOL. V`, authored rather than derived from a count. */
  volume: S.String,
  motto: S.NullOr(S.String),
  aboutCopy: S.NullOr(S.String),
  sections: SiteSections,
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
