# Test fakes: a real SQLite engine, not miniflare

`packages/api`'s services are tested against an in-memory D1 backed by
`node:sqlite` and an in-memory R2 backed by a `Map`, both built behind the
structural `D1DatabaseLike` / `R2BucketLike` contracts in
`packages/api/src/gateway.ts` and provided through the existing `withGateway`
seam. The harness lives in `packages/api/src/testing/` and is not re-exported
from the package index, so `node:sqlite` never reaches the Worker bundle.

## Context

Every service in `packages/api` shipped untested, and the four tests in the
repo touched none of `Gateway`, `PhotoService`, `TagService` or the RPC
handlers. Writing the first service test forces a choice about what stands in
for D1 and R2.

The schema leans on four things a hand-written stub gets wrong: `STRICT`
column affinity, `WITHOUT ROWID` tables, foreign keys (the `photo_tags` join
carries `ON DELETE CASCADE`), and unique/partial indexes. The aggregate and
keyset-paginated queries the rest of the redesign chain adds are exactly the
ones where those differences decide whether a test passes.

Alternatives:

- **Hand-written `D1DatabaseLike` stub** — no dependency, but it would have to
  re-implement constraint enforcement to be worth anything, and anything it
  got wrong would be a false green.
- **`@cloudflare/vitest-pool-workers` (miniflare)** — the most faithful option,
  running the service inside workerd against a real D1 and R2 binding. Also the
  heaviest: a new dev dependency and a custom vitest pool per package, and
  Node-only utilities (the image-metadata path, `node:fs`) stop working inside
  the worker runtime.
- **`node:sqlite`** — a stable Node builtin (Node 24+; the repo requires >= 22)
  wrapping real SQLite. It loads the actual `migrations/*.sql`, so the schema
  under test is the schema that ships.

## Decision

`node:sqlite`, with a scoped ambient declaration for the handful of members the
fakes use rather than a `@types/node` dev dependency. `@photo/api` is
Worker-typed on purpose — `gateway.ts` declares structural Cloudflare contracts
precisely so nothing in the package needs workerd or Node types — and pulling in
`@types/node` to typecheck two Node-only test fakes would undo that.

`R2BucketLike` gains `head` and `list`, and `R2ObjectLike` gains `key`, `size`
and `uploaded`, so byte counts and storage totals are expressible against the
contract rather than only against a real binding.

## Consequences

- A migration that does not apply, or a query that only works under a
  permissive stub, fails in CI instead of in production.
- The fakes are Node-only. Anything that must run under workerd is not covered
  by this harness.
- `withGateway`, previously exported with no callers, is now the seam the
  service tests provide through.
- If the fakes turn out to diverge from D1 in a way that matters, swapping in
  `@cloudflare/vitest-pool-workers` is contained to
  `packages/api/src/testing/` plus one vitest pool config; the contracts in
  `gateway.ts` and every service stay as they are.
- `migrations/*.sql` becomes load-bearing for the test run, not just for deploy.
  A migration that is not valid standalone SQLite breaks the suite.
