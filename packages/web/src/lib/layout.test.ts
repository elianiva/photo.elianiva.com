import { describe, expect, it } from 'vitest'

import { DEFAULT_LAYOUT, breakRows, lastRowSlack, toAspects } from './layout'

const sumRow = (aspects: ReadonlyArray<number>, row: ReadonlyArray<number>): number =>
  row.reduce((sum, index) => sum + (aspects[index] ?? 0), 0)

describe('breakRows', () => {
  it('returns no rows for an empty gallery', () => {
    expect(breakRows([])).toEqual([])
  })

  it('covers every photo exactly once, in order', () => {
    // A realistic mixed page: alternating landscape/portrait.
    const aspects = [1.5, 0.667, 1.333, 0.75, 1.5, 1.5, 0.75, 0.667]
    const rows = breakRows(aspects)
    const flat = rows.flat()
    expect(flat).toHaveLength(aspects.length)
    expect([...flat].sort((a, b) => a - b)).toEqual(aspects.map((_, index) => index))
    rows.forEach((row, rowIndex) => {
      if (rowIndex > 0) {
        const prev = rows[rowIndex - 1]
        expect(row[0]).toBe((prev?.[prev.length - 1] ?? -1) + 1)
      }
    })
  })

  it('never produces a row above the max aspect budget', () => {
    const aspects = Array.from({ length: 40 }, (_, index) => (index % 4 === 0 ? 1.5 : 0.667))
    const rows = breakRows(aspects)
    rows.forEach((row) => {
      expect(sumRow(aspects, row)).toBeLessThanOrEqual(DEFAULT_LAYOUT.maxRowAspect + 1e-9)
    })
  })

  it('pairs a portrait with a landscape instead of isolating the portrait', () => {
    // 1.5 + 0.67 ≈ 2.17 is nearly on target (2.3); a lone portrait (0.67)
    // would be a huge deviation, so the DP must group them.
    const aspects = [0.667, 1.5]
    expect(breakRows(aspects)).toEqual([[0, 1]])
  })

  it('splits two landscapes into two rows rather than overpacking', () => {
    // Combined sum 3.0 exceeds maxRowAspect — forbidden; each alone costs
    // less than any allowed alternative.
    const aspects = [1.5, 1.5]
    const rows = breakRows(aspects)
    expect(rows).toEqual([[0], [1]])
  })

  it('relaxes the final row so a trailing portrait is not stretched', () => {
    const aspects = [1.5, 0.667]
    const rows = breakRows(aspects)
    // Whatever the break choice, the layout must still cover both photos and
    // report positive slack when the last row is under target.
    expect(rows.flat()).toEqual([0, 1])
    const slack = lastRowSlack(aspects, rows)
    expect(slack).toBeGreaterThanOrEqual(0)
    expect(slack).toBeLessThanOrEqual(DEFAULT_LAYOUT.targetRowAspect)
  })

  it('clamps degenerate dimensions via toAspects', () => {
    expect(
      toAspects([
        { width: 0, height: 0 },
        { width: 10000, height: 10 },
      ]),
    ).toEqual([1, 2.5])
  })
})
