import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'

import { extractImageMeta, type ImageMeta } from './image-meta'
import { jpegWith, type ExifTags } from './testing/jpeg-fixture'

const meta = (tags: ExifTags): Promise<ImageMeta> =>
  Effect.runPromise(extractImageMeta(jpegWith(tags)))

/** `it.each` widens a literal tuple to `number[]`, so the rationals the TIFF
 *  wants are built here instead of written inline. */
const rational = (numerator: number, denominator: number): readonly [number, number] => [
  numerator,
  denominator,
]

/** A camera's full tag set, then the tables below take tags away from it. */
const shot: ExifTags = {
  make: 'FUJIFILM',
  model: 'X-T20',
  dateTimeOriginal: '2025:08:31 10:11:12',
  exposureTime: rational(1, 1000),
  fNumber: rational(8, 1),
  iso: 200,
  focalLength: rational(25, 1),
}

describe('extractImageMeta', () => {
  it('reads the frame, the capture day and the camera from the bytes', async () => {
    expect(await meta(shot)).toEqual({
      width: 400,
      height: 200,
      takenAt: '2025-08-31',
      camera: 'X-T20',
      aperture: 8,
      shutter: 0.001,
      iso: 200,
      focalLength: 25,
    })
  })

  it.each([
    ['aperture', { fNumber: undefined }, 'aperture'],
    ['shutter', { exposureTime: undefined }, 'shutter'],
    ['iso', { iso: undefined }, 'iso'],
    ['focal length', { focalLength: undefined }, 'focalLength'],
  ])('omits a %s the file does not carry', async (_name, dropped, field) => {
    const extracted = await meta({ ...shot, ...dropped })
    expect(field in extracted).toBe(false)
  })

  it('omits every optional fact for a file whose EXIF block is empty', async () => {
    expect(await meta({})).toEqual({ width: 400, height: 200 })
  })

  it.each([
    ['a zeroed f-number', { fNumber: rational(0, 1) }, 'aperture'],
    ['a zeroed ISO', { iso: 0 }, 'iso'],
    ['a zero exposure time', { exposureTime: rational(0, 1) }, 'shutter'],
    ['a zeroed focal length', { focalLength: rational(0, 1) }, 'focalLength'],
  ])('stores nothing for %s rather than a fake value', async (_name, patch, field) => {
    const extracted = await meta({ ...shot, ...patch })
    expect(field in extracted).toBe(false)
  })
})
