import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { InvalidInput, SlugConflict } from '@photo/shared'
import type { D1DatabaseLike } from '../gateway'
import { PhotoService } from '../photo'
import { TagService, type TagUpdatePatch } from '../tag'
import { createPhoto, createTag, fail } from './fixtures'
import { makeTestHarness, withTestServices, type TestHarness } from './harness'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const listTags = (harness: TestHarness) =>
  Effect.runPromise(
    withTestServices(
      TagService.use((service) => service.list),
      harness,
    ),
  )

const removeTag = (harness: TestHarness, id: string) =>
  Effect.runPromise(
    withTestServices(
      TagService.use((service) => service.remove(id)),
      harness,
    ),
  )

const updateTag = (harness: TestHarness, id: string, patch: TagUpdatePatch) =>
  Effect.runPromise(
    withTestServices(
      TagService.use((service) => service.update(id, patch)),
      harness,
    ),
  )

const linkedTagIds = (db: D1DatabaseLike): Promise<ReadonlyArray<string>> =>
  db
    .prepare('SELECT tagId FROM photo_tags ORDER BY tagId')
    .all<{ tagId: string }>()
    .then((raw) => raw.results?.map((row) => row.tagId) ?? [])

describe('TagService.list', () => {
  it('orders by label, not by slug', async () => {
    const harness = makeTestHarness()
    const zen = await createTag(harness, 'zen', 'Alley')
    const alpha = await createTag(harness, 'alpha', 'Zebra')

    expect(await listTags(harness)).toEqual([
      { id: zen.id, slug: 'zen', label: 'Alley', caption: null },
      { id: alpha.id, slug: 'alpha', label: 'Zebra', caption: null },
    ])
  })

  it('returns an empty list when there are no tags', async () => {
    const harness = makeTestHarness()

    expect(await listTags(harness)).toEqual([])
  })
})

describe('TagService.create', () => {
  it('slugifies the input and returns the stored tag', async () => {
    const harness = makeTestHarness()

    const tag = await createTag(harness, '  Golden Hour!! ', 'Golden Hour')

    expect(tag.id).toMatch(UUID)
    expect(await listTags(harness)).toEqual([
      { id: tag.id, slug: 'golden-hour', label: 'Golden Hour', caption: null },
    ])
  })

  it('falls back to the untitled slug for input with nothing sluggable', async () => {
    const harness = makeTestHarness()

    const tag = await createTag(harness, '---', 'Untitled')

    expect(tag.slug).toBe('untitled')
    expect(tag.label).toBe('Untitled')
  })

  it('fails with SlugConflict carrying the slugified slug', async () => {
    const harness = makeTestHarness()
    const first = await createTag(harness, 'Golden Hour', 'Golden Hour')

    const error = await fail(
      withTestServices(
        TagService.use((service) => service.create({ slug: 'GOLDEN HOUR', label: 'Again' })),
        harness,
      ),
    )

    expect(error).toEqual(new SlugConflict({ slug: 'golden-hour' }))
    expect(await listTags(harness)).toEqual([
      { id: first.id, slug: 'golden-hour', label: 'Golden Hour', caption: null },
    ])
  })
})

describe('TagService.remove', () => {
  it('succeeds for an unknown id', async () => {
    const harness = makeTestHarness()
    const tag = await createTag(harness, 'film', 'Film')

    expect(await removeTag(harness, 'missing')).toBe(true)
    expect(await listTags(harness)).toEqual([
      { id: tag.id, slug: 'film', label: 'Film', caption: null },
    ])
  })

  it('deletes the tag and its photo_tags links, leaving the Photo intact', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    const film = await createTag(harness, 'film', 'Film')
    const photo = await createPhoto(harness, {
      slug: 'temple',
      title: 'temple',
      tagIds: [kyoto.id],
    })
    expect(await linkedTagIds(harness.db)).toEqual([kyoto.id])

    expect(await removeTag(harness, kyoto.id)).toBe(true)

    expect(await listTags(harness)).toEqual([
      { id: film.id, slug: 'film', label: 'Film', caption: null },
    ])
    expect(await linkedTagIds(harness.db)).toEqual([])
    const page = await Effect.runPromise(
      withTestServices(
        PhotoService.use((service) => service.list({})),
        harness,
      ),
    )
    expect(page.items.map((item) => item.id)).toEqual([photo.id])
    expect(page.items[0]?.tags).toEqual([])
  })
})

describe('TagService.update', () => {
  it('writes a caption and leaves the slug alone', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')

    const tag = await updateTag(harness, kyoto.id, {
      caption: 'Ferries, rain, and the long light on Istiklal.',
    })

    expect(tag).toEqual({
      id: kyoto.id,
      slug: 'kyoto',
      label: 'Kyoto',
      caption: 'Ferries, rain, and the long light on Istiklal.',
    })
  })

  it('clears a caption with null, never an empty string', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')
    await updateTag(harness, kyoto.id, { caption: 'A sentence.' })

    const cleared = await updateTag(harness, kyoto.id, { caption: null })

    expect(cleared.caption).toBeNull()
    expect(await listTags(harness)).toEqual([
      { id: kyoto.id, slug: 'kyoto', label: 'Kyoto', caption: null },
    ])
  })

  it('relabels without touching the slug', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')

    const relabelled = await updateTag(harness, kyoto.id, { label: 'Kyoto Nights' })

    // A slug is a live URL: the public Series page is a Tag page (ADR 0008),
    // so renaming one is delete + create, not an update.
    expect(relabelled).toEqual({
      id: kyoto.id,
      slug: 'kyoto',
      label: 'Kyoto Nights',
      caption: null,
    })
  })

  it('fails with InvalidInput for an unknown id', async () => {
    const harness = makeTestHarness()

    const error = await fail(
      withTestServices(
        TagService.use((service) => service.update('missing', { label: 'Nowhere' })),
        harness,
      ),
    )

    expect(error).toBeInstanceOf(InvalidInput)
  })

  it('answers the current tag for an empty patch', async () => {
    const harness = makeTestHarness()
    const kyoto = await createTag(harness, 'kyoto', 'Kyoto')

    expect(await updateTag(harness, kyoto.id, {})).toEqual({
      id: kyoto.id,
      slug: 'kyoto',
      label: 'Kyoto',
      caption: null,
    })
  })
})
