import { describe, expect, it } from 'vitest'
import { Schema as S } from 'effect'
import {
  PHOTO_RATIOS,
  PhotoRatio,
  PhotoWithTags,
  formatMeasuredRatio,
  hasJpegMagic,
  isJpegUpload,
  nearestRatio,
} from './photo'

/**
 * The same eight frames migration 0004's backfill test carries. They are the
 * contract between the SQL `CASE` that snaps a legacy row and `nearestRatio`
 * that snaps an upload, so a change to one of the two tolerances has to turn
 * red in both suites.
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
})

describe('formatMeasuredRatio', () => {
  it('reduces a frame to the shortest whole-number ratio', () => {
    expect(formatMeasuredRatio(3000, 3000)).toBe('1:1')
    expect(formatMeasuredRatio(6000, 4000)).toBe('3:2')
    expect(formatMeasuredRatio(4000, 6000)).toBe('2:3')
    expect(formatMeasuredRatio(1530, 1000)).toBe('153:100')
  })
})

describe('isJpegUpload', () => {
  it('accepts a real JPEG Content-Type whatever the name says', () => {
    expect(isJpegUpload('IMG_0001.JPG', 'image/jpeg')).toBe(true)
    expect(isJpegUpload('no-extension', 'image/jpeg')).toBe(true)
  })

  it('accepts an empty or generic type only with a jpeg name', () => {
    expect(isJpegUpload('photo.jpg', '')).toBe(true)
    expect(isJpegUpload('photo.JPEG', 'application/octet-stream')).toBe(true)
    expect(isJpegUpload('photo.png', '')).toBe(false)
    expect(isJpegUpload('photo.heic', '')).toBe(false)
  })

  it('rejects every other declared image type', () => {
    for (const mime of [
      'image/png',
      'image/webp',
      'image/avif',
      'image/heic',
      'image/heif',
      'image/tiff',
    ]) {
      expect(isJpegUpload('photo.jpg', mime)).toBe(false)
    }
  })
})

describe('hasJpegMagic', () => {
  it('recognises the SOI + first APPn lead byte', () => {
    expect(hasJpegMagic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true)
  })

  it('rejects a shorter buffer and every other signature', () => {
    expect(hasJpegMagic(new Uint8Array([0xff, 0xd8]))).toBe(false)
    // PNG, HEIC (ftyp box), TIFF little-endian.
    expect(hasJpegMagic(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false)
    expect(hasJpegMagic(new Uint8Array([0x49, 0x49, 0x2a, 0x00]))).toBe(false)
  })
})

describe('PhotoRatio', () => {
  it('decodes the six supported Ratios and nothing else', () => {
    for (const ratio of PHOTO_RATIOS) {
      expect(S.decodeSync(PhotoRatio)(ratio)).toBe(ratio)
    }
    expect(() => S.decodeUnknownSync(PhotoRatio)('5:4')).toThrow()
  })
})

describe('PhotoWithTags', () => {
  /** A row as the wire carries it: the Photo's own columns plus its Tag
   *  links, which is the payload every public and admin RPC answers with. */
  const wire = (patch: Record<string, unknown> = {}) => ({
    id: 'photo_1',
    slug: 'seed-photo-01',
    title: 'Seed Photo 01',
    r2Key: 'originals/photo_1-seed-photo-01.jpg',
    width: 1200,
    height: 800,
    takenAt: '2024-01-15',
    metadata: { caption: 'hello' },
    tags: [{ id: 'tag_kyoto', slug: 'kyoto', label: 'Kyoto', caption: null }],
    ...patch,
  })

  it('decodes a Photo and its Tags from the wire', () => {
    const decoded = S.decodeSync(PhotoWithTags)(wire())
    expect(decoded.slug).toBe('seed-photo-01')
    expect(decoded.tags?.[0]?.label).toBe('Kyoto')
  })

  it('leaves takenAt and the Tags absent rather than inventing them', () => {
    const decoded = S.decodeSync(PhotoWithTags)(
      wire({ takenAt: undefined, tags: undefined, metadata: {} }),
    )
    expect(decoded.takenAt).toBeUndefined()
    expect(decoded.tags).toBeUndefined()
  })
})
