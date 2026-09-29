/**
 * The RPC handlers over the live services, driven through a real `RpcClient`
 * so the payload schema, the handler and the success schema are all in the
 * loop. The admin group is built from a verified session, because that is
 * what the edge gate hands the Worker (ADR 0007).
 */

import { describe, expect, it } from 'vitest'
import { Effect, Layer } from 'effect'
import { PhotoAdminRpcs, PhotoNotFound, PhotoPublicRpcs } from '@photo/shared'
import { RpcTest } from 'effect/unstable/rpc'
import { Gateway } from '../gateway'
import { adminRpcHandlersLive, PublicRpcHandlersLive, type AdminSession } from '../rpc'
import { PhotoServiceLive, STORAGE_CAP_BYTES, type PhotoService } from '../photo'
import { TagServiceLive, type TagService } from '../tag'
import { createPhoto, createTag } from './fixtures'
import { makeTestHarness, type TestHarness } from './harness'

/** The claim a verified Access session carries. */
const OWNER: AdminSession = { email: 'owner@photo.test', teamDomain: 'https://team.test' }

/** The `dev` stage's claim: the gate stood down, so there is nothing to report. */
const STOOD_DOWN: AdminSession = { email: null, teamDomain: '' }

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
  readonly tagIds?: ReadonlyArray<string>
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

const getSession = (harness: TestHarness, session: AdminSession) =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(PhotoAdminRpcs)
          return yield* client.GetSession({})
        }),
      ),
      stackOver(harness, adminRpcHandlersLive(session)),
    ),
  )

const getCounts = (harness: TestHarness) =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(PhotoAdminRpcs)
          return yield* client.GetCounts({})
        }),
      ),
      stackOver(harness, adminRpcHandlersLive(OWNER)),
    ),
  )

const getStorageUsage = (harness: TestHarness) =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(PhotoAdminRpcs)
          return yield* client.GetStorageUsage({})
        }),
      ),
      stackOver(harness, adminRpcHandlersLive(OWNER)),
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
      stackOver(harness, adminRpcHandlersLive(OWNER)),
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
        stackOver(harness, adminRpcHandlersLive(OWNER)),
      ),
    ),
  )

const slugsIn = (harness: TestHarness): Promise<ReadonlyArray<string>> =>
  harness.db
    .prepare('SELECT slug FROM photos')
    .all<{ slug: string }>()
    .then((raw) => raw.results?.map((row) => row.slug) ?? [])

describe('ListPhotos handler', () => {
  it('returns the photos carrying any of the given tags', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const film = await createTag(harness, 'film', 'Film')
    const temple = await createPhoto(harness, {
      slug: 'temple',
      title: 'Temple',
      takenAt: '2024-05-01',
      tagIds: [kyoto.id, film.id],
    })
    const harbour = await createPhoto(harness, {
      slug: 'harbour',
      title: 'Harbour',
      takenAt: '2024-04-01',
      tagIds: [film.id],
    })
    await createPhoto(harness, { slug: 'untagged', title: 'Untagged' })

    // Any-of, not all-of: the sidebar's tag filter is multi-select, so a Photo
    // carrying just one of the picked tags is a match. Newest first, and the
    // dates are fixed because an undated Photo is ordered by its random id.
    const page = await listPhotos(harness, { tagIds: [kyoto.id, film.id] })
    expect(page.items.map((item) => item.id)).toEqual([temple.id, harbour.id])
    expect(
      (await listPhotos(harness, { tagIds: [kyoto.id] })).items.map((item) => item.id),
    ).toEqual([temple.id])
  })

  it('answers a tag nobody carries with an empty page', async () => {
    const harness = makeTestHarness()
    const istanbul = await createTag(harness, 'istanbul', 'Istanbul')
    await createPhoto(harness, { slug: 'balik', title: 'Balık', tagIds: [istanbul.id] })

    expect((await listPhotos(harness, { tagIds: ['tag_nowhere'] })).items).toEqual([])
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
  it('answers with the claim the gate verified', async () => {
    const harness = makeTestHarness()

    // The gate already checked this email against the Access application and
    // the allowlist; the handler reads it, it does not ask again.
    expect(await getSession(harness, OWNER)).toEqual({
      email: 'owner@photo.test',
      teamDomain: 'https://team.test',
    })
  })

  it('answers with a null email where the gate stood down', async () => {
    const harness = makeTestHarness()

    expect(await getSession(harness, STOOD_DOWN)).toEqual({ email: null, teamDomain: '' })
  })
})

describe('GetCounts handler', () => {
  it('answers the sidebar payload the shared contract declares', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const sunset = await createPhoto(harness, {
      slug: 'sunset',
      title: 'Sunset',
      tagIds: [kyoto.id],
    })
    await deletePhoto(harness, sunset.id)
    await createPhoto(harness, { slug: 'harbour', title: 'Harbour' })

    // The client decodes through the contract's success schema, so an exact
    // match is the whole declared shape — including the Trash, which is the
    // one count over Photos no other read can see.
    expect(await getCounts(harness)).toEqual({
      total: 1,
      trashed: 1,
      byStatus: { draft: 0, published: 1, failed: 0 },
      byTag: [{ id: kyoto.id, label: 'Kyoto', count: 0 }],
    })
  })
})

describe('GetStorageUsage handler', () => {
  it('answers the live meter against the configured cap', async () => {
    const harness = makeTestHarness()
    const kept = await createPhoto(harness, { slug: 'sunset', title: 'Sunset' })
    const binned = await createPhoto(harness, { slug: 'binned', title: 'Binned' })
    await deletePhoto(harness, binned.id)

    const usage = await getStorageUsage(harness)

    expect(usage.photos).toBe(1)
    expect(usage.bytes).toBe(4)
    // The cap is a property of the bucket, so it arrives with the measurement
    // rather than being a second read of a Settings row that is not there.
    expect(usage.capBytes).toBe(STORAGE_CAP_BYTES)
    expect(await harness.photos.head(kept.r2Key)).not.toBeNull()
  })
})
