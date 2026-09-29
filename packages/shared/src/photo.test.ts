import { describe, expect, it } from 'vitest'
import { Schema as S } from 'effect'
import { PHOTO_RATIOS, PhotoRatio, nearestRatio } from './photo'

/**
 * The same eight frames migration 0004's backfill test carries. They are the
 * contract between the SQL `CASE` that snaps a legacy row and `nearestRatio`
 * that snaps an upload, and `migrations.test.ts` runs both over this table so
 * a change to either one turns red.
 */
const RATIO_CASES: ReadonlyArray<{
  readonly id: string
  readonly width: number
  readonly height: number
  readonly ratio: PhotoRatio | null
}> = [
  { id: 'p3-2', width: 6000, height: 4000, ratio: '3:2' },
  { id: 'p2-3', width: 4000, height: 6000, ratio: '2:3' },
  { id: 'p4-3', width: 1024, height: 768, ratio: '4:3' },
  { id: 'p3-4', width: 768, height: 1024, ratio: '3:4' },
  { id: 'p16-9', width: 1920, height: 1080, ratio: '16:9' },
  { id: 'p9-16', width: 1080, height: 1920, ratio: '9:16' },
  // 6016x4000 is 1.504 against 3:2's 1.5 — inside the tolerance.
  { id: 'podd', width: 6016, height: 4000, ratio: '3:2' },
  // 3000x3000 matches none of the six, so nothing is invented.
  { id: 'psquare', width: 3000, height: 3000, ratio: null },
]

describe('nearestRatio', () => {
  it.each(RATIO_CASES)('snaps $width x $height to $ratio', ({ width, height, ratio }) => {
    expect(nearestRatio(width, height)).toBe(ratio)
  })

  it('snaps every supported Ratio back to itself, whatever the multiple', () => {
    for (const ratio of PHOTO_RATIOS) {
      const [numerator = 0, denominator = 1] = ratio.split(':').map(Number)
      for (const scale of [1, 7, 640, 4001]) {
        expect(nearestRatio(numerator * scale, denominator * scale)).toBe(ratio)
      }
    }
  })

  it('accepts inside the tolerance and rejects outside it', () => {
    // 1.51 is 0.01 from 3:2; 1.53 is 0.03, and 0.03 from nothing else.
    expect(nearestRatio(1510, 1000)).toBe('3:2')
    expect(nearestRatio(1530, 1000)).toBeNull()
    // The same pair portrait, where 1/1.53 is 0.654 — 0.013 from 2:3, inside.
    expect(nearestRatio(1000, 1510)).toBe('2:3')
    expect(nearestRatio(1000, 1570)).toBeNull()
  })

  it('rejects a frame it cannot measure', () => {
    expect(nearestRatio(0, 1000)).toBeNull()
    expect(nearestRatio(1000, 0)).toBeNull()
    expect(nearestRatio(-1000, 1000)).toBeNull()
    expect(nearestRatio(Number.NaN, 1000)).toBeNull()
    expect(nearestRatio(Number.POSITIVE_INFINITY, 1000)).toBeNull()
  })

  it('is pure: the same frame snaps the same way every time', () => {
    expect(nearestRatio(6016, 4000)).toBe(nearestRatio(6016, 4000))
  })
})

describe('PhotoRatio', () => {
  it('decodes the six supported Ratios and nothing else', () => {
    for (const ratio of PHOTO_RATIOS) {
      expect(S.decodeSync(PhotoRatio)(ratio)).toBe(ratio)
    }
    expect(() => S.decodeUnknownSync(PhotoRatio)('5:4')).toThrow()
  })

  it('orders the Ratios as the Filter Bar draws them', () => {
    expect([...PHOTO_RATIOS]).toEqual(['3:2', '2:3', '4:3', '3:4', '16:9', '9:16'])
  })
})
