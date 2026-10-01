/**
 * The test seam the services are written against: the standard `SqlClient`
 * over a real SQLite engine running the repo's own `migrations/*.sql`, the R2
 * fake, and the live service layers wired over both.
 *
 * ADR 0005's substance survives the move off the hand-written D1 fake: the
 * engine is real, the schema is the one production runs, and a stub that got
 * `STRICT` affinity, `WITHOUT ROWID`, foreign keys or partial indexes wrong
 * would fail the suite rather than quietly pass it. What is gone is the second
 * implementation of D1 — the fake had to coerce bind values, map
 * null-prototype rows and thread `bind`/`first`/`all`/`run`/`batch` by hand,
 * because it was standing in for a binding interface rather than for a
 * database. `node:sqlite` through `@effect/sql-sqlite-node` *is* that engine,
 * and `SqlClient` is the interface the services now speak.
 *
 * Node-only, and deliberately not re-exported from `src/index.ts` so
 * `node:sqlite` never reaches the Worker bundle.
 *
 * ```ts
 * const harness = makeTestHarness()
 * const page = await Effect.runPromise(
 *   withTestServices(PhotoService.use((service) => service.list({})), harness),
 * )
 * ```
 */

import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Effect, Layer } from 'effect'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as SqlClient from 'effect/unstable/sql/SqlClient'
import type { Statement } from 'effect/unstable/sql/Statement'
import { Batch, BatchTransactionLive } from '../batch'
import { Gateway, withGateway, type R2BucketLike } from '../gateway'
import { PhotoService, PhotoServiceLive } from '../photo'
import { PublicPhotoService, PublicPhotoServiceLive } from '../public-photo'
import { SettingsService, SettingsServiceLive } from '../settings'
import { TagService, TagServiceLive } from '../tag'
import { makeR2Fake } from './r2-fake'

const migrationsDir = new URL('../../../../migrations/', import.meta.url)

/** `migrations/*.sql` in filename order — the same list Alchemy applies to D1. */
export const migrationFiles = (): ReadonlyArray<{ name: string; sql: string }> =>
  readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(new URL(name, migrationsDir), 'utf8') }))

export const repoMigrations = (): ReadonlyArray<string> => migrationFiles().map((file) => file.sql)

/**
 * Migrations up to and including `last` — the schema a later migration has to
 * apply to. Filenames sort into migration order, so the cut is by name rather
 * than by index.
 */
export const migrationsThrough = (last: string): ReadonlyArray<string> =>
  migrationFiles()
    .filter((file) => file.name <= last)
    .map((file) => file.sql)

let harnessCount = 0

/**
 * The handles that seeded each database, kept so a shared in-memory database
 * outlives the call that created it.
 *
 * A `mode=memory&cache=shared` database lives as long as one connection to it
 * does, so the handle that ran the migrations has to stay open for the harness's
 * life. Holding them here says so, rather than leaning on a value in a closure
 * happening to still be reachable.
 */
const seedingHandles = new Set<DatabaseSync>()

/** A migrated database, and the URI the client opens to reach the same one.
 *
 *  The URI is why this is not `':memory:'`. A migration file is several
 *  statements with comments between them, and the Effect SQL client prepares
 *  exactly one statement at a time — it has no `exec`, and cannot, since D1 has
 *  no such call either. So the migrations go through `node:sqlite`'s own `exec`
 *  on a handle opened here, and the client opens the same URI. `cache=shared`
 *  is what makes two handles onto `mode=memory` name one database.
 *
 *  Each harness gets its own URI, so the isolation is the isolation `':memory:'`
 *  gave: a name no other test can guess, and nothing on disk to clean up. */
const openMigrated = (
  migrations: ReadonlyArray<string>,
): { readonly engine: DatabaseSync; readonly uri: string } => {
  harnessCount += 1
  const uri = `file:photo-test-${String(harnessCount)}?mode=memory&cache=shared`
  const engine = new DatabaseSync(uri)
  for (const statement of migrations) engine.exec(statement)
  seedingHandles.add(engine)
  return { engine, uri }
}

export interface TestHarness {
  readonly gateway: typeof Gateway.Service
  readonly photos: R2BucketLike
  /**
   * Run an effect over this harness's own database and bucket. The seam a test
   * uses to seed or inspect rows directly — the same `SqlClient` the services
   * speak, so a fixture writes through the interface it is asserting about
   * rather than through a second one.
   */
  readonly run: <A, E>(
    effect: Effect.Effect<A, E, SqlClient.SqlClient | Batch>,
  ) => Effect.Effect<A, E>
}

/** A migrated, isolated database and bucket. Every call is a fresh one. */
export const makeTestHarness = (
  migrations: ReadonlyArray<string> = repoMigrations(),
): TestHarness => {
  const photos = makeR2Fake()
  const { uri } = openMigrated(migrations)
  // One `provideMerge`, so there is exactly one client: `Batch` needs the same
  // `SqlClient` the migrations ran on.
  const storage = Layer.mergeAll(
    BatchTransactionLive,
    Layer.succeed(Gateway, Gateway.of({ photos })),
  ).pipe(
    // WAL is a file feature; an in-memory shared-cache database does not
    // want it, and the busy timeout is irrelevant when nothing else can open
    // the same name.
    Layer.provideMerge(SqliteClient.layer({ filename: uri, disableWAL: true })),
  )
  return {
    gateway: Gateway.of({ photos }),
    photos,
    run: (effect) => Effect.provide(effect, storage),
  }
}

/** Run `effect` with the live `PhotoService` / `TagService` / `SettingsService`
 *  over `harness`. */
export const withTestServices = <A, E>(
  effect: Effect.Effect<A, E, PhotoService | TagService | SettingsService>,
  harness: TestHarness = makeTestHarness(),
): Effect.Effect<A, E> =>
  harness.run(
    withGateway(
      harness.gateway,
      Effect.provide(effect, Layer.mergeAll(PhotoServiceLive, TagServiceLive, SettingsServiceLive)),
    ),
  )

/** The public read model over `harness` — the one that filters to published,
 *  non-trashed Photos inside itself, so a test cannot leak a Draft by asking
 *  for one. */
export const withPublicRead = <A, E>(
  effect: Effect.Effect<A, E, PublicPhotoService>,
  harness: TestHarness = makeTestHarness(),
): Effect.Effect<A, E> =>
  harness.run(withGateway(harness.gateway, Effect.provide(effect, PublicPhotoServiceLive)))

/**
 * Run one statement over the harness's database and answer as a promise of its
 * rows — the shape the test helpers above and below are written in.
 *
 * The statement is built *inside* the layer, from the client the services get,
 * so a fixture seeds and inspects through the same `SqlClient` it is asserting
 * about rather than through a second handle to the same database.
 */
export const queryRows = <Row>(
  harness: TestHarness,
  build: (sql: SqlClient.SqlClient) => Statement<Row>,
): Promise<ReadonlyArray<Row>> =>
  Effect.runPromise(
    harness.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* build(sql)
      }),
    ),
  )

/** One row, or null. The "no match" answer the reads above it used to spell
 *  `.first()` for. */
export const queryRow = <Row>(
  harness: TestHarness,
  build: (sql: SqlClient.SqlClient) => Statement<Row>,
): Promise<Row | null> => queryRows(harness, build).then((rows) => rows[0] ?? null)

/**
 * The whole of a failure, as text.
 *
 * An `SqlError` says "Failed to execute statement" and keeps the engine's own
 * reason — `CHECK constraint failed: id = 1` — three levels down, reached only
 * through getters: on a `Data` error `message`, `cause` and `reason` are all
 * prototype members, so spreading the object and walking its own keys finds
 * none of them. A test that wants to assert on the reason has to be able to read
 * it, so this reads those accessors by name as well as walking the own keys.
 */
/**
 * A `Data` tagged error's `message`, `cause` and `reason` are prototype
 * getters, so they cannot be read off a copy of the object — a spread drops
 * exactly the fields that name the operation. This says the object carries a
 * `message` so it can be read without a type assertion, and without pretending
 * every object is one.
 */
const hasMessage = (value: object): value is { readonly message?: unknown } => 'message' in value

/**
 * The whole of a failure, as text.
 *
 * An `SqlError` says "Failed to execute statement" and keeps the engine's own
 * reason — `CHECK constraint failed: id = 1` — three levels down, reached only
 * through those getters. A test that wants to assert on the reason has to be
 * able to read it, so this reads the accessors Effect's SQL layer names and
 * walks the own keys as well.
 */
export const describeFailure = (cause: unknown, depth = 6): string => {
  if (cause === null || cause === undefined) return ''
  if (typeof cause === 'string') return cause
  if (depth === 0) return ''
  if (Array.isArray(cause)) {
    return cause
      .map((entry) => describeFailure(entry, depth - 1))
      .filter((t) => t !== '')
      .join(' | ')
  }
  if (typeof cause !== 'object') {
    // A thrown primitive, which is not what this exists for. Handled so the
    // walk is total, and handled per type rather than through `String` so an
    // object can never reach the generic stringifier by accident.
    switch (typeof cause) {
      case 'number':
      case 'boolean':
        return JSON.stringify(cause)
      case 'bigint':
        return cause.toString()
      default:
        return ''
    }
  }

  const parts: Array<string> = []
  const add = (text: string): void => {
    if (text !== '' && !parts.includes(text)) parts.push(text)
  }
  if (hasMessage(cause) && typeof cause.message === 'string') add(cause.message)
  // The chain Effect's SQL layer builds: an `SqlError` carries a `reason`, and
  // the engine error underneath it carries `errstr`.
  for (const key of ['reason', 'cause', 'errstr', 'errcode']) {
    const value = Reflect.get(cause, key)
    if (value === null || value === undefined) continue
    add(typeof value === 'string' ? value : describeFailure(value, depth - 1))
  }
  for (const [key, value] of Object.entries(cause)) {
    if (key.startsWith('~') || value === null || value === undefined) continue
    if (typeof value === 'object') add(describeFailure(value, depth - 1))
    else if (typeof value === 'string' && key !== '_tag' && key !== 'message') add(value)
  }
  return parts.join(' | ')
}
