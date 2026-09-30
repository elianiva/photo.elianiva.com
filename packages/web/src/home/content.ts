/**
 * The Edition: one issue of the broadsheet, plus the pure helpers the views
 * read off it. This module is the front page's only data seam — `view` takes
 * the `edition` out of the Model and nothing in `home/` reaches for another
 * source of content.
 *
 * Half of the Edition is **copy** and half is **the photographs**, and the two
 * have different sources. The copy — the headline, the deck, the colophon, the
 * tagline — is the broadsheet's own text and lives in {@link copy} below; it
 * is authored, not read. The photographs come out of D1 on every request, via
 * {@link editionOf}, which turns the public read model into this shape. A
 * Photo that is not published is not here, so an Edition with nothing published
 * yet is a real state with real empty copy rather than a placeholder list.
 *
 * The content types are Effect Schemas rather than bare interfaces because
 * the Model carries the Edition: it is server-rendered into the hydration
 * stamp and decoded again on the client, so the framework needs a codec. The
 * Type side is what the views read.
 */

import { DateTime, Option, Schema as S } from 'effect'
import { PHOTO_RATIOS, formatExifLine, nearestRatio } from '@photo/shared'
import type { FrontStats, PhotoWithTags, PublicSection } from '@photo/shared'

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
  /** 24 -> "No. 024". The Photo Number, not a position in this Edition. */
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
 * 'more' | 'end' — the two states of the Continued row.
 *
 * There is no third 'loading' state: a read in flight is a fact about the
 * request, not about the Edition, so it is the Model's `loadingSections` flag
 * and the spinner it drives. Keeping both would be two answers to "is a Section
 * on its way", and the Edition is not where that answer lives.
 */
export const TailSchema = S.Union([
  S.Struct({ state: S.Literal('more'), label: S.String }),
  S.Struct({ state: S.Literal('end'), marker: S.String, note: S.String }),
])
export type Tail = typeof TailSchema.Type

export const ColophonColumnSchema = S.Struct({
  /** 'EQUIPMENT' */
  label: S.String,
  lines: S.Array(S.String),
  /** The mobile Colophon's plainer list; absent prints `lines` as-is. */
  linesMobile: S.optional(S.Array(S.String)),
  /** The desktop Colophon's own column, e.g. EQUIPMENT. */
  desktopOnly: S.optional(S.Boolean),
})
export type ColophonColumn = typeof ColophonColumnSchema.Type

export const ColophonSchema = S.Struct({
  blurb: S.String,
  columns: S.Array(ColophonColumnSchema),
  copyright: S.String,
  /** The mobile Colophon drops the rights clause; absent prints `copyright`. */
  copyrightMobile: S.optional(S.String),
  /** 'Set in Newsreader, Libre Franklin and IBM Plex Mono.' */
  note: S.String,
  /** 'BACK TO TOP ↑' */
  backToTop: S.String,
})
export type Colophon = typeof ColophonSchema.Type

export const FolioLinkSchema = S.Struct({ label: S.String, href: S.String })
export type FolioLink = typeof FolioLinkSchema.Type

export const FolioSchema = S.Struct({
  /** ALL (active), STREET, LANDSCAPE, SERIES, ABOUT */
  sections: S.Array(FolioLinkSchema),
  searchHref: S.String,
  rssHref: S.String,
})
export type Folio = typeof FolioSchema.Type

export const EditionSchema = S.Struct({
  /** The volume numeral, `settings.volume` — 'V'. Raw, because it is the
   *  masthead's *input*, not its wording. */
  volume: S.String,
  /** The site's highest published Photo Number, or null when none is numbered.
   *  Raw for the same reason; `mastheadCount` words it. */
  number: S.NullOr(S.Number),
  /** Every published photograph, the folio's `412 FRAMES`. */
  total: S.Number,
  /** 'SUNDAY, 31 AUGUST 2025' */
  folioDate: S.String,
  /** '31 AUG 2025' — the mobile Ears Strip's shorter date. */
  folioDateMobile: S.String,
  /** 'FROM JAKARTA' */
  origin: S.String,
  /** 'photo.elianiva.com' — the site name, centred in the ears strip. */
  motto: S.String,
  /** 'Street, mostly. Landscape, sometimes.' */
  tagline: S.String,
  archiveLabel: S.String,
  archiveLine: S.String,
  /** 'THIS EDITION · JULY AND AUGUST 2025' */
  kicker: S.String,
  /** 'THIS EDITION' — the mobile lede has one kicker, not a range. */
  kickerMobile: S.String,
  headline: S.String,
  deck: S.String,
  /** The Page One plate, or null when this Edition opens with no photograph. */
  lead: S.NullOr(FigureSchema),
  sections: S.Array(EditionSectionSchema),
  tail: TailSchema,
  colophon: ColophonSchema,
  folio: FolioSchema,
})
export type Edition = typeof EditionSchema.Type

// ---------------------------------------------------------------------------
// the copy
// ---------------------------------------------------------------------------

/**
 * The broadsheet's own text: the masthead's strapline, the lede's headline and
 * deck, the colophon, the folio nav. None of it is in the database, and none of
 * it should be — a masthead is not a record, it is the publication's voice, and
 * it changes when the publication's voice does rather than when a photograph
 * is uploaded. What *is* in the database is the count, the date and the plates,
 * and {@link editionOf} mixes the two.
 */
const copy = {
  origin: 'FROM JAKARTA',
  motto: 'photo.elianiva.com',
  tagline: 'Street, mostly. Landscape, sometimes.',
  archiveLabel: 'THE ARCHIVE',
  archiveLine: 'Jakarta, Istanbul, Tokyo and New York, since 2021.',
  kickerMobile: 'THIS EDITION',
  headline: 'A summer in New York, a night in Istanbul, then home to Jakarta.',
  deck: 'Nineteen frames from July and August, made on foot with one camera and one lens.',
  /** Printed when the site has no published photograph to count. */
  emptyHeadline: 'Nothing published yet.',
  emptyDeck: 'The first photograph is on its way. Everything below the masthead is the front page waiting for it.',
  emptyMarker: 'NO FRAMES YET',
  emptyNote: 'The first photograph will open the next edition.',
  colophon: {
    blurb: 'Photographs made on foot, mostly in Jakarta, usually around golden hour.',
    columns: [
      {
        label: 'EQUIPMENT',
        lines: [
          'Camera — Fujifilm X-T20',
          'Lens — 25mm f/1.8, manual',
          'Film sim — Classic Chrome',
          'Based in Jakarta',
        ],
        desktopOnly: true,
      },
      {
        label: 'SECTIONS',
        lines: ['Street', 'Landscape', 'Series', 'About', 'Archive'],
        linesMobile: ['Street', 'Landscape', 'About', 'Archive'],
      },
      {
        label: 'ELSEWHERE',
        lines: ['Instagram (archive)', 'RSS feed', 'Prints on request', 'hello@elianiva.com'],
        linesMobile: ['Instagram (archive)', 'RSS feed', 'hello@elianiva.com'],
      },
    ],
    copyright: '© 2021–2025 ELIANIVA · ALL RIGHTS RESERVED',
    copyrightMobile: '© 2021–2025 ELIANIVA',
    note: 'Set in Newsreader, Libre Franklin and IBM Plex Mono.',
    backToTop: 'BACK TO TOP ↑',
  },
  folio: {
    sections: [
      { label: 'ALL', href: '/#' },
      { label: 'STREET', href: '/street' },
      { label: 'LANDSCAPE', href: '/landscape' },
      { label: 'SERIES', href: '/series' },
      { label: 'ABOUT', href: '/about' },
    ],
    searchHref: '/search',
    rssHref: '/rss.xml',
  },
} as const satisfies {
  readonly origin: string
  readonly motto: string
  readonly tagline: string
  readonly archiveLabel: string
  readonly archiveLine: string
  readonly kickerMobile: string
  readonly headline: string
  readonly deck: string
  readonly emptyHeadline: string
  readonly emptyDeck: string
  readonly emptyMarker: string
  readonly emptyNote: string
  readonly colophon: Colophon
  readonly folio: Folio
}

// ---------------------------------------------------------------------------
// the read model → the Edition
// ---------------------------------------------------------------------------

/** The public read of the Front: the Sections it groups, the cursor below
 *  them, and the site's counters. One value, so the Edition is built from a
 *  single consistent snapshot rather than from two reads that could disagree. */
export interface FrontRead {
  readonly sections: ReadonlyArray<PublicSection>
  readonly nextSectionCursor: string | null
  readonly stats: FrontStats
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
  const figures = section.photos
    .map(figureOf)
    .filter((figure): figure is Figure => figure !== null)
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
export const sectionsOf = (
  sections: ReadonlyArray<PublicSection>,
): ReadonlyArray<EditionSection> =>
  sections.map(sectionOf).filter((section): section is EditionSection => section !== null)

/**
 * The kicker's month range: `THIS EDITION · JUNE 2026 AND MAY 2026`, or
 * `THIS EDITION · JUNE 2026` when the Edition is one month long.
 *
 * The sections arrive newest first, so the *last* one is the oldest month in
 * the Edition and the range reads oldest-to-newest — the same order a reader
 * meets them scrolling back up the page.
 */
const kickerOf = (sections: ReadonlyArray<EditionSection>): string => {
  const newest = sections.at(0)
  const oldest = sections.at(-1)
  if (newest === undefined || oldest === undefined) return 'THIS EDITION'
  const name = (id: string): string => `${monthName(id).toUpperCase()} ${id.slice(0, 4)}`
  if (newest.id === oldest.id) return `THIS EDITION · ${name(newest.id)}`
  return `THIS EDITION · ${name(oldest.id)} AND ${name(newest.id)}`
}

/** The folio's date is the day the newest published photograph was taken, and
 *  a site with no published photograph has no date to print.
 *
 *  `takenAt` is stored as the day a photograph was made, optionally with the
 *  time it was made (`2026-06-11`, `2026-06-11T14:27`), so only the date part
 *  is read. The weekday comes from the same UTC parse `formatExifLine` uses,
 *  and a calendar-invalid day is dropped rather than rolled forward — the same
 *  rule, so the Exif line and the folio date can never disagree about a date. */
const folioDate = (takenAt: string | null): { long: string; short: string } => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(takenAt?.trim() ?? '')
  if (parts === null) return { long: '', short: '' }
  const [, year, month, day] = parts
  if (year === undefined || month === undefined || day === undefined) return { long: '', short: '' }
  const stated = `${year}-${month}-${day}`
  const parsed = DateTime.make(stated)
  if (Option.isNone(parsed)) return { long: '', short: '' }
  if (DateTime.formatIsoDateUtc(parsed.value) !== stated) return { long: '', short: '' }
  return {
    long: DateTime.formatUtc(parsed.value, {
      locale: 'en-GB',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).toUpperCase(),
    short: DateTime.formatUtc(parsed.value, {
      locale: 'en-GB',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).toUpperCase(),
  }
}

/**
 * The masthead's wording for the site's counters, from the raw values.
 *
 * The counters are kept raw on the Edition and worded here because appending an
 * older Section changes them: the reader has to see the count rise, and a
 * worded string cannot be re-worded without parsing the wording back out
 * again. One function that turns numbers into this masthead's three lines is
 * the only place that wording exists.
 */
export const mastheadCount = (edition: Edition): {
  volume: string
  volumeMobile: string
  issue: string
} => {
  const issue = String(edition.total)
  const number = String(edition.number ?? 0).padStart(3, '0')
  return {
    volume: `VOL. ${edition.volume} — NO. ${number}`,
    // The mobile Ears Strip has no room for the volume numeral.
    volumeMobile: `NO. ${number}`,
    issue,
  }
}

/**
 * The Edition, from the public read and the copy.
 *
 * A site with nothing published is a state this returns honestly rather than a
 * crash or a placeholder: no lead, no Sections, a count of zero, a kicker with
 * no month range in it, and a Continued row that says the issue is empty. The
 * Front draws that; it does not need a photograph to be a page.
 */
export const editionOf = (read: FrontRead): Edition => {
  const sections = sectionsOf(read.sections)
  const { number, total, volume, latestTakenAt } = read.stats
  const dates = folioDate(latestTakenAt)
  const isEmpty = sections.length === 0
  // The Page One plate is the newest photograph in the newest Section, which
  // is also the first plate of that Section's flow.
  const lead = sections.at(0)?.figures.at(0) ?? null
  return {
    volume,
    number,
    total,
    folioDate: dates.long,
    folioDateMobile: dates.short,
    origin: copy.origin,
    motto: copy.motto,
    tagline: copy.tagline,
    archiveLabel: copy.archiveLabel,
    archiveLine: copy.archiveLine,
    kicker: isEmpty ? 'THIS EDITION' : kickerOf(sections),
    kickerMobile: copy.kickerMobile,
    headline: isEmpty ? copy.emptyHeadline : copy.headline,
    deck: isEmpty ? copy.emptyDeck : copy.deck,
    lead,
    sections,
    tail: isEmpty
      ? { state: 'end', marker: copy.emptyMarker, note: copy.emptyNote }
      : { state: 'more', label: 'LOAD THE EARLIER EDITIONS' },
    colophon: copy.colophon,
    folio: copy.folio,
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
