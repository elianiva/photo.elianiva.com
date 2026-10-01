import { Effect } from 'effect'
import * as SqlClient from 'effect/sql/SqlClient'
import { describe, expect, it } from 'vitest'
import { Batch } from '../batch'
import { MetadataLive } from '../metadata'
import { makeR2Fake } from './r2-fake'
import { describeFailure, repoMigrations } from './harness'
import { makeD1Fake } from './d1-fake'

/**
 * The production wiring, run against a D1-shaped binding.
 *
 * The rest of the suite exercises the services over `@effect/sql-sqlite-node`,
 * so nothing here has ever loaded `@effect/sql-d1` — which leaves `D1Client`
 * and, more importantly, `BatchD1Live` untested. `BatchD1Live` is the only
 * place in the codebase that reaches for `client.batch`, the one method the
 * generic `SqlClient` does not have, and it is what makes a Photo's rows and
 * its tag links land together in production. This is that path under test.
 */

/**
 * One migrated binding for the life of a test, wrapped in the real
 * {@link MetadataLive} — the layer the Worker builds, not a re-creation of it.
 * The binding is created once and the layer is rebuilt around it, because the
 * database lives in the binding and not in the layer.
 */
const d1Fixture = () => {
  const db = makeD1Fake(repoMigrations())

  const run = <A, E>(program: Effect.Effect<A, E, SqlClient.SqlClient | Batch>): Promise<A> =>
    Effect.runPromise(
      Effect.scoped(Effect.provide(program, MetadataLive({ db, photos: makeR2Fake() }))),
    )

  const insertPhoto = (id: string): Promise<unknown> =>
    run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO photos (id, slug, title, r2Key, width, height, takenAt, metadata, blurhash)
                    VALUES (${id}, ${`slug-${id}`}, ${`Title ${id}`}, ${`originals/${id}.jpg`},
                            1200, 800, '2024-01-15', '{"caption":"a"}', 'LEHV6nWB')`
      }),
    )

  const countPhotos = (): Promise<number> =>
    run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM photos`
        return rows[0]?.n ?? 0
      }),
    )

  const slugs = (): Promise<ReadonlyArray<string>> =>
    run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ slug: string }>`SELECT slug FROM photos ORDER BY slug`
        return rows.map((row) => row.slug)
      }),
    )

  return { run, insertPhoto, countPhotos, slugs }
}

/** The text of a refusal, engine reason included, or null if it succeeded. */
const failureOf = (run: Promise<unknown>): Promise<string | null> =>
  run.then(
    () => null,
    (error: unknown) => describeFailure(error),
  )

describe('the D1 driver', () => {
  it('runs the migrations and answers a query', async () => {
    const d1 = d1Fixture()
    await d1.insertPhoto('photo_1')
    expect(await d1.countPhotos()).toBe(1)
  })

  it('reports a constraint failure as an SqlError carrying the engine reason', async () => {
    const d1 = d1Fixture()
    await d1.insertPhoto('photo_1')
    expect(await failureOf(d1.insertPhoto('photo_1'))).toMatch(/UNIQUE/i)
  })
})

describe('BatchD1Live', () => {
  it('applies every statement when they all succeed', async () => {
    const d1 = d1Fixture()
    await d1.insertPhoto('photo_1')
    await d1.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const batch = yield* Batch
        yield* batch.run([
          sql`DELETE FROM photos WHERE id = 'photo_1'`,
          sql`INSERT INTO photos (id, slug, title, r2Key, width, height)
                VALUES ('photo_2', 'slug-photo_2', 'New', 'originals/photo_2.jpg', 1200, 800)`,
        ])
      }),
    )
    expect(await d1.slugs()).toEqual(['slug-photo_2'])
  })

  it('rolls the whole batch back when one statement in it fails', async () => {
    const d1 = d1Fixture()
    await d1.insertPhoto('photo_1')
    await d1.insertPhoto('photo_3')

    // `photo_3`'s slug is still taken when the insert runs, so the batch fails —
    // and the delete that already ran must not survive it. This is the whole
    // reason `Batch` is a service: on D1 this reaches `db.batch`, and a batch
    // that applied what it could would leave an orphaned Photo behind.
    const failure = await failureOf(
      d1.run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const batch = yield* Batch
          return yield* batch.run([
            sql`DELETE FROM photos WHERE id = 'photo_1'`,
            sql`INSERT INTO photos (id, slug, title, r2Key, width, height)
                  VALUES ('photo_2', 'slug-photo_3', 'Clash', 'originals/photo_2.jpg', 1200, 800)`,
          ])
        }),
      ),
    )

    expect(failure).toMatch(/UNIQUE/i)
    // Both originals survive: neither the delete nor the insert landed.
    expect(await d1.slugs()).toEqual(['slug-photo_1', 'slug-photo_3'])
  })
})
