/**
 * The RPC handlers over the live services, driven through a real `RpcClient`
 * so the payload schema, the handler and the success schema are all in the
 * loop. This is where the public contract's slugs meet the service's ids.
 */

import { describe, expect, it } from 'vitest'
import { Effect, Layer } from 'effect'
import {
  FRONT_SECTION_COUNT,
  InvalidInput,
  PhotoAdminRpcs,
  PhotoNotFound,
  PhotoPublicRpcs,
} from '@photo/shared'
import { RpcClient, RpcTest } from 'effect/unstable/rpc'
import { Gateway } from '../gateway'
import { AdminRpcHandlersLive, PublicRpcHandlersLive } from '../rpc'
import { PhotoServiceLive, STORAGE_CAP_BYTES, type PhotoService } from '../photo'
import { PublicPhotoService, PublicPhotoServiceLive } from '../public-photo'
import { AdminSession, type AdminSessionValue } from '../session'
import { SettingsServiceLive, type SettingsService } from '../settings'
import { TagServiceLive, type TagService } from '../tag'
import {
  createPhoto,
  createTag,
  PRESENTATION_DEFAULTS,
  setPhotoStatus,
  trashPhoto,
} from './fixtures'
import { makeTestHarness, type TestHarness } from './harness'

/**
 * The handler layer over the services it talks to, and all of them over the
 * harness's Gateway. `Layer.mergeAll` does not resolve one layer's requirement
 * from another's output, so the handlers are provided the services explicitly.
 */
const stackOver = <ROut>(
  harness: TestHarness,
  handlers: Layer.Layer<
    ROut,
    never,
    PhotoService | PublicPhotoService | SettingsService | TagService
  >,
) => {
  const services = Layer.mergeAll(
    PhotoServiceLive,
    PublicPhotoServiceLive,
    SettingsServiceLive,
    TagServiceLive,
  )
  return Layer.mergeAll(services, Layer.provide(handlers, services)).pipe(
    Layer.provide(Layer.succeed(Gateway, harness.gateway)),
  )
}

interface ListPayload {
  readonly tagSlug?: string
  readonly q?: string
  readonly limit?: number
}

const makePublicClient = RpcTest.makeClient(PhotoPublicRpcs)
type PublicClient = RpcClient.FromGroup<typeof PhotoPublicRpcs>

/** One public call over a live client, so the payload schema, the handler and
 *  the success schema are all in the loop. A failing case passes `Effect.flip`
 *  and gets the typed error back as a value. */
const publicRpc = <A, E>(
  harness: TestHarness,
  call: (client: PublicClient) => Effect.Effect<A, E>,
): Promise<A> =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makePublicClient
          return yield* call(client)
        }),
      ),
      stackOver(harness, PublicRpcHandlersLive),
    ),
  )

const listPhotos = (harness: TestHarness, payload: ListPayload) =>
  publicRpc(harness, (client) => client.ListPhotos(payload))

/** A cursor is only handed back on a full page; a bare `?.` at a call site
 *  would let a regression fall through as "page one again" and pass. */
const cursorOf = (nextCursor: string | null): string => {
  if (nextCursor === null) throw new Error('expected a nextCursor')
  return nextCursor
}

/** The verified claims, as the Worker's gate hands them over. */
const VERIFIED_SESSION: AdminSessionValue = {
  email: 'owner@photo.test',
  teamDomain: 'https://team.test',
}

const deletePhoto = (harness: TestHarness, id: string) =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(PhotoAdminRpcs)
          return yield* client.DeletePhoto({ id })
        }),
      ),
      adminStackOver(harness, VERIFIED_SESSION),
    ),
  )

// ---------------------------------------------------------------------------
// the admin group
// ---------------------------------------------------------------------------

const makeAdminClient = RpcTest.makeClient(PhotoAdminRpcs)
type AdminClient = RpcClient.FromGroup<typeof PhotoAdminRpcs>

/** The admin group over the harness, with a session the way the Worker
 *  provides one: per request, from the claims the Access gate verified. */
const adminStackOver = (harness: TestHarness, session: AdminSessionValue) =>
  stackOver(harness, Layer.provide(AdminRpcHandlersLive, Layer.succeed(AdminSession, session)))

/** One admin call over a live client, so the payload schema, the handler and
 *  the success schema are all in the loop. A failing case passes `Effect.flip`
 *  and gets the typed error back as a value. */
const adminRpc = <A, E>(
  harness: TestHarness,
  call: (client: AdminClient) => Effect.Effect<A, E>,
  session: AdminSessionValue = VERIFIED_SESSION,
): Promise<A> =>
  Effect.runPromise(
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeAdminClient
          return yield* call(client)
        }),
      ),
      adminStackOver(harness, session),
    ),
  )

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

// ---------------------------------------------------------------------------
// the public group
// ---------------------------------------------------------------------------

/** One Photo a month over four months, oldest first, so the Photo Numbers
 *  ascend with the dates the Sections are grouped by. */
const MONTHS: ReadonlyArray<{ readonly slug: string; readonly takenAt: string }> = [
  { slug: 'june-01', takenAt: '2025-06-04' },
  { slug: 'june-02', takenAt: '2025-06-21' },
  { slug: 'july-01', takenAt: '2025-07-09' },
  { slug: 'august-01', takenAt: '2025-08-05' },
]

const seedMonths = async (harness: TestHarness): Promise<void> => {
  for (const month of MONTHS) {
    await createPhoto(harness, { slug: month.slug, title: month.slug, takenAt: month.takenAt })
  }
}

/** A Draft and a trashed Photo in a fifth month: the two rows no public read
 *  may return, however it is addressed. */
const seedHidden = async (
  harness: TestHarness,
): Promise<{ readonly draft: Hidden; readonly trashed: Hidden }> => {
  const created = await createPhoto(harness, {
    slug: 'september-draft',
    title: 'A draft.',
    takenAt: '2025-09-02',
  })
  const binned = await createPhoto(harness, {
    slug: 'september-trashed',
    title: 'A trashed photo.',
    takenAt: '2025-09-03',
  })
  await setPhotoStatus(harness, created.id, 'draft')
  await trashPhoto(harness, binned.id)
  return { draft: created, trashed: binned }
}

interface Hidden {
  readonly id: string
  readonly slug: string
}

const numberOf = async (harness: TestHarness, id: string): Promise<number> => {
  const row = await harness.db
    .prepare('SELECT number FROM photos WHERE id = ?')
    .bind(id)
    .first<{ number: number }>()
  if (row === null) throw new Error(`no photo ${id}`)
  return row.number
}

describe('the public group only answers for published photos', () => {
  it('leaves a draft and a trashed photo out of ListPhotos', async () => {
    const harness = makeTestHarness()
    const kept = await createPhoto(harness, {
      slug: 'kept',
      title: 'Kept',
      takenAt: '2025-08-01',
    })
    await seedHidden(harness)

    const page = await listPhotos(harness, { limit: 60 })

    expect(page.items.map((item) => item.id)).toEqual([kept.id])
  })

  it('reports a draft and a trashed id from GetPhoto as not found', async () => {
    const harness = makeTestHarness()
    const shown = await createPhoto(harness, {
      slug: 'shown',
      title: 'Shown',
      takenAt: '2025-08-01',
    })
    const { draft, trashed } = await seedHidden(harness)

    expect((await publicRpc(harness, (client) => client.GetPhoto({ id: shown.id }))).slug).toBe(
      'shown',
    )

    for (const hidden of [draft, trashed]) {
      const error = await publicRpc(harness, (client) =>
        client.GetPhoto({ id: hidden.id }).pipe(Effect.flip),
      )
      expect(error).toEqual(new PhotoNotFound({ id: hidden.id }))
    }
  })

  it('answers null from GetPublicPhoto and GetPublicPhotoByNumber for either', async () => {
    const harness = makeTestHarness()
    const shown = await createPhoto(harness, {
      slug: 'shown',
      title: 'Shown',
      takenAt: '2025-08-01',
    })
    const { draft, trashed } = await seedHidden(harness)
    const shownNumber = await numberOf(harness, shown.id)

    // The two URLs a Photo page is addressable by.
    expect((await publicRpc(harness, (c) => c.GetPublicPhoto({ slug: shown.slug })))?.number).toBe(
      shownNumber,
    )
    expect(
      (await publicRpc(harness, (c) => c.GetPublicPhotoByNumber({ number: shownNumber })))?.slug,
    ).toBe('shown')

    for (const hidden of [draft, trashed]) {
      const hiddenNumber = await numberOf(harness, hidden.id)
      expect(await publicRpc(harness, (c) => c.GetPublicPhoto({ slug: hidden.slug }))).toBeNull()
      expect(
        await publicRpc(harness, (c) => c.GetPublicPhotoByNumber({ number: hiddenNumber })),
      ).toBeNull()
    }
  })
})

describe('GetFrontPage handler', () => {
  it('renders the first paint as FRONT_SECTION_COUNT sections and leaves a cursor', async () => {
    const harness = makeTestHarness()
    await seedMonths(harness)

    const page = await publicRpc(harness, (client) => client.GetFrontPage({}))

    // The design's July and August. The page weight is `FRONT_SECTION_COUNT`'s
    // own: asserted against the constant rather than a number typed here, so
    // moving the constant moves the paint with it.
    expect(FRONT_SECTION_COUNT).toBe(2)
    expect(page.sections).toHaveLength(FRONT_SECTION_COUNT)
    expect(page.sections.map((section) => section.month)).toEqual(['2025-08', '2025-07'])
    expect(page.sections[0]).toEqual({
      month: '2025-08',
      year: '2025',
      label: 'August 2025',
      frames: 1,
      numberFrom: 4,
      numberTo: 4,
      photos: [expect.objectContaining({ slug: 'august-01' })],
    })
    expect(page.nextSectionCursor).toBe('2025-07')
  })

  it('carries the site counters as the stats', async () => {
    const harness = makeTestHarness()
    await seedMonths(harness)

    const { stats } = await publicRpc(harness, (client) => client.GetFrontPage({}))

    expect(stats).toEqual({
      number: 4,
      total: 4,
      latestTakenAt: '2025-08-05',
    })
  })

  it('resumes below the section cursor month without repeating it', async () => {
    const harness = makeTestHarness()
    await seedMonths(harness)
    const first = await publicRpc(harness, (client) => client.GetFrontPage({}))

    const second = await publicRpc(harness, (client) =>
      client.GetFrontPage({ sectionCursor: cursorOf(first.nextSectionCursor) }),
    )

    expect(second.sections.map((section) => section.month)).toEqual(['2025-06'])
    expect(second.sections.flatMap((section) => section.photos.map((photo) => photo.slug))).toEqual(
      ['june-02', 'june-01'],
    )
    expect(second.nextSectionCursor).toBeNull()
  })

  it('rejects a section cursor that is not a month rather than starting over', async () => {
    const harness = makeTestHarness()
    await seedMonths(harness)

    const error = await publicRpc(harness, (client) =>
      client.GetFrontPage({ sectionCursor: 'yesterday' }).pipe(Effect.flip),
    )

    expect(error).toEqual(
      new InvalidInput({ message: 'sectionCursor is not a YYYY-MM month: yesterday' }),
    )
  })

  it('leaves a draft and a trashed photo out of the sections and the stats', async () => {
    const harness = makeTestHarness()
    await seedMonths(harness)
    await seedHidden(harness)

    const page = await publicRpc(harness, (client) => client.GetFrontPage({ sectionCount: 5 }))

    expect(page.sections.map((section) => section.month)).toEqual(['2025-08', '2025-07', '2025-06'])
    expect(
      page.sections.flatMap((section) => section.photos).map((photo) => photo.slug),
    ).not.toContain('september-draft')
    expect(page.stats.total).toBe(4)
    expect(page.stats.number).toBe(4)
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
})

describe('the admin group GetPhoto', () => {
  it('answers with the draft the public group calls not found', async () => {
    const harness = makeTestHarness()
    const created = await createPhoto(harness, { slug: 'alley', title: 'Alley' })
    await setPhotoStatus(harness, created.id, 'draft')

    // The Editor's Photo is a Draft, so the admin route is where `/admin/photos/:id`
    // reads it — and the ungated `/rpc` is the one that has to refuse.
    expect((await adminRpc(harness, (client) => client.GetPhoto({ id: created.id }))).status).toBe(
      'draft',
    )
    expect(
      await publicRpc(harness, (client) => client.GetPhoto({ id: created.id }).pipe(Effect.flip)),
    ).toEqual(new PhotoNotFound({ id: created.id }))
  })
})

describe('GetCounts handler', () => {
  it('reports the total, each status, each tag and the trashed count, with no scheduled key', async () => {
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

    // The trashed Photo is out of every live count and in `trashed`; the Tag
    // it carried is neither. `toEqual` pins the key set, so a `scheduled` count
    // appearing here fails this without a second assertion.
    expect(result).toEqual({
      total: 1,
      trashed: 1,
      byStatus: { draft: 1, published: 0, failed: 0 },
      byTag: [
        { id: kyoto.id, label: 'Kyoto', count: 0 },
        { id: unused.id, label: 'Unused', count: 0 },
      ],
    })
  })
})

describe('GetStorageUsage handler', () => {
  it('answers with the photos, the bytes and the bucket cap', async () => {
    const harness = makeTestHarness()
    await createPhoto(harness, { slug: 'sunset', title: 'Sunset' })

    const usage = await adminRpc(harness, (client) => client.GetStorageUsage({}))

    // `photos`, not `frames`: ADR 0006, and the design prints `412 FRAMES`.
    expect(usage.photos).toBe(1)
    expect(usage.bytes).toBeGreaterThan(0)
    // The cap rides the answer rather than being read from a Settings row: it is
    // the one constant `STORAGE_CAP_BYTES` names, which is the 20 GiB the
    // Settings Storage block and the sidebar's meter both draw (ADR 0006).
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

    // The Pager's `OF 412` is the filtered total, and it is counted under the
    // same predicate the rows are read under — so each of these narrows to the
    // one Photo it returned, and the unfiltered read sees both.
    expect(byStatus.total).toBe(1)
    expect(byRatio.total).toBe(0)
    expect(byTag.total).toBe(1)
    expect(byQ.total).toBe(1)
    const unfiltered = await adminRpc(harness, (client) => client.ListLibraryRows({}))
    expect(unfiltered.total).toBe(2)

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
})

describe('UpdatePhoto handler', () => {
  it('writes the Ratio, which is a Photo column rather than a Presentation field', async () => {
    const harness = makeTestHarness()
    const created = await createPhoto(harness, { slug: 'sunset', title: 'Sunset' })

    const updated = await adminRpc(harness, (client) =>
      client.UpdatePhoto({ id: created.id, ratio: '4:3' }),
    )

    expect(updated.ratio).toBe('4:3')
  })

  it('writes the client re-encoded Blurhash, a Photo column beside the Ratio', async () => {
    const harness = makeTestHarness()
    const created = await createPhoto(harness, { slug: 'sunset', title: 'Sunset' })
    const hash = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'

    const updated = await adminRpc(harness, (client) =>
      client.UpdatePhoto({ id: created.id, blurhash: hash }),
    )

    expect(updated.blurhash).toBe(hash)
  })

  it('rejects an empty update even though a Ratio would have been one', async () => {
    const harness = makeTestHarness()
    const created = await createPhoto(harness, { slug: 'sunset', title: 'Sunset' })

    const error = await adminRpc(harness, (client) =>
      client.UpdatePhoto({ id: created.id }).pipe(Effect.flip),
    )

    expect(error).toBeInstanceOf(InvalidInput)
  })
})

describe('UpdatePhotoPresentation handler', () => {
  it('round-trips the crop, the mat and the export overrides in one call', async () => {
    const harness = makeTestHarness()
    const created = await createPhoto(harness, { slug: 'sunset', title: 'Sunset' })

    const saved = await adminRpc(harness, (client) =>
      client.UpdatePhotoPresentation({
        id: created.id,
        crop: { x: 12.5, y: 4, scale: 1.8, flipX: true },
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
      cropFlipX: true,
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

    expect(saved).toEqual({ ...PRESENTATION_DEFAULTS, level: 1.25 })
  })

  it('rejects an empty patch', async () => {
    const harness = makeTestHarness()
    const created = await createPhoto(harness, { slug: 'sunset', title: 'Sunset' })

    const error = await adminRpc(harness, (client) =>
      client.UpdatePhotoPresentation({ id: created.id }).pipe(Effect.flip),
    )

    expect(error._tag).toBe('InvalidInput')
  })

  it('clears the level and the mat detail with null, and leaves the rest alone', async () => {
    const harness = makeTestHarness()
    const created = await createPhoto(harness, { slug: 'sunset', title: 'Sunset' })
    await adminRpc(harness, (client) =>
      client.UpdatePhotoPresentation({
        id: created.id,
        level: -2.5,
        mat: { enabled: true, style: 'gallery', colour: 'ink', width: 4 },
      }),
    )

    const cleared = await adminRpc(harness, (client) =>
      client.UpdatePhotoPresentation({
        id: created.id,
        level: null,
        mat: { enabled: true, style: null, colour: null, width: null },
      }),
    )

    // Null is un-levelled, not zero, and a mat with no detail is un-set. The
    // crop and the export overrides are not in the patch, so they keep the
    // row's own values rather than being reset.
    expect(cleared.level).toBeNull()
    expect(cleared.borderStyle).toBeNull()
    expect(cleared.borderColour).toBeNull()
    expect(cleared.borderWidth).toBeNull()
    expect(cleared).toEqual({ ...PRESENTATION_DEFAULTS, borderEnabled: true })
  })
})

describe('TrashPhotos, RestorePhotos and PurgePhotos handlers', () => {
  it('takes arrays in and moves every id in the set', async () => {
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
    ).toBeUndefined()
    expect((await listPhotos(harness, { limit: 60 })).items.map((item) => item.id)).toEqual([
      third.id,
    ])

    expect(
      await adminRpc(harness, (client) => client.RestorePhotos({ ids: [first.id] })),
    ).toBeUndefined()
    expect((await listPhotos(harness, { limit: 60 })).items.map((item) => item.id)).toEqual([
      first.id,
      third.id,
    ])

    expect(
      await adminRpc(harness, (client) => client.PurgePhotos({ ids: [second.id] })),
    ).toBeUndefined()
    expect(await harness.photos.head('o/b.jpg')).toBeNull()
  })

  it('leaves a photo already in the target state in it', async () => {
    const harness = makeTestHarness()
    const created = await createPhoto(harness, { slug: 'a', title: 'A' })

    await adminRpc(harness, (client) => client.TrashPhotos({ ids: [created.id] }))
    await adminRpc(harness, (client) => client.TrashPhotos({ ids: [created.id] }))

    // Idempotent means still trashed, not "reported done again": the Photo
    // stays out of the list and its original stays in R2.
    expect(await listPhotos(harness, { limit: 60 })).toEqual({ items: [], nextCursor: null })
    expect(await harness.photos.head('originals/a.jpg')).not.toBeNull()

    await adminRpc(harness, (client) => client.RestorePhotos({ ids: [created.id] }))
    await adminRpc(harness, (client) => client.RestorePhotos({ ids: [created.id] }))

    expect((await listPhotos(harness, { limit: 60 })).items.map((item) => item.id)).toEqual([
      created.id,
    ])
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
    ).toBeUndefined()
    const tagged = await adminRpc(harness, (client) => client.ListLibraryRows({}))
    expect(tagged.items.map((item) => item.tags?.map((tag) => tag.slug))).toEqual([
      ['film', 'kyoto'],
      ['kyoto'],
    ])

    expect(
      await adminRpc(harness, (client) =>
        client.BulkRemoveTags({ photoIds: [first.id], tagIds: [kyoto.id] }),
      ),
    ).toBeUndefined()
    const untagged = await adminRpc(harness, (client) => client.ListLibraryRows({}))
    expect(untagged.items.map((item) => item.tags?.map((tag) => tag.slug))).toEqual([
      ['film'],
      ['kyoto'],
    ])
  })

  it('reports a tag id nobody carries as InvalidInput, and links nothing', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const created = await createPhoto(harness, { slug: 'a', title: 'A' })

    // The good Tag is in the same call, so this also pins that a stale id
    // rolls the batch back rather than linking half the set.
    const error = await adminRpc(harness, (client) =>
      client
        .BulkAddTags({ photoIds: [created.id], tagIds: [kyoto.id, 'tag_missing'] })
        .pipe(Effect.flip),
    )

    expect(error).toEqual(new InvalidInput({ message: 'no tag with id tag_missing' }))
    const rows = await adminRpc(harness, (client) => client.ListLibraryRows({}))
    expect(rows.items[0]?.tags).toEqual([])
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
    ).toBeUndefined()

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

    // A slug is a live URL: a Series page is a Tag page (ADR 0006).
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
