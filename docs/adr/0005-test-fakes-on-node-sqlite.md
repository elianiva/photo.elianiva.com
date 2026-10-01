# Test fakes: a real SQLite engine, not miniflare

Accepted. Amended 2026-09 to replace the hand-rolled D1 fake with Effect SQL.

## Decision

`packages/api`'s services are tested against a real SQLite engine — `node:sqlite`
via `@effect/sql-sqlite-node` — and an in-memory R2 backed by a `Map`. The
harness lives in `packages/api/src/testing/` and is not re-exported from the
package index, so `node:sqlite` never reaches a Worker bundle. `node:sqlite` is a
stable Node builtin at the repo's floor (Node 24+), with a scoped ambient
declaration for the handful of members used rather than a `@types/node` dev
dependency: `@photo/api` is Worker-typed on purpose, and pulling in Node types to
typecheck two Node-only fakes would undo that.

**Amended.** The metadata database is no longer a hand-written
`D1DatabaseLike` reached through 52 `prepare`/`first`/`all`/`run`/`batch` sites.
It is `effect/unstable/sql/SqlClient`, with the dialect supplied by a layer:

| Where           | Driver                                    | Provided by                                      |
| --------------- | ----------------------------------------- | ------------------------------------------------ |
| Worker          | `@effect/sql-d1`                          | `MetadataLive` in `packages/api/src/metadata.ts` |
| Tests           | `@effect/sql-sqlite-node`                 | `makeTestHarness`                                |
| D1 driver tests | `@effect/sql-d1` over a D1-shaped binding | `makeD1Fake`                                     |

`Gateway` is R2-only. Atomic multi-statement writes are the `Batch` service in
`packages/api/src/batch.ts`, satisfied in production by D1's own `batch` and in
tests by `SqlClient.withTransaction`.

## Why

The schema leans on four things a hand-written stub gets wrong: `STRICT` column
affinity, `WITHOUT ROWID` tables, foreign keys (`photo_tags` carries
`ON DELETE CASCADE`), and unique/partial indexes. The aggregate and
keyset-paginated queries the product actually issues are exactly the ones where
those differences decide whether a test passes. The alternatives were a
hand-written `D1DatabaseLike` stub — which had to re-implement constraint
enforcement to be worth anything, and whose mistakes read as false greens — and
`@cloudflare/vitest-pool-workers` (miniflare), the most faithful option and the
heaviest: a new dev dependency and a custom vitest pool per package, with
Node-only utilities like the image-metadata path and `node:fs` unable to run
inside workerd.

Going to `SqlClient` is the part this amendment records. It was not a preference
between styles: 52 call sites each wrapped their own `Effect.tryPromise` with a
bespoke `StorageError` and a `describeCause` flattening, which is a re-implemented
`SqlError` that threw away the query, the parameters and the engine's reason. It
also bought a prepared-statement cache and spans that carry the query text, which
no amount of hand-wrapping was going to give.

`Batch` exists because D1 has no transactions. Its atomic primitive is `batch`,
which the generic `SqlClient` deliberately does not expose — no dialect promises
it. Putting atomicity behind a service means the two callers that need it name the
guarantee rather than the driver, and the tests can satisfy the same guarantee
with a real transaction.

## Consequences

- A migration that does not apply, or a query that only works under a permissive
  stub, fails in CI instead of in production. `migrations/*.sql` is load-bearing
  for the test run, not just for deploy.
- `D1DatabaseLike` is gone. `MetadataLive` is the one place that knows the
  metadata database is D1.
- **D1's `batch` is not a transaction and `@effect/sql-d1` does not support
  `withTransaction`.** Any future write that needs rollback-and-retry semantics,
  or `updateValues`, must be written against `Batch` or not at all.
- `R2BucketLike` gained `head` and `list`, and `R2ObjectLike` gained `key`,
  `size` and `uploaded`, so byte counts and storage totals are expressible
  against the contract rather than only against a real binding. Nothing reads
  them by page or prefix — Photo listing is a D1 query — so the fake's `list`
  takes no options rather than implementing a pagination no caller reaches.
- The fakes are Node-only. Anything that must run under workerd is not covered
  by this harness — which is why `BatchD1Live` has its own test over a D1-shaped
  binding rather than relying on the SQLite harness to stand in for it.
- `WebsiteEnv['PHOTOS']` in `alchemy.run.ts` and `R2BucketLike` in
  `packages/api/src/gateway.ts` are two declarations that must agree, and the env
  shape cannot import the contract. Nothing checks them head-on, and nothing
  needs to: `metadataLayer` in `packages/web/src/api-worker.ts` hands
  `env.PHOTOS` straight to `MetadataLive`, which takes an `R2BucketLike`, so a
  member added to the contract without the copy is a type error there. The
  explicit `as never` this used to need is what made the gap invisible.
- The platform's `R2Bucket` is not assignable to `R2BucketLike`, and that is not
  fixable: the platform ships its own `ReadableStream`, which is mutually
  unassignable with the DOM one the services hand to `new Response`. The Worker
  declares the structural shape instead, which is what the real binding satisfies
  at runtime. `D1` does not have this problem, so `WebsiteEnv['DB']` is the real
  `D1Database`.
