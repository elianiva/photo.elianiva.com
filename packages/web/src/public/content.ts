/**
 * The Timeline: the photographs the home page shows, plus the pure helpers the views
 * read off them. This module is the public site's only data seam — the views
 * take the `timeline` or the `figures` out of the Model and nothing in `public/`
 * reaches for another source of content.
 *
 * What is here is what D1 knows: the figures, the days they group into,
 * whether there is another month below, the Tags a visitor can go to, and the
 * figures one Tag carries. Every line of text on the site is written in the view
 * that prints it — a header is the site's own voice, it is not a record,
 * and the words belong beside the markup that renders them rather than in a
 * table of labels this module hands back. So the Timeline has no header, no
 * headline, no counters, and the About page has no about copy: the only thing a
 * read contributes is photographs, and the only words it contributes are a
 * Tag's own label and caption.
 *
 * A Photo that is not published is not here, so a site with nothing published
 * is a real state rather than a placeholder: no sections and no pager. Every
 * photograph is a photo in a capture day's flow — there is no
 * lead photo and nothing is pinned, because the archive does not rank its own
 * photographs.
 *
 * The content types are Effect Schemas rather than bare interfaces because the
 * Model carries the Timeline: it is server-rendered into the hydration stamp and
 * decoded again on the client, so the framework needs a codec. The Type side is
 * what the views read.
 */

import { placeholderDataUrl } from '@/lib/blurhash'
import { Schema as S } from 'effect'
import { PHOTO_RATIOS, exifDetails, formatExifLine, nearestRatio } from '@photo/shared'
import type { PhotoWithTags, PublicSection } from '@photo/shared'

import { renditionUrl } from '@/lib/image'

// ---------------------------------------------------------------------------
// figures
// ---------------------------------------------------------------------------

/** The six photo ratios are the Photo's six supported Ratios (CONTEXT.md), so
 *  they are named once, in the shared domain schema. */
export const FIGURE_RATIOS = PHOTO_RATIOS
export type FigureRatio = (typeof FIGURE_RATIOS)[number]

export const FigureRatioSchema = S.Literals(FIGURE_RATIOS)

/** width / height per ratio, the number `aspect-ratio` wants. */
export const RATIO_VALUE: Record<FigureRatio, number> = {
  '3:2': 3 / 2,
  '2:3': 2 / 3,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
}

// ---------------------------------------------------------------------------
// content types
// ---------------------------------------------------------------------------

export const FigureSchema = S.Struct({
  /** The Photo's own id, which the lightbox resolves a click through. */
  id: S.String,
  title: S.String,
  /** The capture date, used to group the monthly read into accurate day sheets. */
  takenAt: S.NullOr(S.String),
  ratio: FigureRatioSchema,
  /** The original's own width / height. Frames draw with this, not the snapped
   *  `ratio`, so a photo is never cropped to the nearest of the six Ratios. */
  aspect: S.Number,
  /** 'X-T20 · 25MM · F/2 · 1/500 · ISO 200 · 31 AUG', or null when the Photo
   *  carries none of the facts the line is made of. */
  exif: S.NullOr(S.String),
  /** The labelled facts the lightbox lists — camera, lens, exposure, day,
   *  place — minus any the Photo does not carry. */
  details: S.Array(S.Struct({ label: S.String, value: S.String })),
  /** The original's key in R2 — the photo's bytes. */
  r2Key: S.String,
  /** The placeholder the frame paints until its bytes arrive; null for a Photo
   *  uploaded before Blurhash existed. */
  blurhash: S.NullOr(S.String),
})
export type Figure = typeof FigureSchema.Type

export const DaySectionSchema = S.Struct({
  /** The day key, `2025-08-31`; undated legacy rows use their month key. */
  id: S.String,
  /** The capture day, or null when a legacy row has no usable date. */
  day: S.NullOr(S.Number),
  /** 'August' */
  month: S.String,
  /** '2025' */
  year: S.String,
  figures: S.Array(FigureSchema),
})
export type DaySection = typeof DaySectionSchema.Type

/**
 * The load-more row's three states.
 *
 * There is no 'loading' state: a read in flight is a fact about the request, not
 * about the Timeline, so it is the Model's `loadingMonths` flag and the spinner
 * it drives. Keeping both would be two answers to "is a Month on its way", and
 * the Timeline is not where that answer lives.
 *
 * The row words itself in `views/continued.ts`, which is where it renders.
 */
export const TailSchema = S.Literals(['more', 'end', 'empty'])
export type Tail = typeof TailSchema.Type

export const TimelineSchema = S.Struct({
  sections: S.Array(DaySectionSchema),
  tail: TailSchema,
})
export type Timeline = typeof TimelineSchema.Type

// ---------------------------------------------------------------------------
// the Nav and a Tag page
// ---------------------------------------------------------------------------

/** One entry in the Nav nav. A Tag is the section, so an entry is the Tag's
 *  own `slug` and `label` and nothing else — the link is the Tag page's path,
 *  printed by `tagPath` in `../route`, because a URL is the route table's to
 *  write down. The label is printed as the operator wrote it, the way the
 *  Admin's tag group prints it. */
export const NavEntrySchema = S.Struct({
  slug: S.String,
  label: S.String,
})
export type NavEntry = typeof NavEntrySchema.Type

/** A Tag page: the Tag's own three fields and the figures a read returned for
 *  it. Earliest first, so the cover is the head of the list (ADR 0006 — a
 *  Series page is a Tag page ordered by `takenAt`). */
export const TagPageSchema = S.Struct({
  slug: S.String,
  label: S.String,
  /** The one-line sentence the page prints under the name. Null for a Tag
   *  nobody has captioned, never `''`. */
  caption: S.NullOr(S.String),
  figures: S.Array(FigureSchema),
})
export type TagPage = typeof TagPageSchema.Type

/** The Tag page of a document that is not a Tag page, named once so the
 *  Home page's and the About page's Models can hold the field they never read
 *  without inventing a second spelling of "no Tag here". Its slug is empty, so
 *  a page that is not a Tag page points at no Tag page at all. */
export const EMPTY_TAG_PAGE: TagPage = { slug: '', label: '', caption: null, figures: [] }

// ---------------------------------------------------------------------------
// the read model → the Timeline
// ---------------------------------------------------------------------------

/** The public read of the home page: the Months the photographs group into and
 *  the cursor below them. The photographs are the whole read — the site's copy
 *  is not in the database, so there is no second read that could disagree with
 *  this one. */
export interface HomeRead {
  readonly sections: ReadonlyArray<PublicSection>
  readonly nextMonthCursor: string | null
}

/** The public read of a Tag page: the Tag and the published Photos carrying
 *  it, exactly as `PublicPhotoService.byTag` shapes one. The Tag's own three
 *  fields and its photographs are the whole of it — the page's words are
 *  authored in `views/tag-page.ts`, and a Tag's caption is the only sentence a
 *  read contributes. */
export interface TagRead {
  readonly tag: {
    readonly slug: string
    readonly label: string
    readonly caption: string | null
  }
  readonly photos: ReadonlyArray<PhotoWithTags>
}

/** `2025-08` -> `August`. The Month's own heading name, off the key so it
 *  never depends on a Worker's locale or zone. */
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

const monthName = (month: string): string => MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month

/**
 * One Photo as one photo.
 *
 * Three facts need deciding here rather than in the view, because a view can
 * only render what it is handed:
 *
 * - **Ratio.** A Photo whose Ratio nobody has set still has measured
 *   dimensions, and `nearestRatio` is the one function that knows which of the
 *   six supported Ratios a frame snaps to. A Photo that matches none is
 *   refused at upload, so a null here means a frame nothing could describe;
 *   it is dropped rather than drawn in a Ratio it is not.
 * - **Exif.** `formatExifLine` returns null for a Photo carrying no facts, and
 *   null means the view omits the element rather than printing an empty line.
 * - **Date.** The capture date stays with the Figure so the monthly server
 *   read can be presented as truthful day-level sheets.
 */
const figureOf = (photo: PhotoWithTags): Figure | null => {
  const ratio = photo.ratio ?? nearestRatio(photo.width, photo.height)
  if (ratio === null || ratio === undefined) return null
  return {
    id: photo.id,
    title: photo.title,
    takenAt: photo.takenAt ?? null,
    ratio,
    aspect: RATIO_VALUE[ratio],
    exif: formatExifLine(photo),
    details: exifDetails(photo),
    r2Key: photo.r2Key,
    blurhash: photo.blurhash ?? null,
  }
}

/**
 * Photographs as figures, dropping any that cannot be drawn.
 *
 * Exported because both public documents map a read with it: the home page maps a
 * month's photographs inside {@link monthOf}, and the About page maps the
 * photographs it read straight into the figures it draws — so a Photo that
 * cannot be drawn is dropped by one rule rather than by two.
 */
export const figuresOf = (photos: ReadonlyArray<PhotoWithTags>): ReadonlyArray<Figure> =>
  photos.map(figureOf).filter((figure): figure is Figure => figure !== null)

/** A server month read, split into capture-day sheets while preserving its
 *  newest-first photo order. Legacy rows with no usable day stay together in
 *  one undated sheet rather than receiving an invented date. */
const sectionsOfMonth = (section: PublicSection): ReadonlyArray<DaySection> => {
  const figures = figuresOf(section.photos)
  const groups = new Map<string, { day: number | null; figures: Array<Figure> }>()

  for (const figure of figures) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(figure.takenAt ?? '')
    const date = match?.[0]
    const dayValue = match?.[3]
    const day =
      date !== undefined &&
      date.slice(0, 7) === section.month &&
      dayValue !== undefined &&
      Number(dayValue) >= 1 &&
      Number(dayValue) <= 31
        ? Number(dayValue)
        : null
    const id = day === null || date === undefined ? section.month : date
    const group = groups.get(id)
    if (group === undefined) groups.set(id, { day, figures: [figure] })
    else group.figures.push(figure)
  }

  return [...groups].map(([id, group]) => ({
    id,
    day: group.day,
    month: monthName(section.month),
    year: section.year,
    figures: group.figures,
  }))
}

/**
 * The daily sheets a read returned, as the home page draws them.
 *
 * Exported because the home page maps its monthly reads in two places and they
 * must agree: the Worker maps the first read before it renders, and the browser
 * maps each appended read the same way. A month whose photographs are all
 * undrawable is dropped rather than rendered as an empty heading.
 */
export const sectionsOf = (months: ReadonlyArray<PublicSection>): ReadonlyArray<DaySection> =>
  months.flatMap(sectionsOfMonth)

/**
 * The Timeline, from the public read.
 *
 * A site with nothing published is a state this returns honestly rather than a
 * crash or a placeholder: no sections and no cursor to follow.
 *
 * The Timeline carries no photo of its own. It used to name the newest
 * photograph the Page One photo and draw it beside the intro, which made one
 * photograph the site's cover photo and the same photograph the first frame of
 * the first Month on mobile — a rank the archive never assigned, published
 * from nothing anyone had marked. The daily sections are the whole of it now.
 */
export const timelineOf = (read: HomeRead): Timeline => {
  const sections = sectionsOf(read.sections)
  return {
    sections,
    tail: sections.length === 0 ? 'empty' : 'more',
  }
}

/**
 * The Timeline of a site with nothing published — the shape `timelineOf` returns
 * for an empty read, named once so the About page's Model can hold a Timeline
 * it never reads without inventing a second spelling of "empty".
 */
export const EMPTY_TIMELINE: Timeline = { sections: [], tail: 'empty' }

/**
 * A Tag page, from the public read.
 *
 * A Tag whose published photographs are all undrawable is a page with a name
 * and no photo on it, the same honest state the About page draws for an empty
 * read: a Tag nobody has published anything under is not a destination, so the
 * Nav does not link to it, but a reader holding the URL is answered with the
 * Tag's own page rather than a different site.
 */
export const tagPageOf = (read: TagRead): TagPage => ({
  slug: read.tag.slug,
  label: read.tag.label,
  caption: read.tag.caption,
  figures: figuresOf(read.photos),
})

// ---------------------------------------------------------------------------
// derived lines
// ---------------------------------------------------------------------------

/** The mobile section head counts frames only, e.g. '09 FRAMES'. */
export const frameCount = (count: number): string =>
  `${String(count).padStart(2, '0')} ${count === 1 ? 'FRAME' : 'FRAMES'}`

/** The grid's image: the Photo's `small` WebP (1600px long edge), served from
 *  R2 through the Worker's proxy. The frame is cropped to the Ratio by the
 *  photo's own `aspect-ratio` box. */
/** The decoded Blurhash as a CSS style for the `<img>`, so it shows through
 *  until the bitmap arrives. Empty when the Photo has none. */
export const placeholderStyle = (figure: Figure): Record<string, string> => {
  const url = figure.blurhash === null ? null : placeholderDataUrl(figure.blurhash)
  return url === null ? {} : { backgroundImage: `url(${url})`, backgroundSize: '100% 100%' }
}

export const figureUrl = (figure: Figure): string => renditionUrl(figure.id, 'small')

/** The lightbox's image: the `preview` WebP at the original's pixel size. */
export const figurePreviewUrl = (figure: Figure): string => renditionUrl(figure.id, 'preview')

// ---------------------------------------------------------------------------
// photo → columns
// ---------------------------------------------------------------------------

/** A column's height, in column-widths. Every photo renders at the column's
 *  width, so its height is `1 / aspect` of that width: a `16:9` photo is
 *  barely half as tall as a `9:16` one. The ratio itself would rank those
 *  the wrong way round, which is why the cost inverts it. */
const columnCost = (figures: ReadonlyArray<Figure>): number =>
  figures.reduce((total, figure) => total + 1 / figure.aspect, 0)

/** The design's three columns are a flow, not authored structure: each photo
 *  drops into whichever column is shortest so far, which is what leaves the
 *  ragged bottom edge the frame shows. Ties keep the leftmost column, so the
 *  fill is deterministic. */
export const flowColumns = (
  figures: ReadonlyArray<Figure>,
  count: number,
): ReadonlyArray<ReadonlyArray<Figure>> => {
  const columns: Array<Array<Figure>> = Array.from({ length: count }, () => [])
  for (const figure of figures) {
    const shortest = columns.reduce(
      (best, column) => (columnCost(column) < columnCost(best) ? column : best),
      columns[0] ?? [],
    )
    shortest.push(figure)
  }
  return columns
}
