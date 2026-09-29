/**
 * The Edition: one issue of the broadsheet, plus the pure helpers the views
 * read off it. This module is the front page's only data seam — `view` takes
 * the `edition` out of the Model and nothing in `home/` reaches for another
 * source of content.
 *
 * The content types are Effect Schemas rather than bare interfaces because
 * the Model carries the Edition: it is server-rendered into the hydration
 * stamp and decoded again on the client, so the framework needs a codec. The
 * Type side is what the views read.
 */

import { Schema as S } from 'effect'
import { PHOTO_RATIOS } from '@photo/shared'

import { imagePreviewLongEdge, imagePreviewQuality } from '@/lib/design-tokens'

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

/** Long edge every plate is requested at; imgix crops it to the ratio. */
/** The preview rendition the design specifies: a 1200px long edge at quality 82. */
const PLATE_WIDTH = imagePreviewLongEdge
const PLATE_QUALITY = imagePreviewQuality

// ---------------------------------------------------------------------------
// content types
// ---------------------------------------------------------------------------

export const FigureSchema = S.Struct({
  /** Stable key. Section-scoped: a frame number is not unique across the
   *  issue, and the lightbox resolves a click through this id. */
  id: S.String,
  /** 24 -> "No. 024" */
  index: S.Number,
  title: S.String,
  ratio: PlateRatioSchema,
  /** 'X-T20 · 25MM · F/2 · 1/500 · ISO 200 · 31 AUG' */
  exif: S.String,
  /** Unsplash photo id — the plate's bytes. */
  photoId: S.String,
})
export type Figure = typeof FigureSchema.Type

export const EditionSectionSchema = S.Struct({
  id: S.String,
  /** 'August' */
  month: S.String,
  /** '2025' */
  year: S.String,
  figures: S.Array(FigureSchema),
})
export type EditionSection = typeof EditionSectionSchema.Type

/** 'more' | 'loading' | 'end' — the three states of the Continued component. */
export const TailSchema = S.Union([
  S.Struct({ state: S.Literal('more'), label: S.String }),
  S.Struct({ state: S.Literal('loading'), label: S.String }),
  S.Struct({ state: S.Literal('end'), marker: S.String, note: S.String }),
])
export type Tail = typeof TailSchema.Type

export const ColophonColumnSchema = S.Struct({
  /** 'EQUIPMENT' */
  label: S.String,
  lines: S.Array(S.String),
})
export type ColophonColumn = typeof ColophonColumnSchema.Type

export const ColophonSchema = S.Struct({
  blurb: S.String,
  columns: S.Array(ColophonColumnSchema),
  copyright: S.String,
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
  /** 'VOL. V — NO. 412' */
  volume: S.String,
  /** '412' — the folio's "412 FRAMES" */
  issue: S.String,
  /** 'SUNDAY, 31 AUGUST 2025' */
  folioDate: S.String,
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
  headline: S.String,
  deck: S.String,
  /** The Page One figure. */
  lead: FigureSchema,
  sections: S.Array(EditionSectionSchema),
  tail: TailSchema,
  colophon: ColophonSchema,
  folio: FolioSchema,
})
export type Edition = typeof EditionSchema.Type

// ---------------------------------------------------------------------------
// the dummy edition
// ---------------------------------------------------------------------------

export const edition: Edition = {
  volume: 'VOL. V — NO. 412',
  issue: '412',
  folioDate: 'SUNDAY, 31 AUGUST 2025',
  origin: 'FROM JAKARTA',
  motto: 'photo.elianiva.com',
  tagline: 'Street, mostly. Landscape, sometimes.',
  archiveLabel: 'THE ARCHIVE',
  archiveLine: 'Jakarta, Istanbul, Tokyo and New York, since 2021.',
  kicker: 'THIS EDITION · JULY AND AUGUST 2025',
  headline: 'A summer in New York, a night in Istanbul, then home to Jakarta.',
  deck: 'Nineteen frames from July and August, made on foot with one camera and one lens.',
  lead: {
    id: 'no-024',
    index: 24,
    title: 'Jakarta, the last of the sun on Jalan Pintu Besar.',
    ratio: '3:2',
    exif: 'X-T20 · 25MM · F/2 · 1/500 · ISO 200 · 31 AUG',
    photoId: '1493976040374-85c8e12f0c0e',
  },
  sections: [
    {
      id: 'august-2025',
      month: 'August',
      year: '2025',
      figures: [
        {
          id: 'august-2025-no-023',
          index: 23,
          title: 'Rush hour on Jalan Sudirman, from a footbridge.',
          ratio: '2:3',
          exif: 'X-T20 · 25MM · F/5.6 · 1/500 · ISO 200 · 27 AUG',
          photoId: '1518548419970-58e3b4079ab2',
        },
        {
          id: 'august-2025-no-017',
          index: 17,
          title: 'A paper lantern on St. Marks Place, lit before dark.',
          ratio: '16:9',
          exif: 'X-T20 · 25MM · F/2 · 1/250 · ISO 400 · 01 AUG',
          photoId: '1555899434-94d1368aa7af',
        },
        {
          id: 'august-2025-no-016',
          index: 16,
          title: 'The Empire State Building, early, from 34th Street.',
          ratio: '4:3',
          exif: 'X-T20 · 25MM · F/2 · 1/250 · ISO 200 · 31 AUG',
          photoId: '1524492412937-b28074a5d7da',
        },
        {
          id: 'august-2025-no-022',
          index: 22,
          title: 'Istanbul, the red tram on İstiklal Avenue.',
          ratio: '2:3',
          exif: 'X-T20 · 25MM · F/1.8 · 1/250 · ISO 800 · 14 AUG',
          photoId: '1470004914212-05527e49370b',
        },
        {
          id: 'august-2025-no-021',
          index: 21,
          title: 'New York, fire escapes on East 7th Street.',
          ratio: '3:4',
          exif: 'X-T20 · 25MM · F/5.6 · 1/250 · ISO 800 · 16 AUG',
          photoId: '1444723121867-7a241cacace9',
        },
        {
          id: 'august-2025-no-018',
          index: 18,
          title: 'Two years of salakade, thinning in the middle.',
          ratio: '3:2',
          exif: 'X-T20 · 25MM · F/2 · 1/1000 · ISO 200 · 10 AUG',
          photoId: '1514565131-fce0801e5785',
        },
        {
          id: 'august-2025-no-020',
          index: 20,
          title: 'Mother and son, Water Street, Dumbo.',
          ratio: '4:3',
          exif: 'X-T20 · 25MM · F/2 · 1/2000 · ISO 200 · 09 AUG',
          photoId: '1519501025264-65ba15a82390',
        },
        {
          id: 'august-2025-no-019',
          index: 19,
          title: 'Rooftop sport, out of the jersey at dusk.',
          ratio: '4:3',
          exif: 'X-T20 · 25MM · F/2 · 1/2000 · ISO 200 · 09 AUG',
          photoId: '1516483638261-f4dbaf036963',
        },
      ],
    },
    {
      id: 'july-2025',
      month: 'July',
      year: '2025',
      figures: [
        {
          id: 'july-2025-no-015',
          index: 15,
          title: 'Storm King, one car between the long lawns.',
          ratio: '9:16',
          exif: 'X-T20 · 25MM · F/8 · 1/500 · ISO 200 · 30 JUL',
          photoId: '1493246507139-91e8fad9978e',
        },
        {
          id: 'july-2025-no-012',
          index: 12,
          title: 'Prospect Park, a hood among the dahlias.',
          ratio: '3:2',
          exif: 'X-T20 · 25MM · F/8 · 1/1000 · ISO 200 · 31 JUL',
          photoId: '1534430480872-3498386e7856',
        },
        {
          id: 'july-2025-no-009',
          index: 9,
          title: 'A country road, apricots, late light.',
          ratio: '2:3',
          exif: 'X-T20 · 25MM · F/2 · 1/1000 · ISO 400 · 03 AUG',
          photoId: '1518391846015-55a9cc003b25',
        },
        {
          id: 'july-2025-no-014',
          index: 14,
          title: 'Larches in the evening mist.',
          ratio: '2:3',
          exif: 'X-T20 · 25MM · F/5.6 · 1/500 · ISO 200 · 27 JUL',
          photoId: '1449824913935-59a10b8d2000',
        },
        {
          id: 'july-2025-no-013',
          index: 13,
          title: 'A goat on the scree, above the treeline.',
          ratio: '16:9',
          exif: 'X-T20 · 25MM · F/2 · 1/2000 · ISO 200 · 09 AUG',
          photoId: '1506905925346-21bda4d32df4',
        },
        {
          id: 'july-2025-no-011',
          index: 11,
          title: 'Melbourne, from Forty floors up.',
          ratio: '4:3',
          exif: 'X-T20 · 25MM · F/2 · 1/2000 · ISO 200 · 09 AUG',
          photoId: '1480714378408-67cf0d13bc1b',
        },
        {
          id: 'july-2025-no-010',
          index: 10,
          title: 'Manhattan under haze, from the Pulaski.',
          ratio: '16:9',
          exif: 'X-T20 · 25MM · F/2 · 1/2000 · ISO 200 · 31 JUL',
          photoId: '1470071459604-3b5ec3a7fe05',
        },
        {
          id: 'july-2025-no-006',
          index: 6,
          title: 'Fifth Avenue after dark, out of focus on purpose.',
          ratio: '16:9',
          exif: 'X-T20 · 25MM · F/1.4 · 1/1250 · ISO 200 · 31 AUG',
          photoId: '1501785888041-af3ef285b470',
        },
        {
          id: 'july-2025-no-008',
          index: 8,
          title: 'The Financial District, looking straight up.',
          ratio: '3:4',
          exif: 'X-T20 · 25MM · F/1.4 · 1/1000 · ISO 200 · 31 JUL',
          photoId: '1476514525535-07fb3b4ae5f1',
        },
        {
          id: 'july-2025-no-007',
          index: 7,
          title: 'Riverside Drive, streetlights through the fog.',
          ratio: '3:2',
          exif: 'X-T20 · 25MM · F/2 · 1/2000 · ISO 200 · 31 AUG',
          photoId: '1486299267070-83823f5448dd',
        },
      ],
    },
  ],
  tail: { state: 'loading', label: 'LOADING JUNE 2025' },
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
      },
      {
        label: 'SECTIONS',
        lines: ['Street', 'Landscape', 'Series', 'About', 'Archive'],
      },
      {
        label: 'ELSEWHERE',
        lines: ['Instagram (archive)', 'RSS feed', 'Prints on request', 'hello@elianiva.com'],
      },
    ],
    copyright: '© 2021–2025 ELIANIVA · ALL RIGHTS RESERVED',
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
}

// ---------------------------------------------------------------------------
// derived lines
// ---------------------------------------------------------------------------

const pad = (value: number, width: number): string => String(value).padStart(width, '0')

/** A plate's placard number: `frameNo(24)` -> 'No. 024'. */
export const frameNo = (index: number): string => `No. ${pad(index, 3)}`

/** The section head's right-hand line, e.g. '08 FRAMES · NO. 016–023'. */
export const sectionCount = (section: EditionSection): string => {
  const indices = section.figures.map((figure) => figure.index)
  const first = Math.min(...indices)
  const last = Math.max(...indices)
  const noun = section.figures.length === 1 ? 'FRAME' : 'FRAMES'
  return `${pad(section.figures.length, 2)} ${noun} · NO. ${pad(first, 3)}–${pad(last, 3)}`
}

/** The plate image, cropped by imgix to the Figure's declared ratio so the
 *  crop happens once, server-side, instead of in every reader's browser. */
export const plateUrl = (figure: Figure): string => {
  const height = Math.round(PLATE_WIDTH / RATIO_VALUE[figure.ratio])
  return `https://images.unsplash.com/photo-${figure.photoId}?w=${String(PLATE_WIDTH)}&h=${String(height)}&fit=crop&crop=entropy&q=${String(PLATE_QUALITY)}&auto=format`
}

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
