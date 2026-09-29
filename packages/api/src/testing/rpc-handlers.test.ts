/**
 * The RPC handlers over the live services, driven through a real `RpcClient`
 * so the payload schema, the handler and the success schema are all in the
 * loop. This is where the public contract's slugs meet the service's ids.
 */

import { describe, expect, it } from 'vitest'
import { Effect, Layer } from 'effect'
import {
  LibrarySort,
  PhotoAdminRpcs,
  PhotoNotFound,
  PhotoPublicRpcs,
  STORAGE_CAP_BYTES,
  type PhotoPresentation,
} from '@photo/shared'
import { RpcClient, RpcTest } from 'effect/unstable/rpc'
import { Gateway } from '../gateway'
import { AdminRpcHandlersLive, PublicRpcHandlersLive } from '../rpc'
import { DEFAULT_SORT, PHOTO_SORT_KEYS, PhotoServiceLive, type PhotoService } from '../photo'
import { AdminSession } from '../session'
import { TagServiceLive, type TagService } from '../tag'
import { createPhoto, createTag, setPhotoStatus, trashPhoto } from './fixtures'
import { makeTestHarness, type TestHarness } from './harness'

/**
 * The handler layer over the two services it talks to, and both over the
 * harness's Gateway. `Layer.mergeAll` does not resolve one layer's requirement
 * from another's output, so the handlers are provided the services explicitly.
 */
const stackOver = <ROut>(
  harness: TestHarness,
  handlers: Layer.Layer<ROut, never, PhotoService | TagService>,
) => {
  const services = Layer.mergeAll(PhotoServiceLive, TagServiceLive)
  return Layer.mergeAll(services, Layer.provide(handlers, services)).pipe(
    Layer.provide(Layer.succeed(Gateway, harness.gateway)),
  )
}

interface ListPayload {
  readonly tagSlug?: string
  readonly q?: string
  readonly limit?: number
}

const listPhotos = (harness: TestHarness, payload: ListPayload) =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(PhotoPublicRpcs)
          return yield* client.ListPhotos(payload)
        }),
      ),
      stackOver(harness, PublicRpcHandlersLive),
    ),
  )

const deletePhoto = (harness: TestHarness, id: string) =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(PhotoAdminRpcs)
          return yield* client.DeletePhoto({ id })
        }),
      ),
      adminStackOver(harness, 'owner@photo.test'),
    ),
  )

const deletePhotoFailure = (harness: TestHarness, id: string) =>
  Effect.runPromise(
    Effect.flip(
      Effect.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(PhotoAdminRpcs)
            return yield* client.DeletePhoto({ id })
          }),
        ),
        adminStackOver(harness, 'owner@photo.test'),
      ),
    ),
  )

// ---------------------------------------------------------------------------
// the admin group
// ---------------------------------------------------------------------------

const makeAdminClient = RpcTest.makeClient(PhotoAdminRpcs)
type AdminClient = RpcClient.FromGroup<typeof PhotoAdminRpcs>

/** The admin group over the harness, with a session the way the Worker
 *  provides one: per request, from the email the Access gate verified. */
const adminStackOver = (harness: TestHarness, email: string | null) =>
  stackOver(harness, Layer.provide(AdminRpcHandlersLive, Layer.succeed(AdminSession, { email })))

/** One admin call over a live client, so the payload schema, the handler and
 *  the success schema are all in the loop. A failing case passes `Effect.flip`
 *  and gets the typed error back as a value. */
const adminRpc = <A, E>(
  harness: TestHarness,
  call: (client: AdminClient) => Effect.Effect<A, E>,
  email: string | null = 'owner@photo.test',
): Promise<A> =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeAdminClient
          return yield* call(client)
        }),
      ),
      adminStackOver(harness, email),
    ),
  )

/** The service only hands back a `nextCursor` on a full page; a bare `?.` here
 *  would let a regression fall through as "page one again" and pass. */
const cursorOf = (nextCursor: string | null): string => {
  if (nextCursor === null) throw new Error('expected a nextCursor')
  return nextCursor
}

const DEFAULT_PRESENTATION: PhotoPresentation = {
  cropX: 0,
  cropY: 0,
  cropScale: 1,
  level: null,
  borderEnabled: false,
  borderStyle: null,
  borderColour: null,
  borderWidth: null,
  previewLongEdge: 1200,
  previewFormat: 'avif',
  previewQuality: 82,
  fullQuality: 92,
  keepExif: true,
  removeGps: true,
}

const slugsIn = (harness: TestHarness): Promise<ReadonlyArray<string>> =>
  harness.db
    .prepare('SELECT slug FROM photos')
    .all<{ slug: string }>()
    .then((raw) => raw.results?.map((row) => row.slug) ?? [])

const matOf = async (harness: TestHarness, id: string) => {
  const row = await harness.db
    .prepare(
      'SELECT borderEnabled, borderStyle, borderColour, borderWidth FROM photos WHERE id = ?',
    )
    .bind(id)
    .first<{
      borderEnabled: number
      borderStyle: string | null
      borderColour: string | null
      borderWidth: number | null
    }>()
  return row
}

describe('ListPhotos handler', () => {
  it('finds a tag whose slug was typed with different case and spacing', async () => {
    const harness = makeTestHarness()
    const istanbul = await createTag(harness, 'istanbul', 'Istanbul')
    const tagged = await createPhoto(harness, {
      slug: 'balik',
      title: 'Balık',
      tagIds: [istanbul.id],
    })
    await createPhoto(harness, { slug: 'kyoto', title: 'Kyoto' })

    // `slugify` is what the write side applied, so the read side applies it
    // too. Before the fix this compared the raw string and matched nothing.
    const page = await listPhotos(harness, { tagSlug: 'Istanbul' })
    expect(page.items.map((item) => item.id)).toEqual([tagged.id])

    const spaced = await listPhotos(harness, { tagSlug: '  Istanbul  ' })
    expect(spaced.items.map((item) => item.id)).toEqual([tagged.id])
  })

  it('answers an unknown slug with an empty page', async () => {
    const harness = makeTestHarness()
    const istanbul = await createTag(harness, 'istanbul', 'Istanbul')
    await createPhoto(harness, { slug: 'balik', title: 'Balık', tagIds: [istanbul.id] })

    expect((await listPhotos(harness, { tagSlug: 'nowhere' })).items).toEqual([])
  })

  it('still refuses a tagSlug carrying a comma', async () => {
    const harness = makeTestHarness()

    await expect(listPhotos(harness, { tagSlug: 'a,b' })).rejects.toThrow(/one tag/i)
  })

  it('keeps a trashed photo out of the public list', async () => {
    const harness = makeTestHarness()
    const kept = await createPhoto(harness, { slug: 'kept', title: 'Kept' })
    const binned = await createPhoto(harness, { slug: 'binned', title: 'Binned' })
    await harness.db
      .prepare(`UPDATE photos SET deletedAt = '2026-01-01' WHERE id = ?`)
      .bind(binned.id)
      .run()

    const page = await listPhotos(harness, { limit: 60 })

    expect(page.items.map((item) => item.id)).toEqual([kept.id])
  })

  it('passes q and limit through', async () => {
    const harness = makeTestHarness()
    await createPhoto(harness, { slug: 'sunset', title: 'Sunset' })
    await createPhoto(harness, { slug: 'harbour', title: 'Harbour' })

    expect((await listPhotos(harness, { q: 'sunset' })).items.map((item) => item.title)).toEqual([
      'Sunset',
    ])
    expect((await listPhotos(harness, { limit: 1 })).items).toHaveLength(1)
  })
})

describe('DeletePhoto handler', () => {
  it('is a soft delete: the row stays, stamped, and R2 keeps the original', async () => {
    const harness = makeTestHarness()
    const created = await createPhoto(harness, { slug: 'sunset', title: 'Sunset' })

    expect(await deletePhoto(harness, created.id)).toBe(true)

    expect(await slugsIn(harness)).toEqual(['sunset'])
    expect(await harness.photos.head(created.r2Key)).not.toBeNull()
    expect((await listPhotos(harness, { limit: 60 })).items).toEqual([])
  })

  it('fails with PhotoNotFound for an unknown photo', async () => {
    const harness = makeTestHarness()

    expect(await deletePhotoFailure(harness, 'missing')).toEqual(
      new PhotoNotFound({ id: 'missing' }),
    )
  })
})

describe('GetSession handler', () => {
  it('hands back the email the gate verified', async () => {
    const harness = makeTestHarness()

    expect(await adminRpc(harness, (client) => client.GetSession({}), 'owner@photo.test')).toEqual({
      email: 'owner@photo.test',
    })
  })

  it('reports no email on the dev stand-down', async () => {
    const harness = makeTestHarness()

    // `null` is ADR 0007's dev gate standing down, not a signed-out state.
    expect(await adminRpc(harness, (client) => client.GetSession({}), null)).toEqual({
      email: null,
    })
  })
})

describe('GetCounts handler', () => {
  it('reports the total, each status and each tag, with no scheduled key', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const unused = await createTag(harness, 'unused', 'Unused')
    const published = await createPhoto(harness, {
      slug: 'temple',
      title: 'Temple',
      takenAt: '2024-05-01',
      tagIds: [kyoto.id],
    })
    const draft = await createPhoto(harness, { slug: 'alley', title: 'Alley' })
    await setPhotoStatus(harness, draft.id, 'draft')
    await trashPhoto(harness, published.id)

    const result = await adminRpc(harness, (client) => client.GetCounts({}))

    // The trashed Photo is out of every count; the Tag it carried is not.
    expect(result).toEqual({
      total: 1,
      byStatus: { draft: 1, published: 0, failed: 0 },
      byTag: [
        { id: kyoto.id, label: 'Kyoto', count: 0 },
        { id: unused.id, label: 'Unused', count: 0 },
      ],
    })
    expect('scheduled' in result.byStatus).toBe(false)
  })
})

describe('GetStorageUsage handler', () => {
  it('answers with the photos, the bytes and the bucket cap', async () => {
    const harness = makeTestHarness()
    await createPhoto(harness, { slug: 'sunset', title: 'Sunset' })

    const usage = await adminRpc(harness, (client) => client.GetStorageUsage({}))

    // `photos`, not `frames`: ADR 0008, and the design prints `412 FRAMES`.
    expect(usage.photos).toBe(1)
    expect(usage.bytes).toBeGreaterThan(0)
    expect(usage.capBytes).toBe(STORAGE_CAP_BYTES)
  })
})

describe('ListLibraryRows handler', () => {
  it('filters by status, ratio, tag and q', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const draft = await createPhoto(harness, {
      slug: 'alley',
      title: 'Alley',
      takenAt: '2024-05-01',
      tagIds: [kyoto.id],
    })
    await setPhotoStatus(harness, draft.id, 'draft')
    const temple = await createPhoto(harness, {
      slug: 'temple',
      title: 'Temple',
      takenAt: '2024-04-01',
    })

    const byStatus = await adminRpc(harness, (client) =>
      client.ListLibraryRows({ status: 'draft' }),
    )
    expect(byStatus.items.map((item) => item.id)).toEqual([draft.id])

    const byRatio = await adminRpc(harness, (client) => client.ListLibraryRows({ ratio: '2:3' }))
    expect(byRatio.items).toEqual([])

    const byTag = await adminRpc(harness, (client) =>
      client.ListLibraryRows({ tagIds: [kyoto.id] }),
    )
    expect(byTag.items.map((item) => item.id)).toEqual([draft.id])

    const byQ = await adminRpc(harness, (client) => client.ListLibraryRows({ q: 'temp' }))
    expect(byQ.items.map((item) => item.id)).toEqual([temple.id])

    expect(byStatus.nextCursor).toBeNull()
  })

  it('pages on the cursor and honours the sort', async () => {
    const harness = makeTestHarness()
    await createPhoto(harness, { slug: 'a', title: 'A', takenAt: '2024-01-01' })
    await createPhoto(harness, { slug: 'b', title: 'B', takenAt: '2024-02-01' })
    await createPhoto(harness, { slug: 'c', title: 'C', takenAt: '2024-03-01' })

    const first = await adminRpc(harness, (client) =>
      client.ListLibraryRows({ sort: { key: 'takenAt', direction: 'asc' }, limit: 2 }),
    )
    expect(first.items.map((item) => item.slug)).toEqual(['a', 'b'])

    const second = await adminRpc(harness, (client) =>
      client.ListLibraryRows({
        sort: { key: 'takenAt', direction: 'asc' },
        cursor: cursorOf(first.nextCursor),
        limit: 2,
      }),
    )
    expect(second.items.map((item) => item.slug)).toEqual(['c'])
    expect(second.nextCursor).toBeNull()
  })

  it('refuses a cursor cut under another sort', async () => {
    const harness = makeTestHarness()
    await createPhoto(harness, { slug: 'a', title: 'A', takenAt: '2024-01-01' })
    await createPhoto(harness, { slug: 'b', title: 'B', takenAt: '2024-02-01' })

    const first = await adminRpc(harness, (client) =>
      client.ListLibraryRows({ sort: { key: 'takenAt', direction: 'desc' }, limit: 1 }),
    )

    const error = await adminRpc(harness, (client) =>
      client
        .ListLibraryRows({
          sort: { key: 'takenAt', direction: 'asc' },
          cursor: cursorOf(first.nextCursor),
        })
        .pipe(Effect.flip),
    )

    expect(error._tag).toBe('InvalidInput')
  })
})

describe('SetPhotoStatus handler', () => {
  it('publishes and unpublishes through the one call', async () => {
    const harness = makeTestHarness()
    const created = await createPhoto(harness, { slug: 'sunset', title: 'Sunset' })

    const draft = await adminRpc(harness, (client) =>
      client.SetPhotoStatus({ id: created.id, status: 'draft' }),
    )
    expect(draft.status).toBe('draft')
    expect(draft.tags).toEqual([])

    const published = await adminRpc(harness, (client) =>
      client.SetPhotoStatus({ id: created.id, status: 'published' }),
    )
    expect(published.status).toBe('published')
  })

  it('fails with PhotoNotFound for an unknown photo', async () => {
    const harness = makeTestHarness()

    const error = await adminRpc(harness, (client) =>
      client.SetPhotoStatus({ id: 'missing', status: 'draft' }).pipe(Effect.flip),
    )

    expect(error).toEqual(new PhotoNotFound({ id: 'missing' }))
  })
})

describe('UpdatePhotoPresentation handler', () => {
  it('round-trips the crop, the mat and the export overrides in one call', async () => {
    const harness = makeTestHarness()
    const created = await createPhoto(harness, { slug: 'sunset', title: 'Sunset' })

    const saved = await adminRpc(harness, (client) =>
      client.UpdatePhotoPresentation({
        id: created.id,
        crop: { x: 12.5, y: 4, scale: 1.8 },
        level: -2.5,
        mat: { enabled: true, style: 'gallery', colour: 'ink', width: 4 },
        export: {
          previewLongEdge: 2000,
          previewFormat: 'webp',
          previewQuality: 70,
          fullQuality: 88,
          keepExif: false,
          removeGps: false,
        },
      }),
    )

    // The success is the stored presentation, so the untouched defaults in it
    // are the row's truth rather than the caller's.
    expect(saved).toEqual({
      cropX: 12.5,
      cropY: 4,
      cropScale: 1.8,
      level: -2.5,
      borderEnabled: true,
      borderStyle: 'gallery',
      borderColour: 'ink',
      borderWidth: 4,
      previewLongEdge: 2000,
      previewFormat: 'webp',
      previewQuality: 70,
      fullQuality: 88,
      keepExif: false,
      removeGps: false,
    })
  })

  it('answers the default presentation for a photo nobody has edited', async () => {
    const harness = makeTestHarness()
    const created = await createPhoto(harness, { slug: 'sunset', title: 'Sunset' })

    const saved = await adminRpc(harness, (client) =>
      client.UpdatePhotoPresentation({ id: created.id, level: 1.25 }),
    )

    expect(saved).toEqual({ ...DEFAULT_PRESENTATION, level: 1.25 })
  })

  it('rejects an empty patch', async () => {
    const harness = makeTestHarness()
    const created = await createPhoto(harness, { slug: 'sunset', title: 'Sunset' })

    const error = await adminRpc(harness, (client) =>
      client.UpdatePhotoPresentation({ id: created.id }).pipe(Effect.flip),
    )

    expect(error._tag).toBe('InvalidInput')
  })
})

describe('TrashPhotos, RestorePhotos and PurgePhotos handlers', () => {
  it('takes arrays in and answers with the count acted on', async () => {
    const harness = makeTestHarness()
    const first = await createPhoto(harness, {
      slug: 'a',
      title: 'A',
      r2Key: 'o/a.jpg',
      takenAt: '2024-05-01',
    })
    const second = await createPhoto(harness, {
      slug: 'b',
      title: 'B',
      r2Key: 'o/b.jpg',
      takenAt: '2024-04-01',
    })
    const third = await createPhoto(harness, {
      slug: 'c',
      title: 'C',
      takenAt: '2024-03-01',
    })

    expect(
      await adminRpc(harness, (client) => client.TrashPhotos({ ids: [first.id, second.id] })),
    ).toBe(2)
    expect((await listPhotos(harness, { limit: 60 })).items.map((item) => item.id)).toEqual([
      third.id,
    ])

    expect(await adminRpc(harness, (client) => client.RestorePhotos({ ids: [first.id] }))).toBe(1)
    expect((await listPhotos(harness, { limit: 60 })).items.map((item) => item.id)).toEqual([
      first.id,
      third.id,
    ])

    expect(await adminRpc(harness, (client) => client.PurgePhotos({ ids: [second.id] }))).toBe(1)
    expect(await harness.photos.head('o/b.jpg')).toBeNull()
  })

  it('counts a photo that is already in the target state', async () => {
    const harness = makeTestHarness()
    const created = await createPhoto(harness, { slug: 'a', title: 'A' })

    expect(await adminRpc(harness, (client) => client.TrashPhotos({ ids: [created.id] }))).toBe(1)
    expect(await adminRpc(harness, (client) => client.TrashPhotos({ ids: [created.id] }))).toBe(1)
  })

  it('refuses to purge a photo that is not in the trash', async () => {
    const harness = makeTestHarness()
    const created = await createPhoto(harness, { slug: 'a', title: 'A' })

    const error = await adminRpc(harness, (client) =>
      client.PurgePhotos({ ids: [created.id] }).pipe(Effect.flip),
    )

    expect(error._tag).toBe('InvalidInput')
    expect(await slugsIn(harness)).toEqual(['a'])
  })

  it('fails with PhotoNotFound for an unknown photo', async () => {
    const harness = makeTestHarness()

    const error = await adminRpc(harness, (client) =>
      client.TrashPhotos({ ids: ['missing'] }).pipe(Effect.flip),
    )

    expect(error).toEqual(new PhotoNotFound({ id: 'missing' }))
  })
})

describe('BulkAddTags and BulkRemoveTags handlers', () => {
  it('adds a tag to a set of photos, then takes it off again', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const film = await createTag(harness, 'film', 'Film')
    const first = await createPhoto(harness, {
      slug: 'a',
      title: 'A',
      takenAt: '2024-05-01',
      tagIds: [film.id],
    })
    const second = await createPhoto(harness, {
      slug: 'b',
      title: 'B',
      takenAt: '2024-04-01',
    })

    expect(
      await adminRpc(harness, (client) =>
        client.BulkAddTags({ photoIds: [first.id, second.id], tagIds: [kyoto.id] }),
      ),
    ).toBe(2)
    const tagged = await adminRpc(harness, (client) => client.ListLibraryRows({}))
    expect(tagged.items.map((item) => item.tags?.map((tag) => tag.slug))).toEqual([
      ['film', 'kyoto'],
      ['kyoto'],
    ])

    expect(
      await adminRpc(harness, (client) =>
        client.BulkRemoveTags({ photoIds: [first.id], tagIds: [kyoto.id] }),
      ),
    ).toBe(1)
    const untagged = await adminRpc(harness, (client) => client.ListLibraryRows({}))
    expect(untagged.items.map((item) => item.tags?.map((tag) => tag.slug))).toEqual([
      ['film'],
      ['kyoto'],
    ])
  })

  it('fails with PhotoNotFound for an unknown photo', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')

    const error = await adminRpc(harness, (client) =>
      client.BulkAddTags({ photoIds: ['missing'], tagIds: [kyoto.id] }).pipe(Effect.flip),
    )

    expect(error).toEqual(new PhotoNotFound({ id: 'missing' }))
  })
})

describe('AddBorderToPhotos handler', () => {
  it('applies one mat patch to every selected photo', async () => {
    const harness = makeTestHarness()
    const first = await createPhoto(harness, { slug: 'a', title: 'A' })
    const second = await createPhoto(harness, { slug: 'b', title: 'B' })
    const third = await createPhoto(harness, { slug: 'c', title: 'C' })

    expect(
      await adminRpc(harness, (client) =>
        client.AddBorderToPhotos({
          photoIds: [first.id, second.id],
          mat: { enabled: true, style: 'even', colour: 'paper', width: 4 },
        }),
      ),
    ).toBe(2)

    // Read the columns rather than a second presentation save, which would
    // write over the very row it is trying to report.
    for (const id of [first.id, second.id]) {
      expect(await matOf(harness, id)).toEqual({
        borderEnabled: 1,
        borderStyle: 'even',
        borderColour: 'paper',
        borderWidth: 4,
      })
    }
    expect(await matOf(harness, third.id)).toEqual({
      borderEnabled: 0,
      borderStyle: null,
      borderColour: null,
      borderWidth: null,
    })
  })
})

describe('UpdateTag handler', () => {
  it('writes a caption and clears it again with null', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')

    const captioned = await adminRpc(harness, (client) =>
      client.UpdateTag({ id: kyoto.id, caption: 'Ferries, rain, and the long light.' }),
    )
    expect(captioned).toEqual({
      id: kyoto.id,
      slug: 'kyoto',
      label: 'Kyoto',
      caption: 'Ferries, rain, and the long light.',
    })

    const cleared = await adminRpc(harness, (client) =>
      client.UpdateTag({ id: kyoto.id, caption: null }),
    )
    expect(cleared.caption).toBeNull()
  })

  it('relabels without touching the slug', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')

    const relabelled = await adminRpc(harness, (client) =>
      client.UpdateTag({ id: kyoto.id, label: 'Kyoto Nights' }),
    )

    // A slug is a live URL: a Series page is a Tag page (ADR 0008).
    expect(relabelled).toEqual({
      id: kyoto.id,
      slug: 'kyoto',
      label: 'Kyoto Nights',
      caption: null,
    })
  })

  it('fails with InvalidInput for an unknown tag', async () => {
    const harness = makeTestHarness()

    const error = await adminRpc(harness, (client) =>
      client.UpdateTag({ id: 'missing', label: 'Nowhere' }).pipe(Effect.flip),
    )

    expect(error._tag).toBe('InvalidInput')
  })
})

describe('LibrarySort against the service sort keys', () => {
  it('offers exactly the sorts the service implements', () => {
    // The Table Head offers `TAKEN ↓` today. When a second column is added
    // the contract and `PHOTO_SORT_KEYS` have to grow together, and this is
    // what says so.
    expect(LibrarySort.fields.key.literals).toEqual(PHOTO_SORT_KEYS)
    expect(LibrarySort.fields.direction.literals).toEqual(['asc', 'desc'])
    expect({ key: DEFAULT_SORT.key, direction: DEFAULT_SORT.direction }).toEqual({
      key: 'takenAt',
      direction: 'desc',
    })
  })
})
