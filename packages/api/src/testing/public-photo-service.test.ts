import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { InvalidInput } from '@photo/shared'
import { PublicPhotoService, type FrontPageInput } from '../public-photo'
import { createPhoto, createTag, fail, setPhotoStatus, trashPhoto } from './fixtures'
import { makeTestHarness, withPublicRead, type TestHarness } from './harness'

/** Six published Photos over three months, created oldest first so the Photo
 *  Numbers ascend with the dates the sections are grouped by. */
const CATALOGUE: ReadonlyArray<{
  readonly slug: string
  readonly title: string
  readonly takenAt: string
}> = [
  { slug: 'june-01', title: 'A country road, apricots, late light.', takenAt: '2025-06-03' },
  { slug: 'june-02', title: 'The Empire State Building, early.', takenAt: '2025-06-21' },
  { slug: 'july-01', title: 'Storm King, one car between the long lawns.', takenAt: '2025-07-09' },
  { slug: 'july-02', title: 'Larches in the evening mist.', takenAt: '2025-07-30' },
  { slug: 'august-01', title: 'Rush hour on Jalan Sudirman.', takenAt: '2025-08-05' },
  { slug: 'august-02', title: 'The red tram on İstiklal Avenue.', takenAt: '2025-08-27' },
]

const seed = async (harness: TestHarness): Promise<void> => {
  for (const photo of CATALOGUE) {
    await createPhoto(harness, photo)
  }
}

const frontPage = (harness: TestHarness, input?: FrontPageInput) =>
  Effect.runPromise(
    withPublicRead(
      PublicPhotoService.use((service) => service.frontPage(input)),
      harness,
    ),
  )

const frontStats = (harness: TestHarness) =>
  Effect.runPromise(
    withPublicRead(
      PublicPhotoService.use((service) => service.frontStats()),
      harness,
    ),
  )

const bySlug = (harness: TestHarness, slug: string) =>
  Effect.runPromise(
    withPublicRead(
      PublicPhotoService.use((service) => service.bySlug(slug)),
      harness,
    ),
  )

const byNumber = (harness: TestHarness, number: number) =>
  Effect.runPromise(
    withPublicRead(
      PublicPhotoService.use((service) => service.byNumber(number)),
      harness,
    ),
  )

const archive = (harness: TestHarness) =>
  Effect.runPromise(
    withPublicRead(
      PublicPhotoService.use((service) => service.archive()),
      harness,
    ),
  )

const byTag = (harness: TestHarness, slug: string) =>
  Effect.runPromise(
    withPublicRead(
      PublicPhotoService.use((service) => service.byTag(slug)),
      harness,
    ),
  )

const slugsOf = (photos: ReadonlyArray<{ readonly slug: string }>): ReadonlyArray<string> =>
  photos.map((photo) => photo.slug)

describe('PublicPhotoService.frontPage', () => {
  it('groups published photos into one section per month, newest month first', async () => {
    const harness = makeTestHarness()
    await seed(harness)

    const page = await frontPage(harness, { sectionCount: 3 })

    expect(page.sections.map((section) => section.month)).toEqual(['2025-08', '2025-07', '2025-06'])
    expect(page.sections.map((section) => section.label)).toEqual([
      'August 2025',
      'July 2025',
      'June 2025',
    ])
    expect(page.sections.map((section) => section.year)).toEqual(['2025', '2025', '2025'])
    expect(page.sections.map((section) => section.frames)).toEqual([2, 2, 2])
    expect(page.sections.map((section) => slugsOf(section.photos))).toEqual([
      ['august-02', 'august-01'],
      ['july-02', 'july-01'],
      ['june-02', 'june-01'],
    ])
  })

  it('carries each section frame count and number range as its own aggregate', async () => {
    const harness = makeTestHarness()
    await seed(harness)

    const page = await frontPage(harness, { sectionCount: 3 })

    expect(
      page.sections.map((section) => [section.frames, section.numberFrom, section.numberTo]),
    ).toEqual([
      [2, 5, 6],
      [2, 3, 4],
      [2, 1, 2],
    ])
  })

  it('renders the first paint as two sections and leaves a cursor for the rest', async () => {
    const harness = makeTestHarness()
    await seed(harness)

    const first = await frontPage(harness)

    expect(first.sections.map((section) => section.month)).toEqual(['2025-08', '2025-07'])
    expect(first.nextSectionCursor).toBe('2025-07')
  })

  it('resumes below the cursor month without repeating it', async () => {
    const harness = makeTestHarness()
    await seed(harness)

    const second = await frontPage(harness, { sectionCursor: '2025-07' })

    expect(second.sections.map((section) => section.month)).toEqual(['2025-06'])
    expect(second.sections[0]?.frames).toBe(2)
    expect(second.nextSectionCursor).toBeNull()
  })

  it('rejects a cursor that is not a month instead of answering with the newest', async () => {
    const harness = makeTestHarness()
    await seed(harness)

    const error = await fail(
      withPublicRead(
        PublicPhotoService.use((service) => service.frontPage({ sectionCursor: 'yesterday' })),
        harness,
      ),
    )

    expect(error).toBeInstanceOf(InvalidInput)
    expect(error.message).toContain('YYYY-MM')
  })

  it('omits a draft and a trashed photo from every section', async () => {
    const harness = makeTestHarness()
    await seed(harness)
    const draft = await createPhoto(harness, {
      slug: 'september-draft',
      title: 'A draft.',
      takenAt: '2025-09-02',
    })
    const trashed = await createPhoto(harness, {
      slug: 'september-trashed',
      title: 'A trashed photo.',
      takenAt: '2025-09-03',
    })
    await setPhotoStatus(harness, draft.id, 'draft')
    await trashPhoto(harness, trashed.id)

    const page = await frontPage(harness, { sectionCount: 3 })

    expect(page.sections.map((section) => section.month)).toEqual(['2025-08', '2025-07', '2025-06'])
    expect(slugsOf(page.sections.flatMap((section) => section.photos))).not.toContain(
      'september-draft',
    )
    expect(
      page.sections.flatMap((section) => section.photos).map((photo) => photo.slug),
    ).not.toContain('september-trashed')
  })

  it('leaves a published photo with no takenAt out of every section', async () => {
    const harness = makeTestHarness()
    await seed(harness)
    await createPhoto(harness, { slug: 'undated', title: 'Undated.' })

    const page = await frontPage(harness, { sectionCount: 3 })

    expect(page.sections.flatMap((section) => section.frames)).toEqual([2, 2, 2])
    expect(slugsOf(page.sections.flatMap((section) => section.photos))).not.toContain('undated')
  })
})

describe('PublicPhotoService.frontStats', () => {
  it('counts published photos and takes the highest published photo number', async () => {
    const harness = makeTestHarness()
    await seed(harness)

    const stats = await frontStats(harness)

    expect(stats.total).toBe(6)
    expect(stats.number).toBe(6)
    expect(stats.latestTakenAt).toBe('2025-08-27')
  })

  it('omits a draft and a trashed photo from the count and from the number', async () => {
    const harness = makeTestHarness()
    await seed(harness)
    const draft = await createPhoto(harness, {
      slug: 'september-draft',
      title: 'A draft.',
      takenAt: '2025-09-02',
    })
    const trashed = await createPhoto(harness, {
      slug: 'september-trashed',
      title: 'A trashed photo.',
      takenAt: '2025-09-03',
    })
    await setPhotoStatus(harness, draft.id, 'draft')
    await trashPhoto(harness, trashed.id)

    const stats = await frontStats(harness)

    expect(stats.total).toBe(6)
    expect(stats.number).toBe(6)
    expect(stats.latestTakenAt).toBe('2025-08-27')
  })

  it('reads the public counter back a step when the highest photo is trashed', async () => {
    const harness = makeTestHarness()
    await seed(harness)
    const last = await createPhoto(harness, {
      slug: 'august-03',
      title: 'A third August frame.',
      takenAt: '2025-08-29',
    })
    expect((await frontStats(harness)).number).toBe(7)

    await trashPhoto(harness, last.id)

    expect((await frontStats(harness)).number).toBe(6)
  })
})

describe('PublicPhotoService direct reads', () => {
  it('reads a published photo by slug and by photo number', async () => {
    const harness = makeTestHarness()
    await seed(harness)

    const byName = await bySlug(harness, 'july-01')
    const bySerial = await byNumber(harness, 3)

    expect(byName?.slug).toBe('july-01')
    expect(byName?.number).toBe(3)
    expect(bySerial?.slug).toBe('july-01')
  })

  it('answers nothing for a draft, a trashed photo, or a slug no photo has', async () => {
    const harness = makeTestHarness()
    await seed(harness)
    const draft = await createPhoto(harness, {
      slug: 'september-draft',
      title: 'A draft.',
      takenAt: '2025-09-02',
    })
    const trashed = await createPhoto(harness, {
      slug: 'september-trashed',
      title: 'A trashed photo.',
      takenAt: '2025-09-03',
    })
    await setPhotoStatus(harness, draft.id, 'draft')
    await trashPhoto(harness, trashed.id)

    expect(await bySlug(harness, 'september-draft')).toBeNull()
    expect(await byNumber(harness, 7)).toBeNull()
    expect(await byNumber(harness, 8)).toBeNull()
    expect(await bySlug(harness, 'nothing-here')).toBeNull()
  })

  it('archives every published photo newest first', async () => {
    const harness = makeTestHarness()
    await seed(harness)
    const draft = await createPhoto(harness, {
      slug: 'september-draft',
      title: 'A draft.',
      takenAt: '2025-09-02',
    })
    await setPhotoStatus(harness, draft.id, 'draft')

    expect(slugsOf(await archive(harness))).toEqual([
      'august-02',
      'august-01',
      'july-02',
      'july-01',
      'june-02',
      'june-01',
    ])
  })

  it('reads a series as its tag and the photos carrying it, earliest first', async () => {
    const harness = makeTestHarness()
    await seed(harness)
    const tag = await createTag(harness, 'istanbul', 'Istanbul')
    const tagged = await createPhoto(harness, {
      slug: 'august-03',
      title: 'A third August frame.',
      takenAt: '2025-08-30',
      tagIds: [tag.id],
    })
    await createPhoto(harness, {
      slug: 'july-03',
      title: 'A second July frame.',
      takenAt: '2025-07-02',
      tagIds: [tag.id],
    })
    const draft = await createPhoto(harness, {
      slug: 'september-draft',
      title: 'A draft.',
      takenAt: '2025-09-02',
      tagIds: [tag.id],
    })
    await setPhotoStatus(harness, draft.id, 'draft')

    const series = await byTag(harness, 'istanbul')

    expect(series?.tag.label).toBe('Istanbul')
    expect(series?.tag.caption).toBeNull()
    expect(slugsOf(series?.photos ?? [])).toEqual(['july-03', 'august-03'])
    expect(series?.photos.map((photo) => photo.slug)).toContain(tagged.slug)
  })

  it('answers nothing for a tag slug no tag carries', async () => {
    const harness = makeTestHarness()
    await seed(harness)

    expect(await byTag(harness, 'kyoto')).toBeNull()
  })
})
