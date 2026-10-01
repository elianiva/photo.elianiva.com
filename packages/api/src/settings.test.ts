import { describe, expect, it } from 'vitest'
import { Effect, Layer } from 'effect'
import { RpcClient, RpcTest } from 'effect/unstable/rpc'
import { InvalidInput, PhotoAdminRpcs, type Settings, type SettingsInput } from '@photo/shared'
import { SettingsService, SettingsServiceLive } from './settings'
import { AdminRpcHandlersLive } from './rpc'
import { Gateway } from './gateway'
import { PhotoService, PhotoServiceLive } from './photo'
import { PublicPhotoServiceLive } from './public-photo'
import { AdminSession } from './session'
import { TagServiceLive } from './tag'
import { createPhoto, createTag, fail, SETTINGS_DEFAULTS, trashPhoto } from './testing/fixtures'
import { makeTestHarness, queryRow, queryRows, withTestServices, type TestHarness } from './testing/harness'

const ISO_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const readSettings = (harness: TestHarness): Promise<Settings> =>
  Effect.runPromise(
    withTestServices(
      SettingsService.use((service) => service.read),
      harness,
    ),
  )

const updateSettings = (harness: TestHarness, input: SettingsInput): Promise<Settings> =>
  Effect.runPromise(
    withTestServices(
      SettingsService.use((service) => service.update(input)),
      harness,
    ),
  )

const tryUpdate = (harness: TestHarness, input: SettingsInput) =>
  fail(
    withTestServices(
      SettingsService.use((service) => service.update(input)),
      harness,
    ),
  )

/** The columns as SQLite holds them, which is the only place a boolean and an
 *  integer can be told apart. */
const flagColumnsOf = (harness: TestHarness) =>
  queryRow<{
    watermarkEnabled: number
    defaultKeepExif: number
    defaultRemoveGps: number
    retainForever: number
  }>(harness, (sql) =>
    sql`SELECT watermarkEnabled, defaultKeepExif, defaultRemoveGps, retainForever
        FROM settings WHERE id = 1`,
  )

const stampOf = (harness: TestHarness, stamp: string): Promise<unknown> =>
  queryRows(harness, (sql) => sql`UPDATE settings SET updatedAt = ${stamp} WHERE id = 1`)

describe('SettingsService', () => {
  it('reads the column defaults off a freshly migrated row', async () => {
    const harness = makeTestHarness()

    // The migration writes the row; `settings-migration.test.ts` asserts it
    // straight off the table. What is asserted here is the read: the service
    // hands back the row's own columns and never invents a value.
    expect(await readSettings(harness)).toEqual({
      ...SETTINGS_DEFAULTS,
      updatedAt: expect.stringMatching(ISO_STAMP),
    })
  })

  it('round-trips every column', async () => {
    const harness = makeTestHarness()
    const input: SettingsInput = {
      defaultPreviewLongEdge: 2400,
      defaultPreviewFormat: 'webp',
      defaultPreviewQuality: 70,
      defaultFullQuality: 95,
      watermarkEnabled: true,
      watermarkColour: 'ink',
      watermarkPosition: 'centre',
      defaultKeepExif: false,
      defaultRemoveGps: false,
      retainForever: false,
    }

    const saved = await updateSettings(harness, input)

    expect(saved).toEqual({ ...input, updatedAt: saved.updatedAt })
    expect(await readSettings(harness)).toEqual(saved)
  })

  it('stamps a fresh updatedAt on a save that changes nothing', async () => {
    const harness = makeTestHarness()
    const input: SettingsInput = { ...SETTINGS_DEFAULTS, defaultPreviewLongEdge: 2400 }
    const first = await updateSettings(harness, input)
    await stampOf(harness, '2001-01-01T00:00:00.000Z')

    const second = await updateSettings(harness, input)

    expect(first.updatedAt).toMatch(ISO_STAMP)
    // A save is a fact about the write, so the stamp moves even when the row
    // is already what the operator sent.
    expect(second.updatedAt).toMatch(ISO_STAMP)
    expect(second.updatedAt).not.toBe('2001-01-01T00:00:00.000Z')
    expect({ ...second, updatedAt: first.updatedAt }).toEqual(first)
  })

  it('writes the four boolean columns as 0 and 1, and reads both back', async () => {
    const harness = makeTestHarness()

    const off = await updateSettings(harness, {
      ...SETTINGS_DEFAULTS,
      watermarkEnabled: false,
      defaultKeepExif: false,
      defaultRemoveGps: false,
      retainForever: false,
    })

    // The migration's row starts 0/1/1/1, so this write is a real 1 -> 0 on
    // three columns and stays 0 on the fourth.
    expect(await flagColumnsOf(harness)).toEqual({
      watermarkEnabled: 0,
      defaultKeepExif: 0,
      defaultRemoveGps: 0,
      retainForever: 0,
    })
    expect(off.watermarkEnabled).toBe(false)
    expect(off.defaultKeepExif).toBe(false)
    expect(off.defaultRemoveGps).toBe(false)
    expect(off.retainForever).toBe(false)

    const on = await updateSettings(harness, {
      ...SETTINGS_DEFAULTS,
      watermarkEnabled: true,
      defaultKeepExif: true,
      defaultRemoveGps: true,
      retainForever: true,
    })

    expect(await flagColumnsOf(harness)).toEqual({
      watermarkEnabled: 1,
      defaultKeepExif: 1,
      defaultRemoveGps: 1,
      retainForever: 1,
    })
    expect(on.watermarkEnabled).toBe(true)
    expect(on.defaultKeepExif).toBe(true)
    expect(on.defaultRemoveGps).toBe(true)
    expect(on.retainForever).toBe(true)
  })

  it('refuses a preview quality outside 1..100 and writes nothing', async () => {
    const harness = makeTestHarness()

    const error = await tryUpdate(harness, { ...SETTINGS_DEFAULTS, defaultPreviewQuality: 101 })

    expect(error).toBeInstanceOf(InvalidInput)
    expect((await readSettings(harness)).defaultPreviewQuality).toBe(82)
  })

  it('refuses a long edge that is not positive and writes nothing', async () => {
    const harness = makeTestHarness()

    const error = await tryUpdate(harness, { ...SETTINGS_DEFAULTS, defaultPreviewLongEdge: 0 })

    expect(error).toBeInstanceOf(InvalidInput)
    expect((await readSettings(harness)).defaultPreviewLongEdge).toBe(1200)
  })

  it('reads the column defaults when the singleton row is missing', async () => {
    const harness = makeTestHarness()
    await queryRows(harness, (sql) => sql`DELETE FROM settings WHERE id = 1`)

    // A row the migration never wrote is a fresh page, not a broken one, and it
    // has never been saved — so the
    // stamp is null rather than a date the operator never chose.
    expect(await readSettings(harness)).toEqual({ ...SETTINGS_DEFAULTS, updatedAt: null })
  })
})

interface IndexRowSeed {
  readonly id: string
  readonly slug: string
  readonly title?: string
  readonly number?: number | null
  readonly ratio?: string | null
  readonly takenAt?: string | null
  readonly bytes?: number | null
  readonly metadata?: string
  readonly deletedAt?: string | null
  readonly tagIds?: ReadonlyArray<string>
}

/** Rows the service API cannot produce: a fixed id, a Photo Number the counter
 *  never spent, and a metadata blob with a place in it. */
const seedIndexRow = async (harness: TestHarness, row: IndexRowSeed): Promise<void> => {
  await queryRows(harness, (sql) =>
    sql`INSERT INTO photos (id, slug, title, r2Key, width, height, status, number, ratio, bytes, takenAt, metadata, blurhash, deletedAt)
        VALUES (${row.id}, ${row.slug}, ${row.title ?? row.slug}, ${`originals/${row.id}.jpg`},
                1200, 800, 'published', ${row.number ?? null},
                ${row.ratio === undefined ? '3:2' : row.ratio}, ${row.bytes ?? null},
                ${row.takenAt ?? null}, ${row.metadata ?? '{}'}, ${null}, ${row.deletedAt ?? null})`,
  )
  for (const tagId of row.tagIds ?? []) {
    await queryRows(harness, (sql) =>
      sql`INSERT INTO photo_tags (photoId, tagId) VALUES (${row.id}, ${tagId})`,
    )
  }
}

const indexRows = (harness: TestHarness) =>
  Effect.runPromise(
    withTestServices(
      PhotoService.use((service) => service.index()),
      harness,
    ),
  )

// The admin group as the Worker mounts it, over the harness: the services the
// handlers talk to, the session the Access gate proved, and the Gateway all of
// them read through. The group's own requirements are answered by the services
// merged beside it, which is the Worker's arrangement and not an accident of
// this file.
const adminStackOver = (harness: TestHarness) => {
  const services = Layer.mergeAll(
    PhotoServiceLive,
    PublicPhotoServiceLive,
    SettingsServiceLive,
    TagServiceLive,
  )
  return Layer.mergeAll(
    services,
    Layer.provide(
      AdminRpcHandlersLive,
      Layer.succeed(AdminSession, { email: 'owner@elianiva.com', teamDomain: 'elianiva.com' }),
    ),
  ).pipe(Layer.provide(services), Layer.provide(Layer.succeed(Gateway, harness.gateway)))
}

const makeAdminClient = RpcTest.makeClient(PhotoAdminRpcs)
type AdminClient = RpcClient.FromGroup<typeof PhotoAdminRpcs>

/** One admin call over a real client, so the payload schema, the handler and
 *  the success schema are all in the loop. */
const adminRpc = <A, E>(
  harness: TestHarness,
  call: (client: AdminClient) => Effect.Effect<A, E>,
): Promise<A> =>
  // `harness.run` is what closes the `SqlClient` and `Batch` the service stack
  // needs — the same seam the service tests above it uses.
  Effect.runPromise(
    harness.run(
      Effect.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeAdminClient
            return yield* call(client)
          }),
        ),
        adminStackOver(harness),
      ),
    ),
  )

describe('the admin group settings calls', () => {
  it('reads, saves and indexes over the wire', async () => {
    const harness = makeTestHarness()
    const input: SettingsInput = {
      defaultPreviewLongEdge: 1800,
      defaultPreviewFormat: 'jpeg',
      defaultPreviewQuality: 60,
      defaultFullQuality: 90,
      watermarkEnabled: true,
      watermarkColour: 'paper',
      watermarkPosition: 'top-left',
      defaultKeepExif: true,
      defaultRemoveGps: true,
      retainForever: true,
    }
    await createPhoto(harness, { slug: 'ferries', title: 'Ferries' })

    const read: Settings = await adminRpc(harness, (client) => client.GetSettings({}))
    const saved: Settings = await adminRpc(harness, (client) => client.UpdateSettings(input))
    const index = await adminRpc(harness, (client) => client.ListPhotoIndex({}))

    // The read answers the row as it stands, and a save answers the stored row
    // rather than the request. Booleans and literal unions all survive the JSON
    // codec, which is the only place a 0 could turn back into a false.
    expect(read.defaultPreviewFormat).toBe('avif')
    expect(saved).toEqual({ ...input, updatedAt: saved.updatedAt })
    expect(saved.updatedAt).toMatch(ISO_STAMP)
    expect(index.items).toEqual([
      {
        number: 1,
        title: 'Ferries',
        slug: 'ferries',
        ratio: '3:2',
        takenAt: null,
        place: null,
        tags: [],
        bytes: 4,
      },
    ])
  })
})

describe('the CSV index', () => {
  it('leaves a trashed photo out', async () => {
    const harness = makeTestHarness()
    const kept = await createPhoto(harness, { slug: 'kept', title: 'Kept' })
    const binned = await createPhoto(harness, { slug: 'binned', title: 'Binned' })
    await trashPhoto(harness, binned.id)

    const rows = await indexRows(harness)

    expect(rows.map((row) => row.slug)).toEqual(['kept'])
    expect(rows[0]?.number).toBe(1)
    expect(kept.id).not.toBe(binned.id)
  })

  it('lists a photo with no number and no tags as null and an empty list', async () => {
    const harness = makeTestHarness()
    await seedIndexRow(harness, {
      id: 'photo_unnumbered',
      slug: 'unnumbered',
      title: 'Unnumbered',
    })

    const rows = await indexRows(harness)

    expect(rows).toEqual([
      {
        number: null,
        title: 'Unnumbered',
        slug: 'unnumbered',
        ratio: '3:2',
        takenAt: null,
        place: null,
        tags: [],
        bytes: null,
      },
    ])
  })

  it('reads place out of the metadata blob, and leaves null when there is none', async () => {
    const harness = makeTestHarness()
    await seedIndexRow(harness, {
      id: 'photo_named',
      slug: 'ferries',
      title: 'Ferries',
      number: 1,
      metadata: '{"caption":"Golden hour","location":"Istiklal"}',
    })
    await seedIndexRow(harness, {
      id: 'photo_captured',
      slug: 'captured',
      title: 'Captured',
      number: 2,
      metadata: '{"caption":"No place recorded"}',
    })
    // The blob holds whatever the extraction wrote; only a string is a place.
    await seedIndexRow(harness, {
      id: 'photo_coords',
      slug: 'coords',
      title: 'Coords',
      number: 3,
      metadata: '{"location":41.0082}',
    })

    const rows = await indexRows(harness)

    expect(rows.map((row) => row.place)).toEqual(['Istiklal', null, null])
  })

  it('orders by Photo Number, unnumbered rows last', async () => {
    const harness = makeTestHarness()
    await seedIndexRow(harness, { id: 'photo_three', slug: 'three', number: 3 })
    await seedIndexRow(harness, { id: 'photo_one', slug: 'one', number: 1 })
    await seedIndexRow(harness, { id: 'photo_two', slug: 'two', number: 2 })
    await seedIndexRow(harness, { id: 'photo_u1', slug: 'undated-one' })
    await seedIndexRow(harness, { id: 'photo_u2', slug: 'undated-two' })

    const rows = await indexRows(harness)

    // Photo Number is the site's serial, so the index is a serial-ordered list.
    // A Photo nobody numbered sorts last rather than first, and two of them
    // fall back to id.
    expect(rows.map((row) => row.slug)).toEqual([
      'one',
      'two',
      'three',
      'undated-one',
      'undated-two',
    ])
    expect(rows[0]).toEqual({
      number: 1,
      title: 'one',
      slug: 'one',
      ratio: '3:2',
      takenAt: null,
      place: null,
      tags: [],
      bytes: null,
    })
  })

  it('lists each photo tag labels alphabetically', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const film = await createTag(harness, 'film', 'Film')
    const alley = await createTag(harness, 'mmm', 'Alley')
    await seedIndexRow(harness, {
      id: 'photo_tagged',
      slug: 'sunset',
      title: 'Sunset',
      number: 7,
      bytes: 2048,
      takenAt: '2025-08-31',
      tagIds: [kyoto.id, film.id, alley.id],
    })
    await seedIndexRow(harness, { id: 'photo_bare', slug: 'bare', title: 'Bare', number: 8 })

    const rows = await indexRows(harness)

    expect(rows[0]).toEqual({
      number: 7,
      title: 'Sunset',
      slug: 'sunset',
      ratio: '3:2',
      takenAt: '2025-08-31',
      place: null,
      tags: ['Alley', 'Film', 'Kyoto'],
      bytes: 2048,
    })
    expect(rows[1]?.tags).toEqual([])
  })
})
