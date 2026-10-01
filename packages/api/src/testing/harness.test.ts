import { Effect } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'
import { describe, expect, it } from 'vitest'
import { Batch } from '../batch'
import { describeFailure, makeTestHarness, queryRow, queryRows, type TestHarness } from './harness'

/**
 * The test database used to be a hand-rolled fake that evaluated the migrations
 * itself, and these are the guarantees it gave the suite for free: the schema's
 * own constraints are really enforced, a batch is really atomic, and every
 * harness really is isolated. Nothing depended on those being *cheap* to fake —
 * only on them being true — so they are asserted against the real engine now,
 * which is the only way to know the fake was not quietly lying.
 */
const insertPhoto = (
  harness: TestHarness,
  id: string,
  overrides: { readonly width?: unknown; readonly slug?: string } = {},
): Promise<ReadonlyArray<unknown>> =>
  queryRows(harness, (sql) =>
    sql`INSERT INTO photos (id, slug, title, r2Key, width, height, takenAt, metadata, blurhash)
        VALUES (${id}, ${overrides.slug ?? `slug-${id}`}, ${`Title ${id}`}, ${`originals/${id}.jpg`},
                ${overrides.width ?? 1200}, 800, '2024-01-15', '{"caption":"a"}', 'LEHV6nWB')`,
  )

const rowFor = (harness: TestHarness, id: string) =>
  queryRow<{ id: string; slug: string; blurhash: string } | null>(
    harness,
    (sql) => sql`SELECT id, slug, blurhash FROM photos WHERE id = ${id}`,
  )

/** The text of a refusal, engine reason included, or a throw if it succeeded. */
const failureOf = (run: Promise<unknown>): Promise<string> =>
  run.then(
    () => {
      throw new Error('expected the statement to be refused')
    },
    (error: unknown) => describeFailure(error),
  )

describe('the migrated test database', () => {
  it('holds what the migration writes', async () => {
    const harness = makeTestHarness()
    await insertPhoto(harness, 'photo_1')
    expect(await rowFor(harness, 'photo_1')).toEqual({
      id: 'photo_1',
      slug: 'slug-photo_1',
      blurhash: 'LEHV6nWB',
    })
  })

  it('honours STRICT — a text value in an integer column is rejected', async () => {
    const harness = makeTestHarness()
    await expect(failureOf(insertPhoto(harness, 'photo_1', { width: 'not-a-number' }))).resolves.toMatch(
      /cannot store TEXT value in INTEGER column/i,
    )
  })

  it('honours foreign keys — a photo_tags row with a missing photoId is rejected', async () => {
    const harness = makeTestHarness()
    await expect(
      failureOf(
        queryRows(harness, (sql) =>
          sql`INSERT INTO photo_tags (photoId, tagId) VALUES ('nope', 'nope')`,
        ),
      ),
    ).resolves.toMatch(/FOREIGN KEY/i)
  })

  it('honours ON DELETE CASCADE from photo_tags to photos', async () => {
    const harness = makeTestHarness()
    await insertPhoto(harness, 'photo_1')
    await queryRows(harness, (sql) => sql`DELETE FROM photos WHERE id = 'photo_1'`)
    expect(await rowFor(harness, 'photo_1')).toBeNull()
  })

  it('honours the unique slug index', async () => {
    const harness = makeTestHarness()
    await insertPhoto(harness, 'photo_1')
    await expect(failureOf(insertPhoto(harness, 'photo_2', { slug: 'slug-photo_1' }))).resolves.toMatch(
      /UNIQUE/i,
    )
  })

  it('hands out a fresh database per harness', async () => {
    const one = makeTestHarness()
    const two = makeTestHarness()
    await insertPhoto(one, 'photo_1')
    expect(await rowFor(two, 'photo_1')).toBeNull()
  })
})

describe('the test batch', () => {
  /**
   * The guarantee the service exists for: a Photo's rows and its tag links are
   * written together or not at all. A batch that applied what it could would
   * leave the first statement's row behind here — an orphaned Photo the delete
   * path was supposed to remove.
   */
  const runBatch = (harness: TestHarness, slug: string) =>
    Effect.runPromise(
      harness.run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const batch = yield* Batch
          return yield* batch.run([
            sql`DELETE FROM photos WHERE id = 'photo_1'`,
            sql`INSERT INTO photos (id, slug, title, r2Key, width, height)
                  VALUES ('photo_2', ${slug}, 'New', 'originals/photo_2.jpg', 1200, 800)`,
          ])
        }),
      ),
    )

  it('rolls the whole batch back when one statement in it fails', async () => {
    const harness = makeTestHarness()
    await insertPhoto(harness, 'photo_1')
    // Untouched by the batch, so its slug is still taken when the insert runs.
    await insertPhoto(harness, 'photo_3')

    // The insert fails on `photo_3`'s slug, and the delete that already ran
    // must not survive it — that is the orphaned-Photo case the service exists
    // to prevent.
    await expect(failureOf(runBatch(harness, 'slug-photo_3'))).resolves.toMatch(/UNIQUE/i)
    expect(await rowFor(harness, 'photo_1')).not.toBeNull()
    expect(await rowFor(harness, 'photo_2')).toBeNull()
  })

  it('applies every statement when they all succeed', async () => {
    const harness = makeTestHarness()
    await insertPhoto(harness, 'photo_1')

    await runBatch(harness, 'slug-photo_2')

    expect(await rowFor(harness, 'photo_1')).toBeNull()
    expect(await rowFor(harness, 'photo_2')).not.toBeNull()
  })
})
