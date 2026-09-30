# Test fakes: a real SQLite engine, not miniflare

Accepted.

## Decision

`packages/api`'s services are tested against an in-memory D1 backed by
`node:sqlite` and an in-memory R2 backed by a `Map`, both built behind the
structural `D1DatabaseLike` / `R2BucketLike` contracts in
`packages/api/src/gateway.ts` and provided through the `withGateway` seam. The
harness lives in `packages/api/src/testing/` and is not re-exported from the
package index, so `node:sqlite` never reaches a Worker bundle. `node:sqlite` is
a stable Node builtin at the repo's floor (Node 24+), with a scoped ambient
declaration for the handful of members the fakes use rather than a
`@types/node` dev dependency: `@photo/api` is Worker-typed on purpose, and
pulling in Node types to typecheck two Node-only fakes would undo that.

## Why

The schema leans on four things a hand-written stub gets wrong: `STRICT` column
affinity, `WITHOUT ROWID` tables, foreign keys (`photo_tags` carries
`ON DELETE CASCADE`), and unique/partial indexes. The aggregate and
keyset-paginated queries the product actually issues are exactly the ones where
those differences decide whether a test passes. The alternatives were a
hand-written `D1DatabaseLike` stub — which would have to re-implement constraint
enforcement to be worth anything, and whose mistakes read as false greens — and
`@cloudflare/vitest-pool-workers` (miniflare), the most faithful option and the
heaviest: a new dev dependency and a custom vitest pool per package, with
Node-only utilities like the image-metadata path and `node:fs` unable to run
inside workerd.

`node:sqlite` loads the actual `migrations/*.sql`, so the schema under test is
the schema that ships.

## Consequences

- A migration that does not apply, or a query that only works under a permissive
  stub, fails in CI instead of in production. `migrations/*.sql` is load-bearing
  for the test run, not just for deploy: a migration that is not valid
  standalone SQLite breaks the suite.
- `R2BucketLike` gained `head` and `list`, and `R2ObjectLike` gained `key`,
  `size` and `uploaded`, so byte counts and storage totals are expressible
  against the contract rather than only against a real binding.
- The fakes are Node-only. Anything that must run under workerd is not covered
  by this harness.
- If the fakes diverge from D1 in a way that matters, swapping in
  `@cloudflare/vitest-pool-workers` is contained to
  `packages/api/src/testing/` plus one vitest pool config; the contracts in
  `gateway.ts` and every service stay as they are.
