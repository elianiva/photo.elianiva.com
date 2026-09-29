import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  DEFAULT_SORT,
  clampLimit,
  decodeCursor,
  encodeCursor,
  filterWhere,
  keysetWhere,
  orderBy,
  slugify,
  type PhotoListFilter,
  type PhotoListPage,
  PhotoService,
} from './photo'
import { createPhoto, createTag, setPhotoStatus, trashPhoto } from './testing/fixtures'
import { makeTestHarness, withTestServices, type TestHarness } from './testing/harness'

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

  it('builds no filter clause at all for an unfiltered query', () => {
    // An empty filter has to collapse to nothing: the WHERE it is joined into
    // already has the audience predicate, and a dangling `AND` is not SQL.
    expect(filterWhere({})).toEqual({ sql: '', binds: [] })
    // A sort, a limit and a cursor are not filters either.
    expect(filterWhere({ sort: DEFAULT_SORT, limit: 7, cursor: 'abc' })).toEqual({
      sql: '',
      binds: [],
    })
  })

  it('binds a status and a ratio in the order the clauses name them', () => {
    expect(filterWhere({ status: 'draft' })).toEqual({ sql: 'status = ?', binds: ['draft'] })
    expect(filterWhere({ ratio: '2:3' })).toEqual({ sql: 'ratio = ?', binds: ['2:3'] })
    expect(filterWhere({ status: 'failed', ratio: '16:9' })).toEqual({
      sql: 'status = ? AND ratio = ?',
      binds: ['failed', '16:9'],
    })
  })

  it('names every tag in one any-of subquery, and ignores an empty list', () => {
    expect(filterWhere({ tagIds: ['tag_kyoto', 'tag_film'] })).toEqual({
      sql: 'id IN (SELECT photoId FROM photo_tags WHERE tagId IN (?, ?))',
      binds: ['tag_kyoto', 'tag_film'],
    })
    // An empty list is the same filter as no list, not a predicate that
    // matches nothing.
    expect(filterWhere({ tagIds: [] }).sql).toBe('')
  })

  it('binds q lowercased and LIKE-escaped, once per searched column', () => {
    expect(filterWhere({ q: 'Kyoto' })).toEqual({
      sql: "(LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(slug) LIKE ? ESCAPE '\\' OR LOWER(metadata) LIKE ? ESCAPE '\\')",
      binds: ['%kyoto%', '%kyoto%', '%kyoto%'],
    })
    // `%` and `_` are escaped so a search for `100%` cannot match every
    // title containing "100".
    expect(filterWhere({ q: '100%' }).binds).toEqual(['%100\\%%', '%100\\%%', '%100\\%%'])
    expect(filterWhere({ q: '  ' }).sql).toBe('')
  })

  it('keeps every clause and every bind in one order for the whole filter', () => {
    const filter: PhotoListFilter = {
      status: 'published',
      ratio: '3:2',
      tagIds: ['tag_kyoto'],
      q: 'Alley',
    }
    expect(filterWhere(filter)).toEqual({
      sql: "status = ? AND ratio = ? AND id IN (SELECT photoId FROM photo_tags WHERE tagId IN (?)) AND (LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(slug) LIKE ? ESCAPE '\\' OR LOWER(metadata) LIKE ? ESCAPE '\\')",
      binds: ['published', '3:2', 'tag_kyoto', '%alley%', '%alley%', '%alley%'],
    })
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

describe('PhotoService.count', () => {
  const count = (harness: TestHarness, filter: PhotoListFilter): Promise<number> =>
    Effect.runPromise(
      withTestServices(
        PhotoService.use((service) => service.count(filter)),
        harness,
      ),
    )

  const list = (harness: TestHarness, filter: PhotoListFilter): Promise<PhotoListPage> =>
    Effect.runPromise(
      withTestServices(
        PhotoService.use((service) => service.list(filter)),
        harness,
      ),
    )

  /** The service only omits `nextCursor` on a short page; a bare `?.` here would
   * let a regression fall through as "page one again" and pass. */
  const cursorOf = (page: PhotoListPage): string => {
    if (page.nextCursor === null) {
      throw new Error(`expected a nextCursor, got ${JSON.stringify(page.items)}`)
    }
    return page.nextCursor
  }

  it('counts the whole filtered set, not the page it is asked with', async () => {
    const harness = makeTestHarness()
    for (let index = 0; index < 5; index += 1) {
      await createPhoto(harness, {
        slug: `photo-${String(index)}`,
        title: `Photo ${String(index)}`,
        takenAt: '2024-05-01',
      })
    }

    // `1–2 OF 5`: the page is the limit, the count is the filter.
    const page = await list(harness, { limit: 2 })
    expect(page.items).toHaveLength(2)
    expect(await count(harness, { limit: 2 })).toBe(5)
  })

  it('is not moved by the cursor, which is a position rather than a filter', async () => {
    const harness = makeTestHarness()
    const months = ['2024-05-01', '2024-04-01', '2024-03-01']
    for (const [index, month] of months.entries()) {
      await createPhoto(harness, {
        slug: `photo-${String(index)}`,
        title: `Photo ${String(index)}`,
        takenAt: month,
      })
    }

    const first = await list(harness, { limit: 1 })
    const second = await list(harness, { limit: 1, cursor: cursorOf(first) })

    expect(first.items).toHaveLength(1)
    expect(second.items).toHaveLength(1)
    expect(await count(harness, {})).toBe(3)
    expect(await count(harness, { limit: 1 })).toBe(3)
    expect(await count(harness, { limit: 1, cursor: cursorOf(second) })).toBe(3)
  })

  it('counts under the same filters the page is paged with', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const film = await createTag(harness, 'film', 'Film')
    const draft = await createPhoto(harness, {
      slug: 'alley',
      title: 'Alley',
      takenAt: '2024-05-01',
      tagIds: [kyoto.id],
    })
    const otherDraft = await createPhoto(harness, {
      slug: 'temple',
      title: 'Temple',
      takenAt: '2024-04-01',
      tagIds: [film.id],
    })
    await createPhoto(harness, { slug: 'harbour', title: 'Harbour' })
    await setPhotoStatus(harness, draft.id, 'draft')
    await setPhotoStatus(harness, otherDraft.id, 'draft')

    expect(await count(harness, {})).toBe(3)
    expect(await count(harness, { status: 'draft' })).toBe(2)
    expect(await count(harness, { status: 'published' })).toBe(1)
    expect(await count(harness, { tagIds: [kyoto.id] })).toBe(1)
    expect(await count(harness, { status: 'draft', tagIds: [kyoto.id, film.id] })).toBe(2)
    expect(await count(harness, { q: 'alley' })).toBe(1)
    // Every seed lands at 3:2, so a ratio that names no Photo is a filter
    // that matched nothing rather than one that was ignored.
    expect(await count(harness, { ratio: '3:2' })).toBe(3)
    expect(await count(harness, { ratio: '2:3' })).toBe(0)
  })

  it('leaves a trashed photo out of the count, as it does out of every page', async () => {
    const harness = makeTestHarness()
    const kept = await createPhoto(harness, { slug: 'kept', title: 'Kept' })
    const binned = await createPhoto(harness, { slug: 'binned', title: 'Binned' })
    await trashPhoto(harness, binned.id)

    expect(await count(harness, {})).toBe(1)
    expect((await list(harness, {})).items.map((item) => item.id)).toEqual([kept.id])
  })

  it('is zero, not null, for a library nothing matches', async () => {
    const harness = makeTestHarness()

    expect(await count(harness, {})).toBe(0)
    expect(await count(harness, { q: 'nothing here' })).toBe(0)
  })
})
