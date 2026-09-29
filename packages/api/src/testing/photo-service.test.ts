import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { PhotoNotFound, SlugConflict, StorageError } from '@photo/shared'
import type { D1DatabaseLike } from '../gateway'
import {
  PhotoService,
  type PhotoListFilter,
  type PhotoListPage,
  type PhotoUpdatePatch,
} from '../photo'
import { createPhoto, createTag, fail, type PhotoSeed } from './fixtures'
import { makeTestHarness, withTestServices, type TestHarness } from './harness'

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

const remove = (harness: TestHarness, id: string) =>
  Effect.runPromise(
    withTestServices(
      PhotoService.use((service) => service.remove(id)),
      harness,
    ),
  )

const slugsIn = (harness: TestHarness): Promise<ReadonlyArray<string>> =>
  harness.db
    .prepare('SELECT slug FROM photos ORDER BY slug')
    .all<{ slug: string }>()
    .then((raw) => raw.results?.map((row) => row.slug) ?? [])

const linkedPhotoIds = (harness: TestHarness): Promise<ReadonlyArray<string>> =>
  harness.db
    .prepare('SELECT photoId FROM photo_tags ORDER BY photoId, tagId')
    .all<{ photoId: string }>()
    .then((raw) => raw.results?.map((row) => row.photoId) ?? [])

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
}

/** Rows the service API cannot produce: a fixed id, or no `takenAt` at all. */
const seedPhotoRow = async (db: D1DatabaseLike, row: PhotoRowSeed): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO photos (id, slug, title, r2Key, width, height, takenAt, metadata, blurhash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.slug,
      row.slug,
      `originals/${row.id}.jpg`,
      1200,
      800,
      row.takenAt ?? null,
      '{}',
      null,
    )
    .run()
}

const seed = (harness: TestHarness, seedValue: PhotoSeed) => createPhoto(harness, seedValue)

describe('PhotoService.list', () => {
  it('orders by takenAt descending, then by id descending', async () => {
    const harness = makeTestHarness()
    await seedPhotoRow(harness.db, { id: 'photo_a', slug: 'alpha', takenAt: '2024-03-01' })
    await seedPhotoRow(harness.db, { id: 'photo_b', slug: 'bravo', takenAt: '2024-03-01' })
    await seedPhotoRow(harness.db, { id: 'photo_c', slug: 'charlie', takenAt: '2024-01-01' })

    const page = await list(harness, {})

    expect(page.items.map((item) => item.id)).toEqual(['photo_b', 'photo_a', 'photo_c'])
    expect(page.items.map((item) => item.slug)).toEqual(['bravo', 'alpha', 'charlie'])
    expect(page.nextCursor).toBeNull()
  })

  it('sorts undated photos last, newest id first among them', async () => {
    const harness = makeTestHarness()
    await seedPhotoRow(harness.db, { id: 'photo_z', slug: 'zulu', takenAt: '2024-02-02' })
    await seedPhotoRow(harness.db, { id: 'photo_u1', slug: 'undated-one', takenAt: null })
    await seedPhotoRow(harness.db, { id: 'photo_u2', slug: 'undated-two' })

    const page = await list(harness, {})

    expect(page.items.map((item) => item.id)).toEqual(['photo_z', 'photo_u2', 'photo_u1'])
    expect(page.items.map((item) => item.takenAt)).toEqual(['2024-02-02', undefined, undefined])
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

  it('narrows to photos carrying tagSlug', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const film = await createTag(harness, 'film', 'Film')
    const tagged = await seed(harness, {
      slug: 'temple',
      title: 'Temple',
      tagIds: [kyoto.id, film.id],
    })
    await seed(harness, { slug: 'harbour', title: 'Harbour', tagIds: [film.id] })
    await seed(harness, { slug: 'untagged', title: 'Untagged' })

    const page = await list(harness, { tagSlug: 'kyoto' })

    expect(page.items.map((item) => item.id)).toEqual([tagged.id])
    expect(page.items[0]?.tags?.map((tag) => tag.slug)).toEqual(['film', 'kyoto'])
  })

  it('returns nothing for a tagSlug nobody carries', async () => {
    const harness = makeTestHarness()
    const film = await createTag(harness, 'film', 'Film')
    await seed(harness, { slug: 'temple', title: 'Temple', tagIds: [film.id] })

    const page = await list(harness, { tagSlug: 'nowhere' })

    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeNull()
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
    await seedPhotoRow(harness.db, { id: 'photo_1', slug: 'p1', takenAt: '2024-06-01' })
    await seedPhotoRow(harness.db, { id: 'photo_2', slug: 'p2', takenAt: '2024-05-01' })
    await seedPhotoRow(harness.db, { id: 'photo_3', slug: 'p3', takenAt: '2024-04-01' })
    await seedPhotoRow(harness.db, { id: 'photo_u1', slug: 'pu1', takenAt: null })
    await seedPhotoRow(harness.db, { id: 'photo_u2', slug: 'pu2', takenAt: null })

    const first = await list(harness, { limit: 2 })
    expect(first.items.map((item) => item.id)).toEqual(['photo_1', 'photo_2'])

    const second = await list(harness, { limit: 2, cursor: cursorOf(first) })
    expect(second.items.map((item) => item.id)).toEqual(['photo_3', 'photo_u2'])

    const third = await list(harness, { limit: 2, cursor: cursorOf(second) })
    expect(third.items.map((item) => item.id)).toEqual(['photo_u1'])
    expect(third.nextCursor).toBeNull()
  })

  it('loads tags for a page wider than the chunked IN list', async () => {
    const harness = makeTestHarness()
    const film = await createTag(harness, 'film', 'Film')
    for (let index = 0; index < 81; index += 1) {
      await seedPhotoRow(harness.db, { id: `photo_${String(index)}`, slug: `p${index}` })
    }
    await harness.db
      .prepare('INSERT INTO photo_tags (photoId, tagId) SELECT photos.id, ? FROM photos')
      .bind(film.id)
      .run()

    const page = await list(harness, { limit: 100 })

    expect(page.items).toHaveLength(81)
    expect(page.items.every((item) => item.tags?.[0]?.id === film.id)).toBe(true)
  })
})

describe('PhotoService.get', () => {
  it('returns the photo with its tags', async () => {
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
      takenAt: '2024-04-01',
      metadata: { caption: 'Golden hour', location: 'Kyoto' },
      blurhash: null,
      tags: [{ id: tag.id, slug: 'kyoto', label: 'Kyoto', caption: null }],
    })
  })

  it('fails with PhotoNotFound carrying the id for an unknown photo', async () => {
    const harness = makeTestHarness()

    const error = await fail(
      withTestServices(
        PhotoService.use((service) => service.get('missing')),
        harness,
      ),
    )

    expect(error).toEqual(new PhotoNotFound({ id: 'missing' }))
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
      takenAt: '2024-04-01',
      metadata: { caption: 'Golden hour' },
      blurhash: 'LEHV6nWB2',
      tags: [{ id: tag.id, slug: 'kyoto', label: 'Kyoto', caption: null }],
    })
  })

  it('defaults the content type to image/jpeg when none is given', async () => {
    const harness = makeTestHarness()

    const created = await seed(harness, { slug: 'plain', title: 'Plain' })

    expect((await harness.photos.head(created.r2Key))?.httpMetadata?.contentType).toBe('image/jpeg')
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

  it('fails with StorageError and leaves no orphan row when the r2Key is taken', async () => {
    const harness = makeTestHarness()
    const first = await seed(harness, { slug: 'one', title: 'One', r2Key: 'shared.jpg' })

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
            bytes: new ArrayBuffer(4),
            tagIds: [],
          }),
        ),
        harness,
      ),
    )

    expect(error).toEqual(new StorageError({ message: 'Failed to insert photo' }))
    expect(await slugsIn(harness)).toEqual(['one'])
    expect((await get(harness, first.id)).slug).toBe('one')
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
      takenAt: '2024-07-04',
      metadata: { caption: 'new', camera: 'Ricoh GR III' },
      blurhash: null,
      tags: [{ id: newTag.id, slug: 'kyoto', label: 'Kyoto', caption: null }],
    })
    expect(await linkedPhotoIds(harness)).toEqual([created.id])
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
      takenAt: '2024-01-01',
      metadata: {},
      blurhash: null,
      tags: [],
    })
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

  it('fails with PhotoNotFound for an unknown photo', async () => {
    const harness = makeTestHarness()

    const error = await fail(
      withTestServices(
        PhotoService.use((service) => service.update('missing', { title: 'New' })),
        harness,
      ),
    )

    expect(error).toEqual(new PhotoNotFound({ id: 'missing' }))
  })
})

describe('PhotoService.remove', () => {
  it('deletes the row, the R2 object and the photo_tags links', async () => {
    const harness = makeTestHarness()
    const tag = await createTag(harness, 'kyoto', 'Kyoto')
    const created = await seed(harness, {
      slug: 'sunset',
      title: 'Sunset',
      r2Key: 'originals/sunset.jpg',
      tagIds: [tag.id],
    })

    expect(await remove(harness, created.id)).toBe(true)

    expect(await slugsIn(harness)).toEqual([])
    expect(await linkedPhotoIds(harness)).toEqual([])
    expect(await harness.photos.head('originals/sunset.jpg')).toBeNull()
    expect((await harness.photos.list()).objects).toEqual([])
    expect((await list(harness, {})).items).toEqual([])
    expect(
      await fail(
        withTestServices(
          PhotoService.use((service) => service.get(created.id)),
          harness,
        ),
      ),
    ).toEqual(new PhotoNotFound({ id: created.id }))
  })

  it('fails with PhotoNotFound for an unknown photo', async () => {
    const harness = makeTestHarness()

    const error = await fail(
      withTestServices(
        PhotoService.use((service) => service.remove('missing')),
        harness,
      ),
    )

    expect(error).toEqual(new PhotoNotFound({ id: 'missing' }))
  })
})
