import { describe, expect, it } from 'vitest'
import { clampLimit, decodeCursor, encodeCursor, slugify } from './photo'

describe('photo helpers', () => {
  it('slugify basic', () => {
    expect(slugify(' Hello World! ')).toBe('hello-world')
    expect(slugify('')).toBe('untitled')
    expect(slugify('Kyoto 2024/Street')).toBe('kyoto-2024-street')
    expect(slugify('---')).toBe('untitled')
  })

  it('clampLimit defaults and caps', () => {
    expect(clampLimit(undefined)).toBe(60)
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(200)).toBe(100)
    expect(clampLimit(25.8)).toBe(25)
    expect(clampLimit(Number.NaN)).toBe(60)
  })

  it('cursor encode/decode round-trip', () => {
    const row = {
      id: 'photo_123',
      slug: 'a',
      title: 'A',
      r2Key: 'originals/a.jpg',
      width: 100,
      height: 100,
      takenAt: '2024-01-15',
      metadata: '{}',
    }
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test helper needs DbPhotoRow brand
    const cursor = encodeCursor(row as never)
    const decoded = decodeCursor(cursor)
    expect(decoded?.id).toBe('photo_123')
    expect(decoded?.takenAt).toBe('2024-01-15')
  })

  it('cursor with null takenAt', () => {
    const row = {
      id: 'photo_999',
      slug: 'b',
      title: 'B',
      r2Key: 'originals/b.jpg',
      width: 100,
      height: 100,
      takenAt: null,
      metadata: '{}',
    }
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const cursor = encodeCursor(row as never)
    expect(decodeCursor(cursor)?.takenAt).toBeNull()
    expect(decodeCursor(cursor)?.id).toBe('photo_999')
  })

  it('decodeCursor returns null on malformed', () => {
    expect(decodeCursor('not-base64!')).toBeNull()
    expect(decodeCursor(btoa('not-json'))).toBeNull()
    expect(decodeCursor(btoa(JSON.stringify({ takenAt: '2024-01-01' })))).toBeNull()
  })

  it('decodeCursor handles non-string takenAt as null', () => {
    const cursor = btoa(JSON.stringify({ takenAt: 12345, id: 'photo_1' }))
    expect(decodeCursor(cursor)?.takenAt).toBeNull()
  })
})
