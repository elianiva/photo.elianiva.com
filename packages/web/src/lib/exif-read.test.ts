import { describe, expect, it } from 'vitest'
import { factsOfExif } from './exif-read'

describe('factsOfExif', () => {
  it('lists what was read and has no problem when the capture date is there', () => {
    const read = factsOfExif({
      DateTimeOriginal: new Date(2026, 7, 31, 14, 22, 5),
      Model: 'X-T20',
      FNumber: 8,
      ISO: 200,
    })
    expect(read.facts).toEqual(['Camera X-T20', 'Aperture f/8', 'ISO 200', 'Taken 2026-08-31 14.22.05'])
    expect(read.problem).toBeUndefined()
  })

  it('says so when there is no EXIF at all', () => {
    expect(factsOfExif(undefined)).toEqual({ facts: [], problem: 'No EXIF block in this file' })
  })

  it('names a missing or unparseable capture date', () => {
    expect(factsOfExif({ Model: 'X-T20' }).problem).toMatch(/No capture date/)
    expect(factsOfExif({ DateTimeOriginal: '2026:99:99' }).problem).toMatch(/unreadable/)
  })
})
