import { describe, expect, it } from 'vitest'

import type { FrontStats, PhotoWithTags, PublicSection } from '@photo/shared'
import { PhotoId } from '@photo/shared'

import {
  RATIO_VALUE,
  editionOf,
  flowColumns,
  frameCount,
  frameNo,
  frameNoShort,
  mastheadCount,
  plateUrl,
  sectionCount,
  sectionsOf,
  type FrontRead,
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

const stats = (over: Partial<FrontStats> = {}): FrontStats => ({
  number: 24,
  total: 19,
  latestTakenAt: '2025-08-31',
  volume: 'V',
  motto: 'photo.elianiva.com',
  siteSections: [],
  aboutCopy: null,
  ...over,
})

const read = (over: Partial<FrontRead> = {}): FrontRead => ({
  sections: [section('2025-08', [photo()])],
  nextSectionCursor: null,
  stats: stats(),
  ...over,
})

// ---------------------------------------------------------------------------
// placard lines
// ---------------------------------------------------------------------------

describe('frameNo', () => {
  it('pads the frame number to three digits', () => {
    expect(frameNo(24)).toBe('No. 024')
    expect(frameNo(7)).toBe('No. 007')
  })
})

describe('frameNoShort', () => {
  it('drops the prefix and keeps the three-digit pad', () => {
    expect(frameNoShort(24)).toBe('024')
    expect(frameNoShort(7)).toBe('007')
  })
})

describe('frameCount', () => {
  it('counts frames with no number range', () => {
    expect(frameCount(9)).toBe('09 FRAMES')
    expect(frameCount(10)).toBe('10 FRAMES')
  })

  it('uses the singular for one frame', () => {
    expect(frameCount(1)).toBe('01 FRAME')
  })
})

describe('sectionCount', () => {
  it('counts frames and spans the section indices', () => {
    const two = sectionsOf([section('2025-08', [photo({ number: 16 }), photo({ number: 23 })])])[0]!
    expect(sectionCount(two)).toBe('02 FRAMES · NO. 016–023')
  })

  it('uses the singular for a one-figure section', () => {
    const only = sectionsOf([section('2025-08', [photo({ number: 23 })])])[0]!
    expect(sectionCount(only)).toBe('01 FRAME · NO. 023–023')
  })
})

// ---------------------------------------------------------------------------
// the read model → plates
// ---------------------------------------------------------------------------

describe('sectionsOf', () => {
  it('names a section from its month key, not from its label', () => {
    const [mapped] = sectionsOf([section('2025-08', [photo()])])
    expect(mapped?.month).toBe('August')
    expect(mapped?.year).toBe('2025')
  })

  it('carries the Photo Number, the title and the R2 key onto the plate', () => {
    const [mapped] = sectionsOf([
      section('2025-08', [photo({ number: 7, title: 'Momo', r2Key: 'originals/momo.jpg' })]),
    ])
    expect(mapped?.figures[0]).toMatchObject({
      index: 7,
      title: 'Momo',
      r2Key: 'originals/momo.jpg',
    })
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

  it('drops a Section left with no drawable Photo', () => {
    const mapped = sectionsOf([
      section('2025-08', [photo({ ratio: null, width: 1000, height: 1000 })]),
    ])
    expect(mapped).toEqual([])
  })

  it('reads a takenAt carrying a time, which is how the upload stores one', () => {
    const [mapped] = sectionsOf([section('2025-08', [photo({ takenAt: '2026-06-11T14:27' })])])
    expect(mapped?.figures[0]?.exif).toContain('11 JUN')
  })
})

// ---------------------------------------------------------------------------
// the Edition
// ---------------------------------------------------------------------------

describe('mastheadCount', () => {
  it('words the volume, the number and the frame count', () => {
    expect(mastheadCount(editionOf(read()))).toEqual({
      volume: 'VOL. V — NO. 024',
      volumeMobile: 'NO. 024',
      issue: '19',
    })
  })

  it('numbers a site with no photographs from zero rather than from nothing', () => {
    const edition = editionOf(read({ sections: [], stats: stats({ number: null, total: 0 }) }))
    expect(mastheadCount(edition)).toEqual({
      volume: 'VOL. V — NO. 000',
      volumeMobile: 'NO. 000',
      issue: '0',
    })
  })
})

describe('editionOf', () => {
  it('takes the folio date from the newest published photograph', () => {
    const edition = editionOf(read({ stats: stats({ latestTakenAt: '2025-08-31' }) }))
    expect(edition.folioDate).toBe('SUNDAY, 31 AUGUST 2025')
    expect(edition.folioDateMobile).toBe('31 AUG 2025')
  })

  it('prints no date at all when nothing has been published', () => {
    const edition = editionOf(
      read({ sections: [], stats: stats({ number: null, total: 0, latestTakenAt: null }) }),
    )
    expect(edition.folioDate).toBe('')
    expect(edition.folioDateMobile).toBe('')
  })

  it('leads with the newest plate and offers more while a cursor remains', () => {
    const edition = editionOf(read({ nextSectionCursor: '2025-07' }))
    expect(edition.lead?.id).toBe('photo-1')
    expect(edition.tail).toEqual({ state: 'more', label: 'LOAD THE EARLIER EDITIONS' })
  })

  it('is an honest empty edition when nothing is published', () => {
    const edition = editionOf(
      read({
        sections: [],
        nextSectionCursor: null,
        stats: stats({ number: null, total: 0, latestTakenAt: null }),
      }),
    )
    expect(edition.lead).toBeNull()
    expect(edition.sections).toEqual([])
    expect(edition.headline).toBe('Nothing published yet.')
    expect(edition.tail.state).toBe('end')
  })

  it('names the months in the kicker oldest first, the order a reader meets them', () => {
    const edition = editionOf(
      read({
        sections: [
          section('2026-06', [photo()]),
          section('2026-05', [photo({ id: PhotoId.make('older') })]),
        ],
      }),
    )
    expect(edition.kicker).toBe('THIS EDITION · MAY 2026 AND JUNE 2026')
  })

  it('names one month in full rather than a bare year', () => {
    const edition = editionOf(read({ sections: [section('2026-06', [photo()])] }))
    expect(edition.kicker).toBe('THIS EDITION · JUNE 2026')
  })

  it('keeps the masthead numeral, so the volume is the site’s and not the read’s', () => {
    expect(editionOf(read({ stats: stats({ volume: 'IX' }) })).volume).toBe('IX')
  })
})

// ---------------------------------------------------------------------------
// plate bytes
// ---------------------------------------------------------------------------

describe('plateUrl', () => {
  it('serves the Photo’s own original out of R2 through the proxy', () => {
    const [mapped] = sectionsOf([section('2025-08', [photo({ r2Key: 'originals/lift.jpg' })])])
    const url = new URL(plateUrl(mapped!.figures[0]!), 'https://photo.elianiva.com')
    expect(url.pathname).toBe('/api/image/originals%2Flift.jpg')
  })
})

// ---------------------------------------------------------------------------
// plate → columns
// ---------------------------------------------------------------------------

describe('flowColumns', () => {
  const three = sectionsOf([
    section('2025-08', [
      photo({ id: PhotoId.make('a'), ratio: '2:3' }),
      photo({ id: PhotoId.make('b'), ratio: '16:9' }),
      photo({ id: PhotoId.make('c'), ratio: '3:2' }),
    ]),
  ])[0]!

  it('places every figure exactly once and keeps each column in reading order', () => {
    const columns = flowColumns(three.figures, 3)
    const placed = columns.flat().map((figure) => figure.id)
    expect([...placed].sort()).toEqual(three.figures.map((figure) => figure.id).sort())
    columns.forEach((column) => {
      const positions = column.map((figure) => three.figures.indexOf(figure))
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
    })
  })

  it('fills the shortest column first', () => {
    // A plate is 1 / ratio as tall as it is wide, so a 2:3 portrait costs 1.5
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
    // Greedy fill leaves the last plate short of a full column; what matters
    // is that no column is more than about one plate taller than another.
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1)
  })

  it('returns empty columns rather than throwing on no figures', () => {
    expect(flowColumns([], 3)).toEqual([[], [], []])
  })
})
