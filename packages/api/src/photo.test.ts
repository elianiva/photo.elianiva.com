import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  clampLimit,
  decodeCursor,
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
})

describe('decodeCursor', () => {
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
