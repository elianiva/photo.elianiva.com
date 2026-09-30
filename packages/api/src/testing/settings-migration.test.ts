import { describe, expect, it } from 'vitest'
import { createTag, SETTINGS_DEFAULTS } from './fixtures'
import { makeTestHarness, repoMigrations, type TestHarness } from './harness'

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

describe('migration 0005 — the settings singleton', () => {
  it('seeds exactly one row, with the documented defaults', async () => {
    const harness = makeTestHarness()

    // The four booleans are 0/1 on the table, not `false`/`true`: this is the
    // only place that difference is visible, so the columns are asserted as the
    // migration writes them.
    expect(await settingsRows(harness)).toEqual([
      {
        id: 1,
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        defaultPreviewLongEdge: SETTINGS_DEFAULTS.defaultPreviewLongEdge,
        defaultPreviewFormat: SETTINGS_DEFAULTS.defaultPreviewFormat,
        defaultPreviewQuality: SETTINGS_DEFAULTS.defaultPreviewQuality,
        defaultFullQuality: SETTINGS_DEFAULTS.defaultFullQuality,
        watermarkEnabled: 0,
        watermarkColour: SETTINGS_DEFAULTS.watermarkColour,
        watermarkPosition: SETTINGS_DEFAULTS.watermarkPosition,
        defaultKeepExif: 1,
        defaultRemoveGps: 1,
        retainForever: 1,
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
})
