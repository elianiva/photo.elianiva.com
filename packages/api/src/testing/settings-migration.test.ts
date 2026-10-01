import { describe, expect, it } from 'vitest'
import { createTag, SETTINGS_DEFAULTS } from './fixtures'
import { describeFailure, makeTestHarness, queryRows, repoMigrations, type TestHarness } from './harness'

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

const settingsRows = (harness: TestHarness): Promise<ReadonlyArray<Record<string, unknown>>> =>
  queryRows<Record<string, unknown>>(harness, (sql) => sql`SELECT * FROM settings`)

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

    // `unsafe` rather than a template: the statement is lifted verbatim out of
    // the migration file, and this asserts the SQL that ships.
    await queryRows(harness, (sql) => sql.unsafe(defaultRowInsert()))

    expect(await settingsRows(harness)).toEqual([before])
  })

  it('refuses a second row', async () => {
    const harness = makeTestHarness()

    // The `SqlError`'s own message is the driver's ("Failed to execute
    // statement"); the CHECK is the engine's and sits underneath it, so the
    // assertion reads the whole failure.
    const refused = await queryRows(harness, (sql) =>
      sql`INSERT INTO settings (id, updatedAt) VALUES (2, '2026-01-01T00:00:00.000Z')`,
    ).then(
      () => null,
      (error: unknown) => describeFailure(error),
    )
    expect(refused).toMatch(/CHECK constraint failed/)
    expect(await settingsRows(harness)).toHaveLength(1)
  })
})

describe('migration 0005 — tag captions', () => {
  it('reads null, never an empty string, for a tag that predates the column', async () => {
    const harness = makeTestHarness()
    await queryRows(harness, (sql) =>
      sql`INSERT INTO tags (id, slug, label) VALUES ('tag_legacy', 'kyoto', 'Kyoto')`,
    )
    await createTag(harness, 'film', 'Film')

    const rows = await queryRows<{ slug: string; caption: string | null }>(harness, (sql) =>
      sql`SELECT slug, caption FROM tags ORDER BY slug`,
    )

    expect(rows).toEqual([
      { slug: 'film', caption: null },
      { slug: 'kyoto', caption: null },
    ])
  })
})
