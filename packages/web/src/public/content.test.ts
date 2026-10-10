import { describe, expect, it } from 'vitest'

import type { PhotoWithTags, PublicSection } from '@photo/shared'
import { PhotoId } from '@photo/shared'

import {
  RATIO_VALUE,
  timelineOf,
  flowColumns,
  figurePreviewUrl,
  figureUrl,
  sectionsOf,
  type HomeRead,
} from './content'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const photo = (over: Partial<PhotoWithTags> = {}): PhotoWithTags => ({
  id: PhotoId.make('photo-1'),
  slug: 'lift',
  title: 'Lift',
  r2Key: 'originals/photo-1-lift.jpg',
  width: 4000,
  height: 3000,
  number: 24,
  ratio: '3:2',
  bytes: 1024,
  takenAt: '2025-08-31',
  aperture: 2,
  shutter: 0.002,
  iso: 200,
  focalLength: 25,
  metadata: { camera: 'X-T20' },
  ...over,
})

const section = (month: string, photos: ReadonlyArray<PhotoWithTags>): PublicSection => ({
  month,
  year: month.slice(0, 4),
  label: `${month} label`,
  frames: photos.length,
  numberFrom: photos.length === 0 ? null : Math.min(...photos.map((p) => p.number ?? 0)),
  numberTo: photos.length === 0 ? null : Math.max(...photos.map((p) => p.number ?? 0)),
  photos,
})

const read = (over: Partial<HomeRead> = {}): HomeRead => ({
  sections: [section('2025-08', [photo()])],
  nextMonthCursor: null,
  ...over,
})

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// the read model → figures
// ---------------------------------------------------------------------------

describe('sectionsOf', () => {
  it('uses the capture day while naming the month from the server month key', () => {
    const [mapped] = sectionsOf([section('2025-08', [photo()])])
    expect(mapped?.id).toBe('2025-08-31')
    expect(mapped?.day).toBe(31)
    expect(mapped?.month).toBe('August')
    expect(mapped?.year).toBe('2025')
  })

  it('carries the title, capture date and R2 key onto the photo, not its placard number', () => {
    const [mapped] = sectionsOf([
      section('2025-08', [photo({ number: 7, title: 'Momo', r2Key: 'originals/momo.jpg' })]),
    ])
    expect(mapped?.figures[0]).toMatchObject({
      title: 'Momo',
      takenAt: '2025-08-31',
      r2Key: 'originals/momo.jpg',
      blurhash: null,
    })
    expect(mapped?.figures[0]).not.toHaveProperty('index')
  })

  it("builds the Exif line from the Photo's own facts", () => {
    const [mapped] = sectionsOf([section('2025-08', [photo()])])
    expect(mapped?.figures[0]?.exif).toBe('X-T20 · 25MM · F/2 · 1/500 · ISO 200 · 31 AUG')
  })

  it('leaves no Exif line for a Photo that carries none of the facts', () => {
    const bare = photo({
      aperture: null,
      shutter: null,
      iso: null,
      focalLength: null,
      metadata: {},
      takenAt: undefined,
    })
    const [mapped] = sectionsOf([section('2025-08', [bare])])
    // null, not an empty string: the view omits the element rather than
    // rendering a line with nothing in it.
    expect(mapped?.figures[0]?.exif).toBeNull()
  })

  it('snaps a Photo with no Ratio of its own to the nearest supported one', () => {
    // 3000x2000 measured is 1.5, which is 3:2 exactly.
    const [mapped] = sectionsOf([
      section('2025-08', [photo({ ratio: null, width: 3000, height: 2000 })]),
    ])
    expect(mapped?.figures[0]?.ratio).toBe('3:2')
  })

  it('snaps a measured frame to the Ratio nearest it, not the first one listed', () => {
    // 4000x3000 measured is 1.333, which is 4:3.
    const [mapped] = sectionsOf([
      section('2025-08', [photo({ ratio: null, width: 4000, height: 3000 })]),
    ])
    expect(mapped?.figures[0]?.ratio).toBe('4:3')
  })

  it('drops a Photo whose frame snaps to no supported Ratio', () => {
    // A square frame matches none of the six, which is why an upload refuses
    // it rather than inventing one.
    const [mapped] = sectionsOf([
      section('2025-08', [photo({ ratio: null, width: 1000, height: 1000 })]),
    ])
    expect(mapped).toBeUndefined()
  })

  it('drops a Month left with no drawable Photo', () => {
    const mapped = sectionsOf([
      section('2025-08', [photo({ ratio: null, width: 1000, height: 1000 })]),
    ])
    expect(mapped).toEqual([])
  })

  it('reads a takenAt carrying a time, which is how the upload stores one', () => {
    const [mapped] = sectionsOf([section('2025-08', [photo({ takenAt: '2025-08-11T14:27' })])])
    expect(mapped?.day).toBe(11)
    expect(mapped?.figures[0]?.exif).toContain('11 AUG')
  })

  it('groups a server month into newest-first capture days without merging different dates', () => {
    const mapped = sectionsOf([
      section('2025-08', [
        photo({ id: PhotoId.make('late'), takenAt: '2025-08-31', title: 'Late' }),
        photo({ id: PhotoId.make('same-day'), takenAt: '2025-08-31T13:00', title: 'Same day' }),
        photo({ id: PhotoId.make('earlier'), takenAt: '2025-08-04', title: 'Earlier' }),
      ]),
    ])
    expect(
      mapped.map(({ id, day, figures }) => ({
        id,
        day,
        titles: figures.map((figure) => figure.title),
      })),
    ).toEqual([
      { id: '2025-08-31', day: 31, titles: ['Late', 'Same day'] },
      { id: '2025-08-04', day: 4, titles: ['Earlier'] },
    ])
  })

  it('keeps an unusable date in an undated group instead of inventing a day', () => {
    const [mapped] = sectionsOf([section('2025-08', [photo({ takenAt: undefined })])])
    expect(mapped).toMatchObject({ id: '2025-08', day: null })
  })
})

// ---------------------------------------------------------------------------
// the Timeline
// ---------------------------------------------------------------------------

describe('timelineOf', () => {
  it('carries the read as Months and offers more while a cursor remains', () => {
    const timeline = timelineOf(read({ nextMonthCursor: '2025-07' }))
    expect(timeline.sections.map((section) => section.id)).toEqual(['2025-08-31'])
    expect(timeline.tail).toBe('more')
  })

  it('names no photo of its own — no lead, nothing pinned', () => {
    // The Timeline used to carry the newest photograph as a Page One photo and
    // the intro drew it as the site's cover photo. The Months are the whole
    // of the home page's read now, so every photograph is drawn as a photo in a
    // flow and none of them is ranked above the others.
    const timeline = timelineOf(read())
    expect(Object.keys(timeline).sort()).toEqual(['sections', 'tail'])
    expect(
      timeline.sections.flatMap((section) => section.figures).map((figure) => figure.id),
    ).toEqual([PhotoId.make('photo-1')])
  })

  it('is an honest empty timeline when nothing is published', () => {
    const timeline = timelineOf(read({ sections: [], nextMonthCursor: null }))
    expect(timeline.sections).toEqual([])
    expect(timeline.tail).toBe('empty')
  })
})

// ---------------------------------------------------------------------------
// photo bytes
// ---------------------------------------------------------------------------

describe('figureUrl', () => {
  it('serves the Photo’s small rendition out of R2 through the proxy', () => {
    const [mapped] = sectionsOf([section('2025-08', [photo({ id: PhotoId.make('lift') })])])
    const url = new URL(figureUrl(mapped!.figures[0]!), 'https://photo.elianiva.com')
    expect(url.pathname).toBe('/api/image/renditions%2Flift%2Fsmall.webp')
  })

  it('opens the preview rendition in the lightbox', () => {
    const [mapped] = sectionsOf([section('2025-08', [photo({ id: PhotoId.make('lift') })])])
    const url = new URL(figurePreviewUrl(mapped!.figures[0]!), 'https://photo.elianiva.com')
    expect(url.pathname).toBe('/api/image/renditions%2Flift%2Fpreview.webp')
  })
})

// ---------------------------------------------------------------------------
// photo → columns
// ---------------------------------------------------------------------------

describe('flowColumns', () => {
  const three = sectionsOf([
    section('2025-08', [
      photo({ id: PhotoId.make('a'), ratio: '2:3' }),
      photo({ id: PhotoId.make('b'), ratio: '16:9' }),
      photo({ id: PhotoId.make('c'), ratio: '3:2' }),
    ]),
  ])[0]!

  it('places every figure exactly once, and each column in reading order', () => {
    const columns = flowColumns(three.figures, 3)
    // Written out rather than compared against a sorted copy of the input: a
    // figure dropped and a figure placed twice both survive a set comparison,
    // and neither is visible in "the same ids, reordered".
    expect(columns.flat().map((figure) => figure.id)).toEqual(['a', 'b', 'c'])
    expect(columns.map((column) => column.map((figure) => figure.id))).toEqual([
      ['a'],
      ['b'],
      ['c'],
    ])
  })

  it('fills the shortest column first', () => {
    // A photo is 1 / ratio as tall as it is wide, so a 2:3 portrait costs 1.5
    // and a 16:9 landscape 0.5625: the landscape skips the column that just
    // filled up and opens the next.
    const [portrait, landscape] = three.figures.slice(0, 2)
    const columns = flowColumns([portrait!, landscape!], 3)
    expect(columns.map((column) => column.length)).toEqual([1, 1, 0])
    expect(columns[0]![0]!.id).toBe(portrait!.id)
    expect(columns[1]![0]!.id).toBe(landscape!.id)
  })

  it('balances the sections it is given', () => {
    const columns = flowColumns(three.figures, 3)
    const heights = columns.map((column) =>
      column.reduce((total, figure) => total + 1 / RATIO_VALUE[figure.ratio], 0),
    )
    // Greedy fill leaves the last photo short of a full column; what matters
    // is that no column is more than about one photo taller than another.
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1)
  })

  it('returns empty columns rather than throwing on no figures', () => {
    expect(flowColumns([], 3)).toEqual([[], [], []])
  })
})
