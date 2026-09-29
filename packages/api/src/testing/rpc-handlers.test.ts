/**
 * The RPC handlers over the live services, driven through a real `RpcClient`
 * so the payload schema, the handler and the success schema are all in the
 * loop. This is where the public contract's slugs meet the service's ids.
 */

import { describe, expect, it } from 'vitest'
import { Effect, Layer } from 'effect'
import { PhotoAdminRpcs, PhotoNotFound, PhotoPublicRpcs } from '@photo/shared'
import { RpcTest } from 'effect/unstable/rpc'
import { Gateway } from '../gateway'
import { AdminRpcHandlersLive, PublicRpcHandlersLive } from '../rpc'
import { PhotoServiceLive, type PhotoService } from '../photo'
import { TagServiceLive, type TagService } from '../tag'
import { createPhoto, createTag } from './fixtures'
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
      stackOver(harness, AdminRpcHandlersLive),
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
        stackOver(harness, AdminRpcHandlersLive),
      ),
    ),
  )

const slugsIn = (harness: TestHarness): Promise<ReadonlyArray<string>> =>
  harness.db
    .prepare('SELECT slug FROM photos')
    .all<{ slug: string }>()
    .then((raw) => raw.results?.map((row) => row.slug) ?? [])

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
