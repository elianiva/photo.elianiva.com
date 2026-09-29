/**
 * The test seam the services are written against: a `Gateway` over an in-memory
 * D1 (loaded with the repo's real migrations) and an in-memory R2, plus the live
 * service layers wired to it.
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
import { Effect, Layer } from 'effect'
import { Gateway, withGateway, type D1DatabaseLike, type R2BucketLike } from '../gateway'
import { PhotoService, PhotoServiceLive } from '../photo'
import { TagService, TagServiceLive } from '../tag'
import { makeD1Fake } from './d1-fake'
import { makeR2Fake } from './r2-fake'

const migrationsDir = new URL('../../../../migrations/', import.meta.url)

/** `migrations/*.sql` in filename order — the same list Alchemy applies to D1. */
export const repoMigrations = (): ReadonlyArray<string> =>
  readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(new URL(name, migrationsDir), 'utf8'))

export interface TestHarness {
  readonly gateway: typeof Gateway.Service
  readonly db: D1DatabaseLike
  readonly photos: R2BucketLike
}

/** A migrated, isolated Gateway. Every call is a fresh database and bucket. */
export const makeTestHarness = (): TestHarness => {
  const db = makeD1Fake(repoMigrations())
  const photos = makeR2Fake()
  return { gateway: Gateway.of({ db, photos }), db, photos }
}

/** Run `effect` with the live `PhotoService` / `TagService` over `harness`. */
export const withTestServices = <A, E>(
  effect: Effect.Effect<A, E, PhotoService | TagService>,
  harness: TestHarness = makeTestHarness(),
): Effect.Effect<A, E> =>
  withGateway(
    harness.gateway,
    Effect.provide(effect, Layer.mergeAll(PhotoServiceLive, TagServiceLive)),
  )
