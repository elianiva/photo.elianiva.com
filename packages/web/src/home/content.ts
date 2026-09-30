/**
 * The Edition: the photographs the Front shows, plus the pure helpers the views
 * read off them. This module is the front page's only data seam — `view` takes
 * the `edition` out of the Model and nothing in `home/` reaches for another
 * source of content.
 *
 * What is here is what D1 knows: the plates, the months they group into, and
 * whether there is another month below. Every line of text on the page is
 * written in the view that prints it — a masthead is the publication's voice,
 * it is not a record, and the words belong beside the markup that renders them
 * rather than in a table of labels this module hands back. So the Edition has
 * no masthead, no headline, no counters: the only thing a read contributes is
 * photographs.
 *
 * A Photo that is not published is not here, so a site with nothing published
 * is a real state rather than a placeholder: no lead, no Sections, and a
 * Continued row in its empty state.
 *
 * The content types are Effect Schemas rather than bare interfaces because the
 * Model carries the Edition: it is server-rendered into the hydration stamp and
 * decoded again on the client, so the framework needs a codec. The Type side is
 * what the views read.
 */

import { Schema as S } from 'effect'
import { PHOTO_RATIOS, formatExifLine, nearestRatio } from '@photo/shared'
import type { PhotoWithTags, PublicSection } from '@photo/shared'

import { imageUrl } from '@/lib/image'

// ---------------------------------------------------------------------------
// plates
// ---------------------------------------------------------------------------

/** The six plate ratios are the Photo's six supported Ratios (CONTEXT.md), so
 *  they are named once, in the shared domain schema. */
export const PLATE_RATIOS = PHOTO_RATIOS
export type PlateRatio = (typeof PLATE_RATIOS)[number]

export const PlateRatioSchema = S.Literals(PLATE_RATIOS)

/** width / height per ratio, the number `aspect-ratio` wants. */
export const RATIO_VALUE: Record<PlateRatio, number> = {
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
  /** 24 -> "No. 024". The Photo Number, not a position on the page. */
  index: S.Number,
  title: S.String,
  ratio: PlateRatioSchema,
  /** 'X-T20 · 25MM · F/2 · 1/500 · ISO 200 · 31 AUG', or null when the Photo
   *  carries none of the facts the line is made of. */
  exif: S.NullOr(S.String),
  /** The original's key in R2 — the plate's bytes. */
  r2Key: S.String,
})
export type Figure = typeof FigureSchema.Type

export const EditionSectionSchema = S.Struct({
  /** The month key, `2025-08`, and the cursor that resumes below it. */
  id: S.String,
  /** 'August' */
  month: S.String,
  /** '2025' */
  year: S.String,
  figures: S.Array(FigureSchema),
})
export type EditionSection = typeof EditionSectionSchema.Type

/**
 * The Continued row's three states.
 *
 * There is no 'loading' state: a read in flight is a fact about the request, not
 * about the Edition, so it is the Model's `loadingSections` flag and the spinner
 * it drives. Keeping both would be two answers to "is a Section on its way", and
 * the Edition is not where that answer lives.
 *
 * The row words itself in `views/continued.ts`, which is where it renders.
 */
export const TailSchema = S.Literals(['more', 'end', 'empty'])
export type Tail = typeof TailSchema.Type

export const EditionSchema = S.Struct({
  /** The Page One plate, or null when the site opens with no photograph. */
  lead: S.NullOr(FigureSchema),
  sections: S.Array(EditionSectionSchema),
  tail: TailSchema,
})
export type Edition = typeof EditionSchema.Type

// ---------------------------------------------------------------------------
// the read model → the Edition
// ---------------------------------------------------------------------------

/** The public read of the Front: the Sections the photographs group into and
 *  the cursor below them. The photographs are the whole read — the site's copy
 *  is not in the database, so there is no second read that could disagree with
 *  this one. */
export interface FrontRead {
  readonly sections: ReadonlyArray<PublicSection>
  readonly nextSectionCursor: string | null
}

/** `2025-08` -> `August`. The Section's own heading name, off the key so it
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
 * One Photo as one plate.
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
 * - **Number.** The Photo Number is a column, but a legacy row can carry none,
 *   and `0` is the placard of a Photo that has not been numbered.
 */
const figureOf = (photo: PhotoWithTags): Figure | null => {
  const ratio = photo.ratio ?? nearestRatio(photo.width, photo.height)
  if (ratio === null || ratio === undefined) return null
  return {
    id: photo.id,
    index: photo.number ?? 0,
    title: photo.title,
    ratio,
    exif: formatExifLine(photo),
    r2Key: photo.r2Key,
  }
}

/** A Section's plates, in the order the read returned them, minus any Photo
 *  that cannot be drawn. A Section left with none is dropped with it. */
const sectionOf = (section: PublicSection): EditionSection | null => {
  const figures = section.photos.map(figureOf).filter((figure): figure is Figure => figure !== null)
  if (figures.length === 0) return null
  return {
    id: section.month,
    month: monthName(section.month),
    year: section.year,
    figures,
  }
}

/**
 * The Sections a read returned, as the Front draws them.
 *
 * Exported because the Front maps its Sections in two places and they must
 * agree: the Worker maps the first read before it renders, and the browser
 * maps each appended read the same way. A Section whose photographs are all
 * undrawable is dropped here rather than rendered as an empty heading.
 */
export const sectionsOf = (sections: ReadonlyArray<PublicSection>): ReadonlyArray<EditionSection> =>
  sections.map(sectionOf).filter((section): section is EditionSection => section !== null)

/**
 * The Edition, from the public read.
 *
 * A site with nothing published is a state this returns honestly rather than a
 * crash or a placeholder: no lead, no Sections, and a Continued row in its
 * empty state. The Front draws that; it does not need a photograph to be a page.
 */
export const editionOf = (read: FrontRead): Edition => {
  const sections = sectionsOf(read.sections)
  // The Page One plate is the newest photograph in the newest Section, which
  // is also the first plate of that Section's flow.
  const lead = sections.at(0)?.figures.at(0) ?? null
  return {
    lead,
    sections,
    tail: sections.length === 0 ? 'empty' : 'more',
  }
}

// ---------------------------------------------------------------------------
// derived lines
// ---------------------------------------------------------------------------

const pad = (value: number, width: number): string => String(value).padStart(width, '0')

/** A plate's placard number: `frameNo(24)` -> 'No. 024'. */
export const frameNo = (index: number): string => `No. ${pad(index, 3)}`

/** The mobile placard number, zero-padded and unprefixed: `frameNoShort(24)` -> '024'. */
export const frameNoShort = (index: number): string => pad(index, 3)

/** The mobile section head counts frames only, e.g. '09 FRAMES'. */
export const frameCount = (count: number): string =>
  `${pad(count, 2)} ${count === 1 ? 'FRAME' : 'FRAMES'}`

/** The section head's right-hand line, e.g. '08 FRAMES · NO. 016–023'. A
 *  Section with no plate carries no number range, so it prints the count
 *  alone rather than a range over nothing. */
export const sectionCount = (section: EditionSection): string => {
  if (section.figures.length === 0) return frameCount(0)
  const indices = section.figures.map((figure) => figure.index)
  const first = Math.min(...indices)
  const last = Math.max(...indices)
  const noun = section.figures.length === 1 ? 'FRAME' : 'FRAMES'
  return `${pad(section.figures.length, 2)} ${noun} · NO. ${pad(first, 3)}–${pad(last, 3)}`
}

/** The plate's bytes: the Photo's original in R2, served through the Worker's
 *  proxy. The frame is cropped to the Ratio by the plate's own `aspect-ratio`
 *  box, so no resizing happens on the way out. */
export const plateUrl = (figure: Figure): string => imageUrl(figure.r2Key)

// ---------------------------------------------------------------------------
// plate → columns
// ---------------------------------------------------------------------------

/** A column's height, in column-widths. Every plate renders at the column's
 *  width, so its height is `1 / RATIO_VALUE` of that width: a `16:9` plate is
 *  barely half as tall as a `9:16` one. The ratio itself would rank those
 *  the wrong way round, which is why the cost inverts it. */
const columnCost = (figures: ReadonlyArray<Figure>): number =>
  figures.reduce((total, figure) => total + 1 / RATIO_VALUE[figure.ratio], 0)

/** The design's three columns are a flow, not authored structure: each plate
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
