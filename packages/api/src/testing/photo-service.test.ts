import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  InvalidInput,
  PhotoNotFound,
  SlugConflict,
  StorageError,
  type PhotoStatus,
  formatExifLine,
} from '@photo/shared'
import { Gateway } from '../gateway'

import {
  LINK_BIND_BUDGET,
  PhotoService,
  type PhotoListFilter,
  type PhotoListPage,
  type PhotoPresentationPatch,
  type PhotoSort,
  type PhotoUpdatePatch,
} from '../photo'
import {
  createPhoto,
  createTag,
  fail,
  JPEG_BYTES,
  PRESENTATION_DEFAULTS,
  type PhotoSeed,
} from './fixtures'
import { makeTestHarness, queryRow, queryRows, withTestServices, type TestHarness } from './harness'

const OLDEST_FIRST: PhotoSort = { key: 'takenAt', direction: 'asc' }

const list = (harness: TestHarness, filter: PhotoListFilter) =>
  Effect.runPromise(
    withTestServices(
      PhotoService.use((service) => service.list(filter)),
      harness,
    ),
  )

const get = (harness: TestHarness, id: string) =>
  Effect.runPromise(
    withTestServices(
      PhotoService.use((service) => service.get(id)),
      harness,
    ),
  )

const update = (harness: TestHarness, id: string, patch: PhotoUpdatePatch) =>
  Effect.runPromise(
    withTestServices(
      PhotoService.use((service) => service.update(id, patch)),
      harness,
    ),
  )

const setStatus = (harness: TestHarness, id: string, status: PhotoStatus) =>
  Effect.runPromise(
    withTestServices(
      PhotoService.use((service) => service.setStatus(id, status)),
      harness,
    ),
  )

const trash = (harness: TestHarness, id: string) =>
  Effect.runPromise(
    withTestServices(
      PhotoService.use((service) => service.trash(id)),
      harness,
    ),
  )

const restore = (harness: TestHarness, id: string) =>
  Effect.runPromise(
    withTestServices(
      PhotoService.use((service) => service.restore(id)),
      harness,
    ),
  )

const purge = (harness: TestHarness, id: string) =>
  Effect.runPromise(
    withTestServices(
      PhotoService.use((service) => service.purge(id)),
      harness,
    ),
  )

const counts = (harness: TestHarness) =>
  Effect.runPromise(
    withTestServices(
      PhotoService.use((service) => service.counts()),
      harness,
    ),
  )

const setPresentation = (harness: TestHarness, id: string, patch: PhotoPresentationPatch) =>
  Effect.runPromise(
    withTestServices(
      PhotoService.use((service) => service.setPresentation(id, patch)),
      harness,
    ),
  )

const addTags = (
  harness: TestHarness,
  photoIds: ReadonlyArray<string>,
  tagIds: ReadonlyArray<string>,
) =>
  Effect.runPromise(
    withTestServices(
      PhotoService.use((service) => service.addTags(photoIds, tagIds)),
      harness,
    ),
  )

const removeTags = (
  harness: TestHarness,
  photoIds: ReadonlyArray<string>,
  tagIds: ReadonlyArray<string>,
) =>
  Effect.runPromise(
    withTestServices(
      PhotoService.use((service) => service.removeTags(photoIds, tagIds)),
      harness,
    ),
  )

/** A photo's tag links as slugs, ordered by label: ids are UUIDs, so an
 *  assertion written over them is a coin toss. */
const linkedTagsOf = (harness: TestHarness, id: string): Promise<ReadonlyArray<string>> =>
  queryRows<{ slug: string }>(
    harness,
    (sql) =>
      sql`SELECT t.slug AS slug FROM photo_tags pt JOIN tags t ON t.id = pt.tagId
        WHERE pt.photoId = ${id} ORDER BY t.label`,
  ).then((rows) => rows.map((row) => row.slug))

/** How many Photos carry a Tag. The chunk tests need the total, because a
 *  per-row spot check cannot see a link that was written to the wrong id. */
const countLinks = (harness: TestHarness, tagId: string): Promise<number> =>
  queryRow<{ n: number }>(
    harness,
    (sql) => sql`SELECT COUNT(*) AS n FROM photo_tags WHERE tagId = ${tagId}`,
  ).then((row) => row?.n ?? 0)

/** The crop and mat columns, straight off the row: the assertion that the
 *  second save really left them alone. */
const presentationColumnsOf = (harness: TestHarness, id: string) =>
  queryRow<{
    cropX: number
    cropY: number
    cropScale: number
    level: number | null
    borderEnabled: number
    borderStyle: string | null
    borderColour: string | null
    borderWidth: number | null
  }>(
    harness,
    (sql) =>
      sql`SELECT cropX, cropY, cropScale, level, borderEnabled, borderStyle, borderColour, borderWidth
        FROM photos WHERE id = ${id}`,
  )

/** A bucket whose `put` fails, to exercise the rollback `create` owes. */
const withFailingPut = (harness: TestHarness): TestHarness => ({
  ...harness,
  gateway: Gateway.of({
    photos: {
      ...harness.photos,
      put: () => Promise.reject(new Error('R2 is unreachable')),
    },
  }),
})

const slugsIn = (harness: TestHarness): Promise<ReadonlyArray<string>> =>
  queryRows<{ slug: string }>(harness, (sql) => sql`SELECT slug FROM photos ORDER BY slug`).then(
    (rows) => rows.map((row) => row.slug),
  )

const numbersIn = (harness: TestHarness): Promise<ReadonlyArray<number | null>> =>
  queryRows<{ number: number | null }>(
    harness,
    (sql) => sql`SELECT number FROM photos ORDER BY number`,
  ).then((rows) => rows.map((row) => row.number))

const linkedPhotoIds = (harness: TestHarness): Promise<ReadonlyArray<string>> =>
  queryRows<{ photoId: string }>(
    harness,
    (sql) => sql`SELECT photoId FROM photo_tags ORDER BY photoId, tagId`,
  ).then((rows) => rows.map((row) => row.photoId))

const deletedAtOf = (harness: TestHarness, id: string): Promise<string | null> =>
  queryRow<{ deletedAt: string | null }>(
    harness,
    (sql) => sql`SELECT deletedAt FROM photos WHERE id = ${id}`,
  ).then((row) => row?.deletedAt ?? null)

/** The bytes behind an R2 key, or null when the key is empty. */
const bytesAt = async (harness: TestHarness, key: string): Promise<Uint8Array | null> => {
  const object = await harness.photos.get(key)
  if (object === null || object.body === null) return null
  return new Uint8Array(await new Response(object.body).arrayBuffer())
}

/** The service only omits `nextCursor` on a short page; a bare `?.` here would
 *  let a regression fall through as "page one again" and pass. */
const cursorOf = (page: PhotoListPage): string => {
  if (page.nextCursor === null) {
    throw new Error(`expected a nextCursor, got ${JSON.stringify(page.items)}`)
  }
  return page.nextCursor
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

interface PhotoRowSeed {
  readonly id: string
  readonly slug: string
  readonly takenAt?: string | null
  readonly width?: number
  readonly height?: number
  readonly status?: PhotoStatus
  readonly ratio?: string | null
  readonly deletedAt?: string | null
  readonly bytes?: number | null
  readonly tagIds?: ReadonlyArray<string>
}

/** Rows the service API cannot produce: a fixed id, an undated Photo, or a
 *  trashed one. */
const seedPhotoRow = async (harness: TestHarness, row: PhotoRowSeed): Promise<void> => {
  await queryRows(
    harness,
    (sql) =>
      sql`INSERT INTO photos (id, slug, title, r2Key, width, height, status, ratio, bytes, takenAt, metadata, blurhash, deletedAt)
        VALUES (${row.id}, ${row.slug}, ${row.slug}, ${`originals/${row.id}.jpg`},
                ${row.width ?? 1200}, ${row.height ?? 800}, ${row.status ?? 'published'},
                ${row.ratio === undefined ? '3:2' : row.ratio}, ${row.bytes ?? null},
                ${row.takenAt ?? null}, ${'{}'}, ${null}, ${row.deletedAt ?? null})`,
  )
  for (const tagId of row.tagIds ?? []) {
    await queryRows(
      harness,
      (sql) => sql`INSERT INTO photo_tags (photoId, tagId) VALUES (${row.id}, ${tagId})`,
    )
  }
}

const seed = (harness: TestHarness, seedValue: PhotoSeed) => createPhoto(harness, seedValue)

describe('PhotoService.list', () => {
  it('orders by takenAt descending, then by id descending', async () => {
    const harness = makeTestHarness()
    await seedPhotoRow(harness, { id: 'photo_a', slug: 'alpha', takenAt: '2024-03-01' })
    await seedPhotoRow(harness, { id: 'photo_b', slug: 'bravo', takenAt: '2024-03-01' })
    await seedPhotoRow(harness, { id: 'photo_c', slug: 'charlie', takenAt: '2024-01-01' })

    const page = await list(harness, {})

    expect(page.items.map((item) => item.id)).toEqual(['photo_b', 'photo_a', 'photo_c'])
    expect(page.items.map((item) => item.slug)).toEqual(['bravo', 'alpha', 'charlie'])
    expect(page.nextCursor).toBeNull()
  })

  it('sorts undated photos last, newest id first among them', async () => {
    const harness = makeTestHarness()
    await seedPhotoRow(harness, { id: 'photo_z', slug: 'zulu', takenAt: '2024-02-02' })
    await seedPhotoRow(harness, { id: 'photo_u1', slug: 'undated-one', takenAt: null })
    await seedPhotoRow(harness, { id: 'photo_u2', slug: 'undated-two' })

    const page = await list(harness, {})

    expect(page.items.map((item) => item.id)).toEqual(['photo_z', 'photo_u2', 'photo_u1'])
    expect(page.items.map((item) => item.takenAt)).toEqual(['2024-02-02', undefined, undefined])
  })

  it('sorts undated photos last ascending too, not first', async () => {
    const harness = makeTestHarness()
    await seedPhotoRow(harness, { id: 'photo_a', slug: 'a', takenAt: '2024-01-01' })
    await seedPhotoRow(harness, { id: 'photo_b', slug: 'b', takenAt: '2024-05-01' })
    await seedPhotoRow(harness, { id: 'photo_c', slug: 'c', takenAt: null })

    const page = await list(harness, { sort: OLDEST_FIRST })

    expect(page.items.map((item) => item.id)).toEqual(['photo_a', 'photo_b', 'photo_c'])
  })

  it('attaches each photo tags ordered by label, not by slug', async () => {
    const harness = makeTestHarness()
    const film = await createTag(harness, 'aaa', 'Film')
    const kyoto = await createTag(harness, 'zzz', 'Kyoto')
    const alley = await createTag(harness, 'mmm', 'Alley')
    await seed(harness, {
      slug: 'sunset',
      title: 'Sunset',
      takenAt: '2024-05-01',
      tagIds: [film.id, kyoto.id, alley.id],
    })
    await seed(harness, { slug: 'untagged', title: 'Untagged', takenAt: '2024-04-01' })

    const page = await list(harness, {})

    expect(page.items[0]?.tags).toEqual([
      { id: alley.id, slug: 'mmm', label: 'Alley', caption: null },
      { id: film.id, slug: 'aaa', label: 'Film', caption: null },
      { id: kyoto.id, slug: 'zzz', label: 'Kyoto', caption: null },
    ])
    expect(page.items[1]?.tags).toEqual([])
  })

  it('narrows to the photos carrying any of the given tags', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const film = await createTag(harness, 'film', 'Film')
    const night = await createTag(harness, 'night', 'Night')
    const tagged = await seed(harness, {
      slug: 'temple',
      title: 'Temple',
      takenAt: '2024-05-01',
      tagIds: [kyoto.id, film.id],
    })
    await seed(harness, {
      slug: 'harbour',
      title: 'Harbour',
      takenAt: '2024-04-01',
      tagIds: [film.id],
    })
    const alsoTagged = await seed(harness, {
      slug: 'alley',
      title: 'Alley',
      takenAt: '2024-03-01',
      tagIds: [night.id],
    })
    await seed(harness, { slug: 'untagged', title: 'Untagged', takenAt: '2024-02-01' })

    expect((await list(harness, { tagIds: [kyoto.id] })).items.map((item) => item.id)).toEqual([
      tagged.id,
    ])
    expect(
      (await list(harness, { tagIds: [kyoto.id, night.id] })).items.map((item) => item.id),
    ).toEqual([tagged.id, alsoTagged.id])
    expect(
      (await list(harness, { tagIds: [film.id] })).items[0]?.tags?.map((tag) => tag.slug),
    ).toEqual(['film', 'kyoto'])
  })

  it('returns nothing for a tag nobody carries', async () => {
    const harness = makeTestHarness()
    const film = await createTag(harness, 'film', 'Film')
    await seed(harness, { slug: 'temple', title: 'Temple', tagIds: [film.id] })

    const page = await list(harness, { tagIds: ['tag_nowhere'] })

    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeNull()
  })

  it('narrows to a status', async () => {
    const harness = makeTestHarness()
    const draft = await seed(harness, { slug: 'draft', title: 'Draft' })
    const published = await seed(harness, { slug: 'published', title: 'Published' })
    await setStatus(harness, draft.id, 'draft')
    await setStatus(harness, published.id, 'failed')

    expect((await list(harness, { status: 'draft' })).items.map((item) => item.id)).toEqual([
      draft.id,
    ])
    expect((await list(harness, { status: 'failed' })).items.map((item) => item.id)).toEqual([
      published.id,
    ])
    expect((await list(harness, { status: 'published' })).items).toEqual([])
  })

  it('narrows to a ratio', async () => {
    const harness = makeTestHarness()
    await seedPhotoRow(harness, { id: 'photo_tall', slug: 'tall', ratio: '2:3' })
    await seedPhotoRow(harness, { id: 'photo_wide', slug: 'wide', ratio: '16:9' })
    await seedPhotoRow(harness, { id: 'photo_unset', slug: 'unset', ratio: null })

    expect((await list(harness, { ratio: '2:3' })).items.map((item) => item.id)).toEqual([
      'photo_tall',
    ])
    expect((await list(harness, { ratio: '9:16' })).items).toEqual([])
  })

  it('combines a status, a ratio and a tag', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const wanted = await seed(harness, { slug: 'wanted', title: 'Wanted', tagIds: [kyoto.id] })
    await setStatus(harness, wanted.id, 'draft')
    await seed(harness, { slug: 'other-status', title: 'Other', tagIds: [kyoto.id] })
    await seed(harness, { slug: 'other-tag', title: 'Other tag', tagIds: [] })

    const page = await list(harness, { status: 'draft', ratio: '3:2', tagIds: [kyoto.id] })

    expect(page.items.map((item) => item.id)).toEqual([wanted.id])
  })

  it('matches q case-insensitively against title, slug and metadata', async () => {
    const harness = makeTestHarness()
    const hit = await seed(harness, {
      slug: 'sunset-over-kyoto',
      title: 'Sunset Over Kyoto',
      metadata: '{"camera":"Ricoh GR III"}',
    })
    await seed(harness, {
      slug: 'harbour-dawn',
      title: 'Harbour Dawn',
      metadata: '{"camera":"Fujifilm X100V"}',
    })

    const byTitle = await list(harness, { q: 'OVER KYOTO' })
    expect(byTitle.items.map((item) => item.id)).toEqual([hit.id])

    const bySlug = await list(harness, { q: 'sunset-over' })
    expect(bySlug.items.map((item) => item.id)).toEqual([hit.id])

    const byMetadata = await list(harness, { q: 'ricoh gr iii' })
    expect(byMetadata.items.map((item) => item.id)).toEqual([hit.id])

    const noMatch = await list(harness, { q: 'nothing here' })
    expect(noMatch.items).toEqual([])
  })

  it('reads LIKE wildcards in q as literal characters', async () => {
    const harness = makeTestHarness()
    const percent = await seed(harness, { slug: 'exposure', title: 'Exposure 100%' })
    await seed(harness, { slug: 'long-exposure', title: 'Exposure 1000' })
    const underscore = await seed(harness, { slug: 'street', title: 'A_B street' })
    await seed(harness, { slug: 'alley', title: 'A X B street' })

    // Unescaped, `%` matches the empty string after "100" and `A_B` matches
    // "A X B", so both searches would return the rows they must not.
    expect((await list(harness, { q: '100%' })).items.map((item) => item.id)).toEqual([percent.id])
    expect((await list(harness, { q: 'a_b' })).items.map((item) => item.id)).toEqual([
      underscore.id,
    ])
  })

  it('walks the whole gallery by cursor without overlap', async () => {
    const harness = makeTestHarness()
    await seed(harness, { slug: 'one', title: 'One', takenAt: '2024-05-01' })
    await seed(harness, { slug: 'two', title: 'Two', takenAt: '2024-04-01' })
    await seed(harness, { slug: 'three', title: 'Three', takenAt: '2024-03-01' })
    await seed(harness, { slug: 'four', title: 'Four', takenAt: '2024-02-01' })
    await seed(harness, { slug: 'five', title: 'Five', takenAt: '2024-01-01' })

    const first = await list(harness, { limit: 2 })
    expect(first.items.map((item) => item.slug)).toEqual(['one', 'two'])

    const second = await list(harness, { limit: 2, cursor: cursorOf(first) })
    expect(second.items.map((item) => item.slug)).toEqual(['three', 'four'])

    const third = await list(harness, { limit: 2, cursor: cursorOf(second) })
    expect(third.items.map((item) => item.slug)).toEqual(['five'])
    expect(third.nextCursor).toBeNull()
  })

  it('pages across the takenAt IS NULL tail', async () => {
    const harness = makeTestHarness()
    await seedPhotoRow(harness, { id: 'photo_1', slug: 'p1', takenAt: '2024-06-01' })
    await seedPhotoRow(harness, { id: 'photo_2', slug: 'p2', takenAt: '2024-05-01' })
    await seedPhotoRow(harness, { id: 'photo_3', slug: 'p3', takenAt: '2024-04-01' })
    await seedPhotoRow(harness, { id: 'photo_u1', slug: 'pu1', takenAt: null })
    await seedPhotoRow(harness, { id: 'photo_u2', slug: 'pu2', takenAt: null })

    const first = await list(harness, { limit: 2 })
    expect(first.items.map((item) => item.id)).toEqual(['photo_1', 'photo_2'])

    const second = await list(harness, { limit: 2, cursor: cursorOf(first) })
    expect(second.items.map((item) => item.id)).toEqual(['photo_3', 'photo_u2'])

    const third = await list(harness, { limit: 2, cursor: cursorOf(second) })
    expect(third.items.map((item) => item.id)).toEqual(['photo_u1'])
    expect(third.nextCursor).toBeNull()
  })

  it('pages oldest first just as exactly', async () => {
    const harness = makeTestHarness()
    await seedPhotoRow(harness, { id: 'photo_1', slug: 'p1', takenAt: '2024-06-01' })
    await seedPhotoRow(harness, { id: 'photo_2', slug: 'p2', takenAt: '2024-05-01' })
    await seedPhotoRow(harness, { id: 'photo_3', slug: 'p3', takenAt: '2024-04-01' })
    await seedPhotoRow(harness, { id: 'photo_4', slug: 'p4', takenAt: '2024-03-01' })
    await seedPhotoRow(harness, { id: 'photo_5', slug: 'p5', takenAt: null })

    const first = await list(harness, { limit: 2, sort: OLDEST_FIRST })
    expect(first.items.map((item) => item.id)).toEqual(['photo_4', 'photo_3'])

    const second = await list(harness, { limit: 2, sort: OLDEST_FIRST, cursor: cursorOf(first) })
    expect(second.items.map((item) => item.id)).toEqual(['photo_2', 'photo_1'])

    const third = await list(harness, { limit: 2, sort: OLDEST_FIRST, cursor: cursorOf(second) })
    expect(third.items.map((item) => item.id)).toEqual(['photo_5'])
    expect(third.nextCursor).toBeNull()
  })

  it('refuses a cursor cut under another sort', async () => {
    const harness = makeTestHarness()
    await seed(harness, { slug: 'one', title: 'One', takenAt: '2024-05-01' })
    await seed(harness, { slug: 'two', title: 'Two', takenAt: '2024-04-01' })
    const first = await list(harness, { limit: 1 })

    const error = await fail(
      withTestServices(
        PhotoService.use((service) =>
          service.list({ limit: 1, sort: OLDEST_FIRST, cursor: cursorOf(first) }),
        ),
        harness,
      ),
    )

    expect(error).toBeInstanceOf(InvalidInput)
    expect(error.message).toContain('takenAt:desc')
  })

  it('refuses a cursor whose key is the wrong length', async () => {
    const harness = makeTestHarness()
    await seed(harness, { slug: 'one', title: 'One', takenAt: '2024-05-01' })
    const short = btoa(JSON.stringify({ sort: 'takenAt:desc', key: ['2024-05-01'] }))

    // Three sort levels, one value: binding it would fail inside the query and
    // come back as a StorageError rather than as the caller mistake it is.
    expect(
      await fail(
        withTestServices(
          PhotoService.use((service) => service.list({ limit: 1, cursor: short })),
          harness,
        ),
      ),
    ).toBeInstanceOf(InvalidInput)
  })

  it('treats a malformed cursor as no cursor at all', async () => {
    const harness = makeTestHarness()
    await seed(harness, { slug: 'one', title: 'One', takenAt: '2024-05-01' })

    const page = await list(harness, { cursor: 'not-base64!' })

    expect(page.items.map((item) => item.slug)).toEqual(['one'])
  })

  it('leaves a trashed photo out of every page', async () => {
    const harness = makeTestHarness()
    const kept = await seed(harness, { slug: 'kept', title: 'Kept', takenAt: '2024-05-01' })
    const binned = await seed(harness, { slug: 'binned', title: 'Binned', takenAt: '2024-04-01' })
    await trash(harness, binned.id)

    const page = await list(harness, { limit: 10 })

    expect(page.items.map((item) => item.id)).toEqual([kept.id])
    expect(page.nextCursor).toBeNull()
  })

  it('loads tags for a page wider than the chunked IN list', async () => {
    const harness = makeTestHarness()
    const film = await createTag(harness, 'film', 'Film')
    for (let index = 0; index < 81; index += 1) {
      await seedPhotoRow(harness, { id: `photo_${String(index)}`, slug: `p${index}` })
    }
    await queryRows(
      harness,
      (sql) =>
        sql`INSERT INTO photo_tags (photoId, tagId) SELECT photos.id, ${film.id} FROM photos`,
    )

    const page = await list(harness, { limit: 100 })

    expect(page.items).toHaveLength(81)
    expect(page.items.every((item) => item.tags?.[0]?.id === film.id)).toBe(true)
  })
})

describe('PhotoService.get', () => {
  it('returns the photo with its tags and its lifecycle fields', async () => {
    const harness = makeTestHarness()
    const tag = await createTag(harness, 'kyoto', 'Kyoto')
    const created = await seed(harness, {
      slug: 'sunset-over-kyoto',
      title: 'Sunset over Kyoto',
      r2Key: 'originals/kyoto-1.jpg',
      takenAt: '2024-04-01',
      metadata: '{"caption":"Golden hour","location":"Kyoto"}',
      tagIds: [tag.id],
    })

    expect(await get(harness, created.id)).toEqual({
      id: created.id,
      slug: 'sunset-over-kyoto',
      title: 'Sunset over Kyoto',
      r2Key: 'originals/kyoto-1.jpg',
      width: 1200,
      height: 800,
      status: 'published',
      number: 1,
      ratio: '3:2',
      bytes: 4,
      takenAt: '2024-04-01',
      metadata: { caption: 'Golden hour', location: 'Kyoto' },
      blurhash: null,
      aperture: null,
      shutter: null,
      iso: null,
      focalLength: null,
      tags: [{ id: tag.id, slug: 'kyoto', label: 'Kyoto', caption: null }],
    })
  })

  it('fails with PhotoNotFound for one that is gone and for one in the Trash', async () => {
    const harness = makeTestHarness()
    const binned = await seed(harness, { slug: 'sunset', title: 'Sunset' })
    await trash(harness, binned.id)

    // Every method in this layer resolves its Photo through the one guard in
    // `photo.ts`, so this is where that guard is asserted: an id no row carries
    // and a row the soft delete has hidden are the same answer, carrying the id
    // the caller asked about.
    for (const id of ['missing', binned.id]) {
      const error = await fail(
        withTestServices(
          PhotoService.use((service) => service.get(id)),
          harness,
        ),
      )

      expect(error).toEqual(new PhotoNotFound({ id }))
    }
  })
})

describe('PhotoService.create', () => {
  it('stores the bytes under r2Key, inserts the row and links the tags', async () => {
    const harness = makeTestHarness()
    const tag = await createTag(harness, 'kyoto', 'Kyoto')

    const created = await seed(harness, {
      slug: 'Sunset Over Kyoto!',
      title: 'Sunset over Kyoto',
      r2Key: 'originals/kyoto-1.webp',
      takenAt: '2024-04-01',
      metadata: '{"caption":"Golden hour"}',
      blurhash: 'LEHV6nWB2',
      contentType: 'image/webp',
      tagIds: [tag.id],
    })

    expect(created).toEqual({
      id: created.id,
      slug: 'sunset-over-kyoto',
      r2Key: 'originals/kyoto-1.webp',
    })
    expect(created.id).toMatch(UUID)

    const stored = await harness.photos.get('originals/kyoto-1.webp')
    expect(stored?.key).toBe('originals/kyoto-1.webp')
    expect(stored?.httpMetadata?.contentType).toBe('image/webp')
    expect(stored?.size).toBe(4)

    expect(await get(harness, created.id)).toEqual({
      id: created.id,
      slug: 'sunset-over-kyoto',
      title: 'Sunset over Kyoto',
      r2Key: 'originals/kyoto-1.webp',
      width: 1200,
      height: 800,
      status: 'published',
      number: 1,
      ratio: '3:2',
      bytes: 4,
      takenAt: '2024-04-01',
      metadata: { caption: 'Golden hour' },
      blurhash: 'LEHV6nWB2',
      aperture: null,
      shutter: null,
      iso: null,
      focalLength: null,
      tags: [{ id: tag.id, slug: 'kyoto', label: 'Kyoto', caption: null }],
    })
  })

  it('numbers photos from one, in the order they arrive', async () => {
    const harness = makeTestHarness()

    await seed(harness, { slug: 'one', title: 'One' })
    await seed(harness, { slug: 'two', title: 'Two' })
    const third = await seed(harness, { slug: 'three', title: 'Three' })

    expect((await get(harness, third.id)).number).toBe(3)
    expect(await numbersIn(harness)).toEqual([1, 2, 3])
  })

  it('gives two concurrent uploads distinct numbers', async () => {
    const harness = makeTestHarness()

    // The counter is bumped and spent in one transaction, so the two inserts
    // serialise. A read-then-write (SELECT MAX, then INSERT) is what this
    // locks out: it interleaves at the read and both uploads get number 1.
    await Promise.all([
      seed(harness, { slug: 'one', title: 'One' }),
      seed(harness, { slug: 'two', title: 'Two' }),
      seed(harness, { slug: 'three', title: 'Three' }),
    ])

    expect(await numbersIn(harness)).toEqual([1, 2, 3])
  })

  it('never reuses a number, not after a trash and not after a purge', async () => {
    const harness = makeTestHarness()
    const first = await seed(harness, { slug: 'one', title: 'One' })
    const second = await seed(harness, { slug: 'two', title: 'Two' })

    await trash(harness, first.id)
    const trashedButNumbered = await seed(harness, { slug: 'three', title: 'Three' })
    expect((await get(harness, trashedButNumbered.id)).number).toBe(3)

    // The row is gone now. MAX(number) would hand its serial to the next
    // upload, and #20 serves `No. 004` by number.
    await trash(harness, second.id)
    await purge(harness, second.id)
    const afterPurge = await seed(harness, { slug: 'four', title: 'Four' })

    expect((await get(harness, afterPurge.id)).number).toBe(4)
    expect(await numbersIn(harness)).toEqual([1, 3, 4])
  })

  it('snaps the ratio on the way in and records the bytes and mime', async () => {
    const harness = makeTestHarness()

    const landscape = await seed(harness, { slug: 'landscape', title: 'Landscape' })
    expect((await get(harness, landscape.id)).ratio).toBe('3:2')

    const portrait = await seed(harness, {
      slug: 'portrait',
      title: 'Portrait',
      width: 4000,
      height: 6000,
    })
    expect((await get(harness, portrait.id)).ratio).toBe('2:3')

    const row = await queryRow<{ ratio: string | null; bytes: number | null; mime: string | null }>(
      harness,
      (sql) => sql`SELECT ratio, bytes, mime FROM photos WHERE id = ${landscape.id}`,
    )
    expect(row).toEqual({ ratio: '3:2', bytes: 4, mime: 'image/jpeg' })
  })

  it('refuses a frame that matches none of the six, before it reaches R2', async () => {
    const harness = makeTestHarness()

    const error = await fail(
      withTestServices(
        PhotoService.use((service) =>
          service.create({
            slug: 'square',
            title: 'Square',
            r2Key: 'originals/square.jpg',
            width: 3000,
            height: 3000,
            metadata: '{}',
            contentType: 'image/jpeg',
            bytes: JPEG_BYTES(),
            tagIds: [],
          }),
        ),
        harness,
      ),
    )

    // The reason the failed Upload Item prints, in the server's own words.
    expect(error).toEqual(new InvalidInput({ message: 'Unsupported ratio 1:1' }))
    // A rejected frame costs zero storage: no row, no tag link, no R2 object.
    expect(await slugsIn(harness)).toEqual([])
    expect(await harness.photos.head('originals/square.jpg')).toBeNull()
    expect(await linkedPhotoIds(harness)).toEqual([])
  })

  it('honours the upload dialog: a draft status and the Settings export defaults', async () => {
    const harness = makeTestHarness()

    const created = await Effect.runPromise(
      withTestServices(
        PhotoService.use((service) =>
          service.create({
            slug: 'draft-upload',
            title: 'Draft upload',
            r2Key: 'originals/draft-upload.jpg',
            width: 1200,
            height: 800,
            status: 'draft',
            exportDefaults: {
              previewLongEdge: 1600,
              previewFormat: 'webp',
              previewQuality: 70,
              fullQuality: 80,
              keepExif: false,
              removeGps: false,
            },
            metadata: '{}',
            contentType: 'image/jpeg',
            bytes: JPEG_BYTES(),
            tagIds: [],
          }),
        ),
        harness,
      ),
    )

    const row = await queryRow<{
      status: string
      previewLongEdge: number
      previewFormat: string
      previewQuality: number
      fullQuality: number
      keepExif: number
      removeGps: number
    }>(
      harness,
      (sql) =>
        sql`SELECT status, previewLongEdge, previewFormat, previewQuality, fullQuality, keepExif, removeGps
          FROM photos WHERE id = ${created.id}`,
    )

    expect(row).toEqual({
      status: 'draft',
      previewLongEdge: 1600,
      previewFormat: 'webp',
      previewQuality: 70,
      fullQuality: 80,
      keepExif: 0,
      removeGps: 0,
    })
  })

  it('defaults the content type to image/jpeg when none is given', async () => {
    const harness = makeTestHarness()

    const created = await seed(harness, { slug: 'plain', title: 'Plain' })

    expect((await harness.photos.head(created.r2Key))?.httpMetadata?.contentType).toBe('image/jpeg')
    const row = await queryRow<{ mime: string }>(
      harness,
      (sql) => sql`SELECT mime FROM photos WHERE id = ${created.id}`,
    )
    expect(row?.mime).toBe('image/jpeg')
  })

  it('stores the extracted EXIF facts and reads them back', async () => {
    const harness = makeTestHarness()

    const created = await seed(harness, {
      slug: 'exif',
      title: 'Exif',
      takenAt: '2025-08-31',
      aperture: 8,
      shutter: 1 / 1000,
      iso: 200,
      focalLength: 25,
    })

    const stored = await get(harness, created.id)
    expect(stored.aperture).toBe(8)
    expect(stored.shutter).toBe(0.001)
    expect(stored.iso).toBe(200)
    expect(stored.focalLength).toBe(25)
    expect(formatExifLine(stored)).toBe('25MM · F/8 · 1/1000 · ISO 200 · 31 AUG')
  })

  it('leaves the EXIF facts null when the original carried none', async () => {
    const harness = makeTestHarness()

    const created = await seed(harness, { slug: 'bare', title: 'Bare', takenAt: '2025-08-31' })

    const stored = await get(harness, created.id)
    expect(stored.aperture).toBeNull()
    expect(stored.shutter).toBeNull()
    expect(stored.iso).toBeNull()
    expect(stored.focalLength).toBeNull()
    expect(formatExifLine(stored)).toBe('31 AUG')
  })

  it('suffixes a slug already taken instead of failing', async () => {
    const harness = makeTestHarness()
    const first = await seed(harness, { slug: 'sunset', title: 'Sunset' })

    const second = await seed(harness, { slug: 'Sunset', title: 'Sunset again' })

    expect(second.slug).toMatch(/^sunset-[0-9a-f]{8}$/)
    expect(second.slug).not.toBe(first.slug)
    expect(second.id).not.toBe(first.id)
    expect((await get(harness, first.id)).slug).toBe('sunset')
    expect((await get(harness, second.id)).slug).toBe(second.slug)
    expect(await slugsIn(harness)).toHaveLength(2)
  })

  it('refuses a slug a trashed photo still holds', async () => {
    const harness = makeTestHarness()
    const binned = await seed(harness, { slug: 'sunset', title: 'Sunset' })
    await trash(harness, binned.id)

    const second = await seed(harness, { slug: 'Sunset', title: 'Sunset again' })

    // Not a reuse: restoring the trashed Photo would hand two Photos one slug.
    expect(second.slug).not.toBe('sunset')
    expect(second.slug).toMatch(/^sunset-[0-9a-f]{8}$/)
  })

  it('leaves the pre-existing original intact when the r2Key is taken', async () => {
    const harness = makeTestHarness()
    const first = await seed(harness, { slug: 'one', title: 'One', r2Key: 'shared.jpg' })
    const original = await bytesAt(harness, 'shared.jpg')

    const error = await fail(
      withTestServices(
        PhotoService.use((service) =>
          service.create({
            slug: 'two',
            title: 'Two',
            r2Key: 'shared.jpg',
            width: 1200,
            height: 800,
            metadata: '{}',
            contentType: 'image/jpeg',
            bytes: new Uint8Array([1, 2, 3, 4, 5, 6]).buffer,
            tagIds: [],
          }),
        ),
        harness,
      ),
    )

    expect(error).toEqual(new StorageError({ message: 'Failed to insert photo' }))
    // The row is rejected by idx_photos_r2Key, and the bytes that were already
    // at that key belong to the Photo that still points at them.
    expect(await bytesAt(harness, 'shared.jpg')).toEqual(original)
    expect((await get(harness, first.id)).r2Key).toBe('shared.jpg')
    expect(await slugsIn(harness)).toEqual(['one'])
  })

  it('inserts no row and no tags when the tag links fail', async () => {
    const harness = makeTestHarness()

    const error = await fail(
      withTestServices(
        PhotoService.use((service) =>
          service.create({
            slug: 'one',
            title: 'One',
            r2Key: 'o/one.jpg',
            width: 1200,
            height: 800,
            metadata: '{}',
            contentType: 'image/jpeg',
            bytes: JPEG_BYTES(),
            // A tag that does not exist: the link cannot be written, so the
            // transaction that would have carried the row goes with it.
            tagIds: ['tag_missing'],
          }),
        ),
        harness,
      ),
    )

    expect(error).toEqual(new StorageError({ message: 'Failed to insert photo' }))
    expect(await slugsIn(harness)).toEqual([])
    expect(await linkedPhotoIds(harness)).toEqual([])
    expect(await harness.photos.head('o/one.jpg')).toBeNull()
    // The counter was bumped inside the failed transaction, so the serial it
    // spent is gone rather than reissued.
    expect(await numbersIn(harness)).toEqual([])
  })

  it('takes the row back down when the original cannot be stored', async () => {
    const harness = makeTestHarness()
    const failing = withFailingPut(harness)

    const error = await fail(
      withTestServices(
        PhotoService.use((service) =>
          service.create({
            slug: 'one',
            title: 'One',
            r2Key: 'o/one.jpg',
            width: 1200,
            height: 800,
            metadata: '{}',
            contentType: 'image/jpeg',
            bytes: JPEG_BYTES(),
            tagIds: [],
          }),
        ),
        failing,
      ),
    )

    expect(error).toBeInstanceOf(StorageError)
    expect(error.message).toBe('Failed to store original in R2')
    // No row may point at bytes that were never written.
    expect(await slugsIn(harness)).toEqual([])
  })
})

describe('PhotoService.create renditions', () => {
  const webp = (): ArrayBuffer =>
    new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]).buffer

  it('stores the original and both renditions, and purge takes all three down', async () => {
    const harness = makeTestHarness()
    const created = await Effect.runPromise(
      withTestServices(
        PhotoService.use((service) =>
          service.create({
            slug: 'one',
            title: 'One',
            r2Key: 'originals/one.jpg',
            width: 1200,
            height: 800,
            metadata: '{}',
            contentType: 'image/jpeg',
            bytes: JPEG_BYTES(),
            renditions: { small: webp(), preview: webp() },
            tagIds: [],
          }),
        ),
        harness,
      ),
    )

    const keys = () =>
      harness.photos.list().then((page) => page.objects.map((object) => object.key).sort())
    expect(await keys()).toEqual([
      'originals/one.jpg',
      `renditions/${created.id}/preview.webp`,
      `renditions/${created.id}/small.webp`,
    ])
    expect(
      (await harness.photos.head(`renditions/${created.id}/small.webp`))?.httpMetadata,
    ).toEqual({
      contentType: 'image/webp',
    })

    await trash(harness, created.id)
    await purge(harness, created.id)
    expect(await keys()).toEqual([])
  })
})

describe('PhotoService.update', () => {
  it('applies every field and returns the refreshed photo with its new tags', async () => {
    const harness = makeTestHarness()
    const oldTag = await createTag(harness, 'film', 'Film')
    const newTag = await createTag(harness, 'kyoto', 'Kyoto')
    const created = await seed(harness, {
      slug: 'sunset',
      title: 'Sunset',
      r2Key: 'originals/sunset.jpg',
      takenAt: '2024-01-01',
      metadata: '{"caption":"old"}',
      tagIds: [oldTag.id],
    })

    const updated = await update(harness, created.id, {
      title: 'Sunset over Kyoto',
      slug: 'Kyoto Sunset!',
      takenAt: '2024-07-04',
      metadata: { caption: 'new', camera: 'Ricoh GR III' },
      tagIds: [newTag.id],
    })

    expect(updated).toEqual({
      id: created.id,
      slug: 'kyoto-sunset',
      title: 'Sunset over Kyoto',
      r2Key: 'originals/sunset.jpg',
      width: 1200,
      height: 800,
      status: 'published',
      number: 1,
      ratio: '3:2',
      bytes: 4,
      takenAt: '2024-07-04',
      metadata: { caption: 'new', camera: 'Ricoh GR III' },
      blurhash: null,
      aperture: null,
      shutter: null,
      iso: null,
      focalLength: null,
      tags: [{ id: newTag.id, slug: 'kyoto', label: 'Kyoto', caption: null }],
    })
    expect(await linkedPhotoIds(harness)).toEqual([created.id])
  })

  it('writes the Ratio, which is a Photo column rather than a Presentation field', async () => {
    const harness = makeTestHarness()
    // The seed's 1200×800 is a 3:2, so the pick below is a real re-crop.
    const created = await seed(harness, { slug: 'sunset', title: 'Sunset' })

    const updated = await update(harness, created.id, { ratio: '4:3' })

    expect(updated.ratio).toBe('4:3')
    expect((await get(harness, created.id)).ratio).toBe('4:3')
  })

  it('leaves the photo untouched when the tag links fail', async () => {
    const harness = makeTestHarness()
    const created = await seed(harness, { slug: 'sunset', title: 'Sunset' })

    const error = await fail(
      withTestServices(
        PhotoService.use((service) =>
          service.update(created.id, { title: 'Renamed', tagIds: ['tag_missing'] }),
        ),
        harness,
      ),
    )

    expect(error).toEqual(new StorageError({ message: 'Failed to update photo' }))
    // Columns and tag links are one transaction, so the title is not applied
    // over links that could not be written.
    expect((await get(harness, created.id)).title).toBe('Sunset')
  })

  it('turns an empty takenAt into an undated row that sorts last', async () => {
    const harness = makeTestHarness()
    const created = await seed(harness, { slug: 'dated', title: 'Dated', takenAt: '2024-01-01' })
    await seed(harness, { slug: 'older', title: 'Older', takenAt: '2023-01-01' })

    const updated = await update(harness, created.id, { takenAt: '' })

    expect(updated.takenAt).toBeUndefined()
    expect((await list(harness, {})).items.map((item) => item.slug)).toEqual(['older', 'dated'])
  })

  it('leaves the photo untouched when the patch is empty', async () => {
    const harness = makeTestHarness()
    const created = await seed(harness, { slug: 'sunset', title: 'Sunset', takenAt: '2024-01-01' })

    const updated = await update(harness, created.id, {})

    expect(updated).toEqual({
      id: created.id,
      slug: 'sunset',
      title: 'Sunset',
      r2Key: 'originals/sunset.jpg',
      width: 1200,
      height: 800,
      status: 'published',
      number: 1,
      ratio: '3:2',
      bytes: 4,
      takenAt: '2024-01-01',
      metadata: {},
      blurhash: null,
      aperture: null,
      shutter: null,
      iso: null,
      focalLength: null,
      tags: [],
    })
  })

  it('clears every tag when the patch carries an empty list', async () => {
    const harness = makeTestHarness()
    const film = await createTag(harness, 'film', 'Film')
    const created = await seed(harness, {
      slug: 'sunset',
      title: 'Sunset',
      tagIds: [film.id],
    })

    const updated = await update(harness, created.id, { tagIds: [] })

    expect(updated.tags).toEqual([])
    expect(await linkedPhotoIds(harness)).toEqual([])
  })

  it('fails with SlugConflict when the slug belongs to another photo', async () => {
    const harness = makeTestHarness()
    await seed(harness, { slug: 'kyoto', title: 'Kyoto' })
    const other = await seed(harness, { slug: 'harbour', title: 'Harbour' })

    const error = await fail(
      withTestServices(
        PhotoService.use((service) => service.update(other.id, { slug: 'Kyoto' })),
        harness,
      ),
    )

    expect(error).toEqual(new SlugConflict({ slug: 'kyoto' }))
    expect((await get(harness, other.id)).slug).toBe('harbour')
  })

  it('accepts a photo keeping its own slug', async () => {
    const harness = makeTestHarness()
    const created = await seed(harness, { slug: 'kyoto', title: 'Kyoto' })

    const updated = await update(harness, created.id, { slug: 'Kyoto', title: 'Kyoto again' })

    expect(updated.slug).toBe('kyoto')
    expect(updated.title).toBe('Kyoto again')
  })
})

describe('PhotoService.setStatus', () => {
  it('unpublishes and republishes through the one call', async () => {
    const harness = makeTestHarness()
    const created = await seed(harness, { slug: 'sunset', title: 'Sunset' })
    expect((await get(harness, created.id)).status).toBe('published')

    const draft = await setStatus(harness, created.id, 'draft')
    expect(draft.status).toBe('draft')
    expect(draft.number).toBe(1)

    const failed = await setStatus(harness, created.id, 'failed')
    expect(failed.status).toBe('failed')

    const published = await setStatus(harness, created.id, 'published')
    expect(published.status).toBe('published')
  })

  it('moves the photo between the status filter and the counts', async () => {
    const harness = makeTestHarness()
    const draft = await seed(harness, { slug: 'draft', title: 'Draft' })
    await seed(harness, { slug: 'live', title: 'Live' })

    await setStatus(harness, draft.id, 'draft')

    expect((await list(harness, { status: 'draft' })).items.map((item) => item.id)).toEqual([
      draft.id,
    ])
    expect((await counts(harness)).byStatus).toEqual({ draft: 1, published: 1, failed: 0 })
  })
})

describe('PhotoService.trash', () => {
  it('stamps deletedAt, hides the photo and leaves R2 alone', async () => {
    const harness = makeTestHarness()
    const tag = await createTag(harness, 'kyoto', 'Kyoto')
    const created = await seed(harness, {
      slug: 'sunset',
      title: 'Sunset',
      r2Key: 'originals/sunset.jpg',
      tagIds: [tag.id],
    })

    await trash(harness, created.id)

    expect(await deletedAtOf(harness, created.id)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(await harness.photos.head('originals/sunset.jpg')).not.toBeNull()
    // The row and its links stay: a restore is a date clear, not a re-upload.
    expect(await slugsIn(harness)).toEqual(['sunset'])
    expect(await linkedPhotoIds(harness)).toEqual([created.id])
    expect((await list(harness, {})).items).toEqual([])
  })

  it('keeps the first date when a trashed photo is trashed again', async () => {
    const harness = makeTestHarness()
    const created = await seed(harness, { slug: 'sunset', title: 'Sunset' })
    await trash(harness, created.id)
    const first = await deletedAtOf(harness, created.id)

    await trash(harness, created.id)

    expect(await deletedAtOf(harness, created.id)).toBe(first)
  })
})

describe('PhotoService.restore', () => {
  it('clears deletedAt and brings the photo back with its number', async () => {
    const harness = makeTestHarness()
    const tag = await createTag(harness, 'kyoto', 'Kyoto')
    const created = await seed(harness, {
      slug: 'sunset',
      title: 'Sunset',
      takenAt: '2024-01-01',
      tagIds: [tag.id],
    })
    await trash(harness, created.id)

    await restore(harness, created.id)

    expect(await deletedAtOf(harness, created.id)).toBeNull()
    expect((await get(harness, created.id)).number).toBe(1)
    expect((await get(harness, created.id)).tags).toEqual([
      { id: tag.id, slug: 'kyoto', label: 'Kyoto', caption: null },
    ])
    expect((await list(harness, {})).items.map((item) => item.id)).toEqual([created.id])
  })

  it('leaves a photo that is not in the Trash where it is', async () => {
    const harness = makeTestHarness()
    const created = await seed(harness, { slug: 'sunset', title: 'Sunset' })

    // The same early exit a restore of an already-live Photo takes, so the
    // call is idempotent rather than a second stamp.
    await restore(harness, created.id)

    expect(await deletedAtOf(harness, created.id)).toBeNull()
    expect((await list(harness, {})).items.map((item) => item.id)).toEqual([created.id])
  })
})

describe('PhotoService.purge', () => {
  it('drops the row, its links and the R2 object, and nothing else', async () => {
    const harness = makeTestHarness()
    const tag = await createTag(harness, 'kyoto', 'Kyoto')
    const kept = await seed(harness, { slug: 'kept', title: 'Kept', r2Key: 'o/kept.jpg' })
    const binned = await seed(harness, {
      slug: 'binned',
      title: 'Binned',
      r2Key: 'o/binned.jpg',
      tagIds: [tag.id],
    })
    await trash(harness, binned.id)

    await purge(harness, binned.id)

    expect(await slugsIn(harness)).toEqual(['kept'])
    expect((await get(harness, kept.id)).r2Key).toBe('o/kept.jpg')
    expect(await linkedPhotoIds(harness)).toEqual([])
    expect(await harness.photos.head('o/binned.jpg')).toBeNull()
    expect((await harness.photos.list()).objects.map((object) => object.key)).toEqual([
      'o/kept.jpg',
    ])
    expect(
      await fail(
        withTestServices(
          PhotoService.use((service) => service.get(binned.id)),
          harness,
        ),
      ),
    ).toEqual(new PhotoNotFound({ id: binned.id }))
  })

  it('refuses to purge a photo that is not in the trash', async () => {
    const harness = makeTestHarness()
    const created = await seed(harness, { slug: 'sunset', title: 'Sunset' })

    const error = await fail(
      withTestServices(
        PhotoService.use((service) => service.purge(created.id)),
        harness,
      ),
    )

    // The Bulk Bar's Delete is a soft delete; only the Trash is irreversible.
    expect(error).toBeInstanceOf(InvalidInput)
    expect(await slugsIn(harness)).toEqual(['sunset'])
    expect(await harness.photos.head(created.r2Key)).not.toBeNull()
  })
})

describe('PhotoService.counts', () => {
  it('counts every status, the grand total, and the Trash apart from both', async () => {
    const harness = makeTestHarness()
    const published = await seed(harness, { slug: 'temple', title: 'Temple' })
    const draft = await seed(harness, { slug: 'alley', title: 'Alley' })
    const failed = await seed(harness, { slug: 'ruins', title: 'Ruins' })
    await setStatus(harness, draft.id, 'draft')
    await setStatus(harness, failed.id, 'failed')

    expect(await counts(harness)).toEqual({
      total: 3,
      trashed: 0,
      byStatus: { draft: 1, published: 1, failed: 1 },
    })
    // A trashed Photo leaves every live count, the grand total included, and
    // is what `trashed` reports instead.
    await trash(harness, published.id)
    expect(await counts(harness)).toEqual({
      total: 2,
      trashed: 1,
      byStatus: { draft: 1, published: 0, failed: 1 },
    })
  })

  it('counts every status at zero for an empty library', async () => {
    const harness = makeTestHarness()

    expect(await counts(harness)).toEqual({
      total: 0,
      trashed: 0,
      byStatus: { draft: 0, published: 0, failed: 0 },
    })
  })

  it('counts a tagged Photo in neither number, because a Tag is not a Status', async () => {
    // Tags are grouped where they are applied and are not a filter on the
    // Library, so nothing here reports how many Photos carry one.
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    await seed(harness, { slug: 'one', title: 'One', tagIds: [kyoto.id] })
    await seed(harness, { slug: 'two', title: 'Two', tagIds: [kyoto.id] })

    expect(await counts(harness)).toEqual({
      total: 2,
      trashed: 0,
      byStatus: { draft: 0, published: 2, failed: 0 },
    })
  })
})

describe('PhotoService.presentation', () => {
  it('refuses a Photo that is not there, and one that is in the Trash', async () => {
    const harness = makeTestHarness()
    const created = await seed(harness, { slug: 'sunset', title: 'Sunset' })
    await trash(harness, created.id)

    // A trashed Photo still has its presentation columns; the Editor is not
    // where the Trash is edited, so it reads as gone rather than as editable.
    for (const id of [created.id, '00000000-0000-0000-0000-000000000000']) {
      const error = await fail(
        withTestServices(
          PhotoService.use((service) => service.presentation(id)),
          harness,
        ),
      )

      expect(error).toEqual(new PhotoNotFound({ id }))
    }
  })
})

describe('PhotoService.setPresentation', () => {
  it('writes the supplied groups and leaves the rest where they were', async () => {
    const harness = makeTestHarness()
    const created = await seed(harness, { slug: 'sunset', title: 'Sunset' })

    const first = await setPresentation(harness, created.id, {
      crop: { x: 12.5, y: 4, scale: 1.8 },
      level: -2.5,
      mat: { enabled: true, style: 'gallery', colour: 'ink', width: 4 },
    })
    expect(first).toEqual({
      cropX: 12.5,
      cropY: 4,
      cropScale: 1.8,
      cropFlipX: false,
      level: -2.5,
      borderEnabled: true,
      borderStyle: 'gallery',
      borderColour: 'ink',
      borderWidth: 4,
      previewLongEdge: 1200,
      previewFormat: 'avif',
      previewQuality: 82,
      fullQuality: 92,
      keepExif: true,
      removeGps: true,
    })

    // The second save touches the export overrides alone. The crop and the mat
    // are read back off the row rather than spread from `first`: a spread would
    // let a save that quietly rewrote them pass, because both sides would come
    // from the same call.
    const second = await setPresentation(harness, created.id, {
      export: { previewFormat: 'webp', previewQuality: 60, keepExif: false },
    })
    expect(second.previewFormat).toBe('webp')
    expect(second.previewQuality).toBe(60)
    expect(second.keepExif).toBe(false)
    expect(await presentationColumnsOf(harness, created.id)).toEqual({
      cropX: 12.5,
      cropY: 4,
      cropScale: 1.8,
      level: -2.5,
      borderEnabled: 1,
      borderStyle: 'gallery',
      borderColour: 'ink',
      borderWidth: 4,
    })
  })

  it('round-trips the crop flip, and leaves it alone when the patch does not name it', async () => {
    const harness = makeTestHarness()
    const created = await seed(harness, { slug: 'sunset', title: 'Sunset' })

    const flipped = await setPresentation(harness, created.id, {
      crop: { x: 0, y: 0, scale: 1, flipX: true },
    })
    expect(flipped.cropFlipX).toBe(true)

    // A later pan names no flip, so the mirror the operator set stands.
    const panned = await setPresentation(harness, created.id, {
      crop: { x: 20, y: -5, scale: 1.4 },
    })
    expect(panned.cropFlipX).toBe(true)
    expect(panned.cropX).toBe(20)
    expect(panned.cropScale).toBe(1.4)
  })

  it('reads back the migration defaults for a photo nobody has edited', async () => {
    const harness = makeTestHarness()
    const created = await seed(harness, { slug: 'sunset', title: 'Sunset' })

    expect(await setPresentation(harness, created.id, { level: 0 })).toEqual({
      ...PRESENTATION_DEFAULTS,
      level: 0,
    })
  })

  it('refuses an empty patch', async () => {
    const harness = makeTestHarness()
    const created = await seed(harness, { slug: 'sunset', title: 'Sunset' })

    const error = await fail(
      withTestServices(
        PhotoService.use((service) => service.setPresentation(created.id, {})),
        harness,
      ),
    )

    expect(error).toBeInstanceOf(InvalidInput)
  })

  it('clears the level and the mat detail with null, keeping the rest of the row', async () => {
    const harness = makeTestHarness()
    const created = await seed(harness, { slug: 'sunset', title: 'Sunset' })
    await setPresentation(harness, created.id, {
      crop: { x: 12.5, y: 4, scale: 1.8 },
      level: -2.5,
      mat: { enabled: true, style: 'gallery', colour: 'ink', width: 4 },
    })

    const cleared = await setPresentation(harness, created.id, {
      level: null,
      mat: { enabled: true, style: null, colour: null, width: null },
    })

    // Null is un-levelled, not zero, and the crop the patch did not name is
    // still the crop.
    expect(cleared.level).toBeNull()
    expect(cleared.borderEnabled).toBe(true)
    expect(await presentationColumnsOf(harness, created.id)).toEqual({
      cropX: 12.5,
      cropY: 4,
      cropScale: 1.8,
      level: null,
      borderEnabled: 1,
      borderStyle: null,
      borderColour: null,
      borderWidth: null,
    })
  })

  it('refuses a crop scale of zero and a level that is not a number', async () => {
    const harness = makeTestHarness()
    const created = await seed(harness, { slug: 'sunset', title: 'Sunset' })

    // The column carries no CHECK, and a zero scale is a divide by zero in
    // the Rendition generator rather than a very tight crop.
    for (const patch of [{ crop: { x: 0, y: 0, scale: 0 } }, { level: Number.NaN }]) {
      const error = await fail(
        withTestServices(
          PhotoService.use((service) => service.setPresentation(created.id, patch)),
          harness,
        ),
      )
      expect(error).toBeInstanceOf(InvalidInput)
    }
    expect(await presentationColumnsOf(harness, created.id)).toMatchObject({
      cropScale: 1,
      level: null,
    })
  })
})

describe('PhotoService.addTags', () => {
  it('links every given tag to every given photo', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const film = await createTag(harness, 'film', 'Film')
    const first = await seed(harness, { slug: 'a', title: 'A' })
    const second = await seed(harness, { slug: 'b', title: 'B' })

    await addTags(harness, [first.id, second.id], [kyoto.id, film.id])

    expect(await linkedTagsOf(harness, first.id)).toEqual(['film', 'kyoto'])
    expect(await linkedTagsOf(harness, second.id)).toEqual(['film', 'kyoto'])
  })

  it('adds to the tags a photo already carries rather than replacing them', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const film = await createTag(harness, 'film', 'Film')
    const created = await seed(harness, { slug: 'a', title: 'A', tagIds: [film.id] })

    await addTags(harness, [created.id], [kyoto.id])

    expect(await linkedTagsOf(harness, created.id)).toEqual(['film', 'kyoto'])
  })

  it('is idempotent: a repeated add links nothing twice', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const created = await seed(harness, { slug: 'a', title: 'A' })

    await addTags(harness, [created.id], [kyoto.id])
    await addTags(harness, [created.id], [kyoto.id])

    expect(await linkedTagsOf(harness, created.id)).toEqual(['kyoto'])
  })

  it('links every photo past the bind chunk boundary', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    // More ids than one statement may bind, so the second chunk has to run
    // too: a query that dropped the overflow looks identical at any size
    // under the limit.
    const ids: Array<string> = []
    for (let index = 0; index < LINK_BIND_BUDGET + 6; index += 1) {
      const id = `photo_${index}`
      ids.push(id)
      await seedPhotoRow(harness, { id, slug: id })
    }

    await addTags(harness, ids, [kyoto.id])

    // The first id of the SECOND chunk is the one a chunker that drops its
    // head loses, and the last two are the only tail an off-by-one at the
    // end shows up in. All three are asserted, and the count closes it.
    for (const id of [
      ids[0]!,
      ids[LINK_BIND_BUDGET - 1]!,
      ids[LINK_BIND_BUDGET]!,
      ids[ids.length - 1]!,
    ]) {
      expect([id, await linkedTagsOf(harness, id)]).toEqual([id, ['kyoto']])
    }
    expect(await countLinks(harness, kyoto.id)).toBe(ids.length)
  })

  it('fails with InvalidInput for a tag id nobody carries, and links nothing', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const created = await seed(harness, { slug: 'a', title: 'A' })

    // `photo_tags.tagId` is a foreign key, so a stale id would otherwise die
    // as a storage failure and take the good tag's link down with it.
    expect(
      await fail(
        withTestServices(
          PhotoService.use((s) => s.addTags([created.id], [kyoto.id, 'tag_missing'])),
          harness,
        ),
      ),
    ).toEqual(new InvalidInput({ message: 'no tag with id tag_missing' }))
    expect(await linkedTagsOf(harness, created.id)).toEqual([])
  })
})

describe('PhotoService.removeTags', () => {
  it('unlinks only the given tags, and only from the given photos', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const film = await createTag(harness, 'film', 'Film')
    const first = await seed(harness, { slug: 'a', title: 'A', tagIds: [kyoto.id, film.id] })
    const second = await seed(harness, {
      slug: 'b',
      title: 'B',
      tagIds: [kyoto.id, film.id],
    })

    await removeTags(harness, [first.id], [kyoto.id])

    expect(await linkedTagsOf(harness, first.id)).toEqual(['film'])
    expect(await linkedTagsOf(harness, second.id)).toEqual(['film', 'kyoto'])
  })

  it('is idempotent: removing a link that is not there succeeds', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const created = await seed(harness, { slug: 'a', title: 'A' })

    await removeTags(harness, [created.id], [kyoto.id])
    await removeTags(harness, [created.id], [kyoto.id])

    // The second call has a real link to remove, so this is not a no-op twice.
    expect(await linkedTagsOf(harness, created.id)).toEqual([])
  })

  it('unlinks every photo past the bind chunk boundary', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const ids: Array<string> = []
    for (let index = 0; index < LINK_BIND_BUDGET + 6; index += 1) {
      const id = `photo_${index}`
      ids.push(id)
      await seedPhotoRow(harness, { id, slug: id, tagIds: [kyoto.id] })
    }

    await removeTags(harness, ids, [kyoto.id])

    expect(await countLinks(harness, kyoto.id)).toBe(0)
    for (const id of [ids[0]!, ids[LINK_BIND_BUDGET]!, ids[ids.length - 1]!]) {
      expect([id, await linkedTagsOf(harness, id)]).toEqual([id, []])
    }
  })

  it('fails with InvalidInput for a tag id nobody carries', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const created = await seed(harness, { slug: 'a', title: 'A', tagIds: [kyoto.id] })

    expect(
      await fail(
        withTestServices(
          PhotoService.use((s) => s.removeTags([created.id], ['tag_missing'])),
          harness,
        ),
      ),
    ).toEqual(new InvalidInput({ message: 'no tag with id tag_missing' }))
    expect(await linkedTagsOf(harness, created.id)).toEqual(['kyoto'])
  })
})
