import { describe, expect, it } from 'vitest'

import { RATIO_VALUE, edition, flowColumns, frameNo, plateUrl, sectionCount } from './content'

describe('frameNo', () => {
  it('pads the frame number to three digits', () => {
    expect(frameNo(24)).toBe('No. 024')
    expect(frameNo(7)).toBe('No. 007')
  })
})

describe('sectionCount', () => {
  it('counts frames and spans the section indices', () => {
    expect(sectionCount(edition.sections[0]!)).toBe('08 FRAMES · NO. 016–023')
    expect(sectionCount(edition.sections[1]!)).toBe('10 FRAMES · NO. 006–015')
  })

  it('uses the singular for a one-figure section', () => {
    const only = { ...edition.sections[0]!, figures: [edition.sections[0]!.figures[0]!] }
    expect(sectionCount(only)).toBe('01 FRAME · NO. 023–023')
  })
})

describe('plateUrl', () => {
  it('forces the plate ratio through imgix', () => {
    const url = new URL(plateUrl(edition.lead))
    expect(url.origin + url.pathname).toBe(
      `https://images.unsplash.com/photo-${edition.lead.photoId}`,
    )
    expect(url.searchParams.get('w')).toBe('1200')
    expect(url.searchParams.get('h')).toBe('800')
    expect(url.searchParams.get('fit')).toBe('crop')
  })

  it('crops a portrait plate taller than a landscape one', () => {
    const portrait = { ...edition.lead, ratio: '2:3' as const }
    expect(plateUrl(portrait)).toContain('h=1800')
  })
})

describe('flowColumns', () => {
  it('places every figure exactly once and keeps each column in reading order', () => {
    const section = edition.sections[1]!
    const columns = flowColumns(section.figures, 3)
    const placed = columns.flat().map((figure) => figure.id)
    expect([...placed].sort()).toEqual(section.figures.map((figure) => figure.id).sort())
    columns.forEach((column) => {
      const positions = column.map((figure) => section.figures.indexOf(figure))
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
    })
  })

  it('fills the shortest column first', () => {
    // A plate is 1 / ratio as tall as it is wide, so a 2:3 portrait costs 1.5
    // and a 16:9 landscape 0.5625: the landscape skips the column that just
    // filled up and opens the next.
    const [portrait, landscape] = edition.sections[0]!.figures.slice(0, 2)
    const columns = flowColumns([portrait!, landscape!], 3)
    expect(columns.map((column) => column.length)).toEqual([1, 1, 0])
    expect(columns[0]![0]!.id).toBe(portrait!.id)
    expect(columns[1]![0]!.id).toBe(landscape!.id)
  })

  it('balances the sections it is given', () => {
    const columns = flowColumns(edition.sections[0]!.figures, 3)
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
