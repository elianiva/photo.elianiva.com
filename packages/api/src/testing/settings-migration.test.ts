import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { InvalidInput } from '@photo/shared'
import { TagService } from '../tag'
import { decodeSections, encodeSections } from '../settings'
import { createTag } from './fixtures'
import { makeTestHarness, repoMigrations, withTestServices, type TestHarness } from './harness'

/** The default-row insert, taken from the migration that ships it, so this
 *  asserts the SQL that runs in production rather than a copy of it. */
const defaultRowInsert = (): string => {
  const migration = repoMigrations().find((sql) => sql.includes('CREATE TABLE settings'))
  const statement = migration
    ?.split('\n')
    .filter((line) => line.trimStart().startsWith('INSERT'))
    .join('\n')
  if (statement === undefined || statement === '') {
    throw new Error('migrations/0005 has no default-row insert')
  }
  return statement
}

const settingsRows = async (
  harness: TestHarness,
): Promise<ReadonlyArray<Record<string, unknown>>> =>
  harness.db
    .prepare('SELECT * FROM settings')
    .all<Record<string, unknown>>()
    .then((raw) => raw.results ?? [])

const settingsRow = async (harness: TestHarness): Promise<Record<string, unknown>> => {
  const row = (await settingsRows(harness))[0]
  if (row === undefined) throw new Error('the settings singleton row is missing')
  return row
}

const listTags = (harness: TestHarness) =>
  Effect.runPromise(
    withTestServices(
      TagService.use((service) => service.list),
      harness,
    ),
  )

describe('migration 0005 — the settings singleton', () => {
  it('seeds exactly one row, with the documented defaults', async () => {
    const harness = makeTestHarness()

    expect(await settingsRows(harness)).toEqual([
      {
        id: 1,
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        defaultPreviewLongEdge: 1200,
        defaultPreviewFormat: 'avif',
        defaultPreviewQuality: 82,
        defaultFullQuality: 92,
        watermarkEnabled: 0,
        watermarkColour: 'white',
        watermarkPosition: 'bottom-right',
        defaultKeepExif: 1,
        defaultRemoveGps: 1,
        copyright: null,
        retainForever: 1,
        volume: 'V',
        motto: null,
        aboutCopy: null,
        sections: null,
      },
    ])
  })

  it('is a no-op when the default row is inserted again', async () => {
    const harness = makeTestHarness()
    const before = await settingsRow(harness)

    await harness.db.prepare(defaultRowInsert()).run()

    expect(await settingsRows(harness)).toEqual([before])
  })

  it('refuses a second row', async () => {
    const harness = makeTestHarness()

    await expect(
      harness.db
        .prepare(`INSERT INTO settings (id, updatedAt) VALUES (2, '2026-01-01T00:00:00.000Z')`)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/)
    expect(await settingsRows(harness)).toHaveLength(1)
  })

  it('carries a sections round trip through the column', async () => {
    const harness = makeTestHarness()
    const nav = [
      { kind: 'all', label: 'All' },
      { kind: 'tag', label: 'Street', target: 'street' },
      { kind: 'page', label: 'About', target: 'about' },
    ] as const

    await harness.db
      .prepare(`UPDATE settings SET sections = ? WHERE id = 1`)
      .bind(encodeSections(nav))
      .run()
    const stored = await harness.db
      .prepare('SELECT sections FROM settings WHERE id = 1')
      .first<{ sections: string | null }>()

    expect(await Effect.runPromise(decodeSections(stored?.sections ?? null))).toEqual(nav)
  })

  it('surfaces a corrupted column instead of publishing an empty nav', async () => {
    const harness = makeTestHarness()
    await harness.db
      .prepare(`UPDATE settings SET sections = ? WHERE id = 1`)
      .bind('ALL · STREET')
      .run()

    const stored = await harness.db
      .prepare('SELECT sections FROM settings WHERE id = 1')
      .first<{ sections: string | null }>()

    expect(
      await Effect.runPromise(Effect.flip(decodeSections(stored?.sections ?? null))),
    ).toBeInstanceOf(InvalidInput)
  })
})

describe('migration 0005 — tag captions', () => {
  it('reads null, never an empty string, for a tag that predates the column', async () => {
    const harness = makeTestHarness()
    await harness.db
      .prepare(`INSERT INTO tags (id, slug, label) VALUES ('tag_legacy', 'kyoto', 'Kyoto')`)
      .run()
    await createTag(harness, 'film', 'Film')

    const rows = await harness.db
      .prepare('SELECT slug, caption FROM tags ORDER BY slug')
      .all<{ slug: string; caption: string | null }>()

    expect(rows.results).toEqual([
      { slug: 'film', caption: null },
      { slug: 'kyoto', caption: null },
    ])
  })

  it('carries the caption on a Tag the service returns', async () => {
    const harness = makeTestHarness()
    const film = await createTag(harness, 'film', 'Film')
    await harness.db
      .prepare('UPDATE tags SET caption = ? WHERE id = ?')
      .bind('Ferries, rain, and the long light on Istiklal.', film.id)
      .run()

    expect(await listTags(harness)).toEqual([
      {
        id: film.id,
        slug: 'film',
        label: 'Film',
        caption: 'Ferries, rain, and the long light on Istiklal.',
      },
    ])
  })
})
