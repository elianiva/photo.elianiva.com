import { describe, expect, it } from 'vitest'

import { formatExifLine, type ExifFacts } from './exif'

/** A Photo carrying every fact the line can print. Every table below removes
 *  from this one fixture, so "all segments present" and "no segment left" are
 *  the same shape read two ways. */
const full: ExifFacts = {
  takenAt: '2025-08-31',
  aperture: 8,
  shutter: 0.001,
  iso: 200,
  focalLength: 25,
  metadata: { camera: 'X-T20' },
}

const ALL_SEGMENTS = 'X-T20 · 25MM · F/8 · 1/1000 · ISO 200 · 31 AUG'

const line = (patch: Partial<ExifFacts>): string | null => formatExifLine({ ...full, ...patch })

describe('formatExifLine', () => {
  it('prints every segment in the design order', () => {
    expect(formatExifLine(full)).toBe(ALL_SEGMENTS)
  })

  it.each([
    ['camera', { metadata: undefined }, '25MM · F/8 · 1/1000 · ISO 200 · 31 AUG'],
    ['focal length', { focalLength: undefined }, 'X-T20 · F/8 · 1/1000 · ISO 200 · 31 AUG'],
    ['aperture', { aperture: undefined }, 'X-T20 · 25MM · 1/1000 · ISO 200 · 31 AUG'],
    ['shutter', { shutter: undefined }, 'X-T20 · 25MM · F/8 · ISO 200 · 31 AUG'],
    ['iso', { iso: undefined }, 'X-T20 · 25MM · F/8 · 1/1000 · 31 AUG'],
    ['day', { takenAt: undefined }, 'X-T20 · 25MM · F/8 · 1/1000 · ISO 200'],
  ])('omits a missing %s and closes the gap it leaves', (_segment, patch, expected) => {
    expect(line(patch)).toBe(expected)
  })

  it.each([
    ['the last two', { iso: undefined, shutter: undefined }, 'X-T20 · 25MM · F/8 · 31 AUG'],
    [
      'the last four',
      { iso: undefined, shutter: undefined, takenAt: undefined, aperture: undefined },
      'X-T20 · 25MM',
    ],
    ['the first two', { metadata: undefined, takenAt: undefined }, '25MM · F/8 · 1/1000 · ISO 200'],
    [
      'everything but the day',
      {
        metadata: undefined,
        takenAt: undefined,
        focalLength: undefined,
        aperture: undefined,
        shutter: undefined,
        iso: undefined,
      },
      null,
    ],
  ])('leaves no dangling separator when %s are absent', (_run, patch, expected) => {
    expect(line(patch)).toBe(expected)
  })

  it('returns null when the Photo carries nothing to print', () => {
    expect(formatExifLine({})).toBeNull()
    expect(
      formatExifLine({
        takenAt: null,
        aperture: null,
        shutter: null,
        iso: null,
        focalLength: null,
        metadata: null,
      }),
    ).toBeNull()
  })

  it.each([
    ['a zero aperture', { aperture: 0 }, 'X-T20 · 25MM · 1/1000 · ISO 200 · 31 AUG'],
    ['a zero iso', { iso: 0 }, 'X-T20 · 25MM · F/8 · 1/1000 · 31 AUG'],
    ['a negative shutter', { shutter: -1 }, 'X-T20 · 25MM · F/8 · ISO 200 · 31 AUG'],
    ['a NaN focal length', { focalLength: Number.NaN }, 'X-T20 · F/8 · 1/1000 · ISO 200 · 31 AUG'],
    [
      'an infinite aperture',
      { aperture: Number.POSITIVE_INFINITY },
      'X-T20 · 25MM · 1/1000 · ISO 200 · 31 AUG',
    ],
    [
      'a whitespace-only camera',
      { metadata: { camera: '   ' } },
      '25MM · F/8 · 1/1000 · ISO 200 · 31 AUG',
    ],
    ['an unreadable date', { takenAt: 'not a date' }, 'X-T20 · 25MM · F/8 · 1/1000 · ISO 200'],
    ['a calendar-invalid date', { takenAt: '2025-02-30' }, 'X-T20 · 25MM · F/8 · 1/1000 · ISO 200'],
    ['a value no camera records', { aperture: 1e21 }, 'X-T20 · 25MM · 1/1000 · ISO 200 · 31 AUG'],
    [
      'a shutter below any real exposure',
      { shutter: 1e-320 },
      'X-T20 · 25MM · F/8 · ISO 200 · 31 AUG',
    ],
  ])('invents nothing: %s is dropped', (_case, patch, expected) => {
    expect(line(patch)).toBe(expected)
  })

  it('survives a hand-edited metadata blob that is not the shape the type claims', () => {
    const handEdited: ExifFacts = { metadata: JSON.parse('{"camera":42}') }

    expect(line({ metadata: handEdited.metadata })).toBe('25MM · F/8 · 1/1000 · ISO 200 · 31 AUG')
  })
})

describe('formatExifLine formatting', () => {
  it.each([
    [{ aperture: 0.95 }, 'X-T20 · 25MM · F/0.95 · 1/1000 · ISO 200 · 31 AUG'],
    [{ aperture: 0.7 }, 'X-T20 · 25MM · F/0.7 · 1/1000 · ISO 200 · 31 AUG'],
    [{ aperture: 1.4 }, 'X-T20 · 25MM · F/1.4 · 1/1000 · ISO 200 · 31 AUG'],
    [{ aperture: 2 }, 'X-T20 · 25MM · F/2 · 1/1000 · ISO 200 · 31 AUG'],
    [{ aperture: 5.6 }, 'X-T20 · 25MM · F/5.6 · 1/1000 · ISO 200 · 31 AUG'],
    [{ aperture: 11 }, 'X-T20 · 25MM · F/11 · 1/1000 · ISO 200 · 31 AUG'],
    [{ focalLength: 14 }, 'X-T20 · 14MM · F/8 · 1/1000 · ISO 200 · 31 AUG'],
    [{ focalLength: 23.5 }, 'X-T20 · 23.5MM · F/8 · 1/1000 · ISO 200 · 31 AUG'],
    [{ focalLength: 200 }, 'X-T20 · 200MM · F/8 · 1/1000 · ISO 200 · 31 AUG'],
    [{ iso: 6400 }, 'X-T20 · 25MM · F/8 · 1/1000 · ISO 6400 · 31 AUG'],
  ])('writes a lens number as the barrel does', (patch, expected) => {
    expect(line(patch)).toBe(expected)
  })

  it.each([
    [2, '2S'],
    [2.5, '2.5S'],
    [30, '30S'],
    [1 / 2, '1/2'],
    [1 / 3, '1/3'],
    [1 / 7, '1/7'],
    [1 / 60, '1/60'],
    [1 / 125, '1/125'],
    [1 / 8000, '1/8000'],
    [0.001, '1/1000'],
    [0.99999, '1S'],
    [0.7, '0.7S'],
    [0.3, '0.3S'],
    [0.4, '0.4S'],
  ])('writes the shutter speed for %s the way a camera is read', (shutter, expected) => {
    expect(line({ shutter })).toBe(`X-T20 · 25MM · F/8 · ${expected} · ISO 200 · 31 AUG`)
  })

  it.each([
    ['2025-01-01', '01 JAN'],
    ['2025-09-09', '09 SEP'],
    ['2024-02-29', '29 FEB'],
    ['2025-12-25T23:30:00Z', '25 DEC'],
    ['  2025-08-31  ', '31 AUG'],
  ])('prints the day and month of %s', (takenAt, expected) => {
    expect(formatExifLine({ takenAt })).toBe(expected)
  })

  it('uppercases the whole line', () => {
    expect(line({ metadata: { camera: 'Fujifilm x-t20' } })).toBe(
      'FUJIFILM X-T20 · 25MM · F/8 · 1/1000 · ISO 200 · 31 AUG',
    )
  })
})
