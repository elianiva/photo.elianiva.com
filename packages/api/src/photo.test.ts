import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SORT,
  clampLimit,
  decodeCursor,
  encodeCursor,
  keysetWhere,
  orderBy,
  slugify,
} from './photo'

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

  it('sorts undated photos last, newest id first among them', () => {
    // The first level is "has no takenAt", so the empty string never has to be
    // judged against a date by the collation.
    expect(orderBy(DEFAULT_SORT)).toBe("(takenAt IS NULL) asc, COALESCE(takenAt, '') desc, id desc")
    expect(orderBy({ key: 'takenAt', direction: 'asc' })).toBe(
      "(takenAt IS NULL) asc, COALESCE(takenAt, '') asc, id asc",
    )
  })

  it('builds the keyset predicate from the same columns it orders by', () => {
    const key = [0, '2024-03-01', 'photo_b']
    expect(keysetWhere(DEFAULT_SORT, key)).toEqual({
      sql: "(((takenAt IS NULL) > ?) OR ((takenAt IS NULL) = ? AND COALESCE(takenAt, '') < ?) OR ((takenAt IS NULL) = ? AND COALESCE(takenAt, '') = ? AND id < ?))",
      // Six placeholders, six binds, in the order the query reads them.
      values: [0, 0, '2024-03-01', 0, '2024-03-01', 'photo_b'],
    })
    expect(keysetWhere({ key: 'takenAt', direction: 'asc' }, key).sql).toBe(
      "(((takenAt IS NULL) > ?) OR ((takenAt IS NULL) = ? AND COALESCE(takenAt, '') > ?) OR ((takenAt IS NULL) = ? AND COALESCE(takenAt, '') = ? AND id > ?))",
    )
  })
})

describe('cursor encode/decode', () => {
  const row = {
    id: 'photo_123',
    slug: 'a',
    title: 'A',
    r2Key: 'originals/a.jpg',
    width: 100,
    height: 100,
    status: 'published',
    number: 7,
    ratio: '3:2',
    bytes: 1024,
    takenAt: '2024-01-15',
    metadata: '{}',
    blurhash: null,
    deletedAt: null,
  }

  it('round-trips the sort key it was built on', () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test helper needs the branded row shape
    const cursor = encodeCursor(row as never, DEFAULT_SORT)
    expect(decodeCursor(cursor)).toEqual({
      sort: 'takenAt:desc',
      key: [0, '2024-01-15', 'photo_123'],
    })
  })

  it('round-trips an undated photo, whose first level sorts last', () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test helper needs the branded row shape
    const cursor = encodeCursor({ ...row, takenAt: null } as never, DEFAULT_SORT)
    expect(decodeCursor(cursor)?.key).toEqual([1, '', 'photo_123'])
  })

  it('names the direction, so a cursor from an ascending page is not this one', () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test helper needs the branded row shape
    const descending = decodeCursor(encodeCursor(row as never, DEFAULT_SORT))
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test helper needs the branded row shape
    const ascending = decodeCursor(encodeCursor(row as never, { key: 'takenAt', direction: 'asc' }))
    expect(descending?.sort).toBe('takenAt:desc')
    expect(ascending?.sort).toBe('takenAt:asc')
  })

  it('returns null on malformed input', () => {
    expect(decodeCursor('not-base64!')).toBeNull()
    expect(decodeCursor(btoa('not-json'))).toBeNull()
    expect(decodeCursor(btoa(JSON.stringify({ key: [] })))).toBeNull()
    expect(decodeCursor(btoa(JSON.stringify({ sort: 'takenAt:desc' })))).toBeNull()
    expect(decodeCursor(btoa(JSON.stringify({ sort: 'takenAt:desc', key: [{}] })))).toBeNull()
  })
})
