# Effect audit — what this codebase is not yet using

> Survey of `photo.elianiva.com` against the Effect 4 API surface, and the
> record of what has been done about it. The pinned version is
> `effect@4.0.0-rc.116`; `~/Development/repos/effect` (at `4.0.0-rc.118`) was
> the reference. **Read the version note below before copying an import path
> from either.**
>
> **Status: all six items done.** `packages/api`'s data layer (A1/A2), the two
> Workers' HTTP paths (A3/A4) and the two small ones (C4/C5) are all in. What
> remains is listed at the end, and it is deliberately short.

## Version note — the subpaths differ from the reference repo

At `4.0.0-rc.116` the `sql` and `persistence` modules ship under `unstable/`.
The reference repo (`rc.118`) has them at the top level, so its paths do not
resolve against the installed version:

| Module      | rc.118 (reference repo)          | rc.116 (pinned here)                      |
| ----------- | -------------------------------- | ----------------------------------------- |
| SqlClient   | `effect/sql/SqlClient`           | `effect/unstable/sql/SqlClient`           |
| Migrator    | `effect/sql/Migrator`            | `effect/unstable/sql/Migrator`            |
| RateLimiter | `effect/persistence/RateLimiter` | `effect/unstable/persistence/RateLimiter` |

`effect/sql` and `effect/persistence` are not merely unstable in rc.116 — they
are absent, and the `exports` map does not list them, so the import fails at
resolve time rather than at runtime.

`KeyValueStore` is the fourth such module, and it _is_ used
(`packages/web/src/admin/prefs.ts`).

## Baseline — what was already Effect

The stack is genuinely Effect-native, so what follows are gaps in a mature
codebase rather than a conversion backlog:

| Already load-bearing                                              | Where                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Rpc` / `RpcGroup` / `RpcServer` / `RpcClient`                    | `packages/shared/src/rpc.ts`, `packages/api/src/rpc.ts`, `packages/web/src/lib/rpc.ts`, `packages/web/src/api-worker.ts` |
| `Schema` as the wire + domain contract                            | `packages/shared/src/{photo,settings,rpc,upload}.ts`                                                                     |
| `Layer` / `Context.Service` for the service graph                 | `packages/api/src/{gateway,photo,public-photo,tag,settings}.ts`                                                          |
| `Stream` + `Queue` for the upload queue                           | `packages/web/src/admin/subscriptions.ts`                                                                                |
| `Option`, `DateTime`, `Match`, `ManagedRuntime`, `Scope`, `Cause` | throughout                                                                                                               |

Non-test counts, measured before and after (`git grep` at `HEAD` vs the working
tree; the test fixtures' own `try`/`catch` are counted on both sides so the
delta is not flattered by leaving them out):

```
                                     HEAD   now
hand-written `try {` blocks           23     17
hand-written `throw new`               7      5
`JSON.parse` call sites                9      9   <- see below
`Effect.fn` spans                      0      4
`Logger` layers                        0      1
```

The `JSON.parse` count is flat and still reads as a failure until you look at
where the sites are. Seven of the nine now sit inside a total function — the
module-level `parseJson` in `api-worker.ts`, `subscriptions.ts` and
`access.ts`, each an `Option.liftThrowable`, so a body that is not JSON is a
`None` rather than a `try`. The two that remain raw are in
`packages/api/src/photo.ts:309,398` and are part of the data layer A1 retires.

---

## Done

### C2 — hand-rolled parsers are now Schema

Nine `JSON.parse` sites, each with its own `try`/`catch` and manual re-shaping,
now decode against declared Schemas.

- **New `packages/shared/src/upload.ts`.** `POST /api/upload` is the one route
  that is not RPC, and its contract had two readers on two sides of the boundary
  with nothing joining them: the Worker produced raw `jsonResponse({ message })`
  and the Admin's queue parsed a hand-written `{ message?: unknown }`. Both now
  use one `UploadResponseBody`. `Blurhash` and `TagIdList` moved into the same
  module, so the upload path and the `UpdatePhoto` payload can no longer
  disagree about what a Blurhash is or how many Tags a selection may carry.
- `api-worker.ts` uses `Option.liftThrowable` for the parse and a small
  `decodeJsonField` for parse-plus-validate, so "not JSON" and "not the declared
  shape" are one `None` rather than two hand-written guards.

**A latent bug this surfaced.** The Admin's queue read `renditionsPending` off
the upload response and held such a row at `processing`, but the Worker never
sent the field — so `uploadSuccessIsPending` was `false` for every upload and
the E6 "processing" hold was dead code. The field is now **required** in
`UploadSuccessBody` and the Worker sends it explicitly (`false`, since
regeneration is not built — CONTEXT.md `Rendition`, #35). A client that had to
guess whether the field was there was a client whose guess would be wrong the
day it first appeared.

### C1 — `access.ts` is Effect end to end

`packages/web/src/access.ts` imported only `DateTime` and `Effect` and used
them on one line; the rest was `async`/`await` with three `try`/`catch` blocks
and two hand-rolled caches. It is now:

- `Result<AdminClaims, AccessRejection>` instead of a hand-rolled
  `{ ok: true } | { ok: false, response }`. A rejected request is an answer the
  Worker turns into a status, not a program that died.
- `Schema` for the JWT header, the JWT payload and the JWKS document. The eight
  `reason` strings are still computed, and are now **logged** — they were
  previously computed and then dropped on the floor, since `verifyAdminAccess`
  answered a bare `access denied`.
- `HttpClient` for the JWKS fetch.
- `Cache.make` with a one-hour TTL for the per-team JWKS, replacing a module
  `Map` plus a hand-rolled expiry check.

Two genuine landmines were found here, both worth knowing:

1. **`Context.Reference` memoises its default value process-wide.** `effect.ts`
   stores it on the reference object at first read (`Context.ts:1613`,
   `defaultValueCacheKey`). So `FetchHttpClient.Fetch` captures
   `globalThis.fetch` on the first request, and a `vi.stubGlobal('fetch', …)`
   after that is invisible to it. The first Access test passed and every one
   after it failed with `bad signature` — each was being handed the _first_
   test's public key. Fixed on the test side by providing `Fetch` explicitly,
   and in `api-worker.ts` by naming `globalThis.fetch` in the wrapper so it is
   read per call.
2. **`HttpClientResponse.filterStatusOk` and `schemaBodyJson` are not dual.**
   Each takes the response itself rather than an `Effect` of one, so
   `.pipe(HttpClientResponse.filterStatusOk)` hands them an `Effect` and fails
   at runtime with `Fiber.runLoop: Not a valid effect: undefined`. They are
   applied data-first, with `Effect.flatMap`.

A third was a TypeScript consequence rather than an Effect one: a property
narrowing on an Effect `Struct.Type` is **not** carried into a closure, so
`jwk.n` inside a `tryPromise`'s callback read back as `string | undefined` and
no `crypto.subtle.importKey` overload matched. The three JWK fields are bound to
names before the closure now.

### B — the TTL caches

- **JWKS** → `Cache` with a TTL, as part of C1 above.
- **`rate-limit.ts`** → a `RateLimit` service with a Layer per route, and
  `Clock.currentTimeMillis` instead of `Date.now()`, so the limiter is
  `TestClock`-driven and has no way to read a time the runtime did not report.
  The three module-scoped limiters in `api-worker.ts` became three named Layers,
  so the three counters are three separate tables by construction rather than by
  three names.
- **`blurhash.ts`** → `compositionSource` now returns
  `Effect<Option<ImageBitmap>>` off a `Cache.makeWith`, and its time-to-live is
  a function of the lookup's `Exit`. **This fixed a real bug:** the old
  `Map<string, Promise<ImageBitmap | undefined>>` stored the _settled_ promise,
  so one unreachable fetch made that URL undecodable for the rest of the session
  and no later re-encode could recover. A failure now expires immediately.
  `Cache` also evicts least-recently-used rather than oldest-inserted, and
  dedupes in-flight lookups, which the `Map` did by accident rather than by
  design.

**Why `rate-limit.ts` does not use `RateLimiter`.** It is the obvious candidate
and it works. It is not used because its `"fixed-window"` algorithm is a _leaky
bucket_, and the two answer differently on a route that fronts an auth gate.
Measured at `limit: 1, window: 60s`: the bucket's answer stays `delay = 59s` at
t = 1s, 61s, 121s and 181s, because each refused request borrows the token the
moment it refills — a client that keeps hammering never recovers. The old
window answers at t = 61s, because the first hit has aged out. Its `resetAfter`
is also the time until the window is _whole_ rather than until this key has
room, so a rejected upload would carry `retry-after: 57` where the window
carried the time until the oldest hit expired. Both are defensible for a burst
guard, and a leaky bucket is arguably the better abuse damper — but changing the
semantics of the gate in front of `/api/upload` is a product decision, not a
refactor. The algorithm stays; the swap is one `check` body.

**`placeholderDataUrl` keeps a plain `Map`, deliberately.** Both its callers are
synchronous foldkit view builders on the grid's render path; an `Effect` memo
would put a fiber in the middle of drawing a tile. What the `Map` lacked was a
bound — every hash ever rendered kept a base64 PNG alive for the life of the
tab — so it is now capped at 256 with least-recently-used eviction.

### D — the Workers' spans and logger

`RpcServer` has opened a span per RPC since ADR 0003, but nothing was reading
them: there was no `Logger` in either Worker. `packages/web/src/lib/logger.ts`
adds `Logger.layer([Logger.consoleJson])` — one JSON object per line, which is
what `wrangler tail` and a host's log store can filter on.

Spans were added where `RpcServer` does not reach, named for the route class
rather than the function so they survive a refactor of the file they live in —
`api.upload`, `api.imageProxy` and `api.health` in `api-worker.ts`, and
`site.sitemap` in `public-site.ts`:

| `api.upload` | `POST /api/upload` |
| `api.imageProxy` | `GET /api/image/<key>` — now an `Effect`, so an R2 that is not answering is a recorded 404 rather than an unhandled rejection |
| `api.health` | the D1 probe, which was a bare `try`/`catch` around an `await` |
| `site.sitemap` | `/sitemap.xml`, and its two independent reads now run through `Effect.all` rather than sequentially |

`public-site.ts` gained a `readSiteEffect` so a caller already inside a pipeline
does not have to leave it; the Promise-returning `readSite` is now a thin
wrapper over it, and the empty-Folio-on-failure decision lives in one place
rather than in each of the two readers.

---

## Not done

### A1 / A2 — `@effect/sql-d1` and the `SqlClient` test harness — done

The metadata database is `effect/unstable/sql/SqlClient` throughout.
`@effect/sql-d1` and `@effect/sql-sqlite-node` are dependencies of
`packages/api`; `MetadataLive` in `packages/api/src/metadata.ts` is the one
place that knows the database is D1, and `Gateway` is R2-only.

What replaced what:

- **52 hand-rolled `Effect.tryPromise` sites** are tagged SQL templates and
  fragments. Every failure is now a typed `SqlError` carrying the query, the
  parameters and the engine's own reason, where the old `StorageError` +
  `describeCause` pair threw all three away into a flattened string.
  `StorageError` keeps its wire-safe `cause: string` for the upload body, and
  `describeCause` stays for exactly that — it is still what flattens a cause
  into that string, on the R2 calls that `tryPromise` because Effect has no R2
  module. What is retired is the _SQL_ use of it, where a typed error now
  carries the query itself.
- **`D1DatabaseLike`** is gone. It was a hand-written re-declaration of the
  binding surface, and it was also _narrower than the real binding_ — which is
  why the Worker wiring had to hand `env.DB` over with an `as never`.
- **The old `testing/d1-fake.ts`** — 118 lines re-implementing `D1Database`'s
  API by hand — is gone. The harness is a `SqlClient` over `node:sqlite` running
  the real `migrations/*.sql`, and `describeFailure` reads a `Data` error's
  prototype-only `message` / `cause` / `reason` so a test can assert on the
  engine's own reason rather than the wrapper's. (A _different_ `d1-fake.ts`
  exists now, with a narrower job — see below.)
- **`Batch` is a service, not a method.** D1 has no transactions; its atomic
  primitive is `batch`, which the generic `SqlClient` deliberately does not
  expose because no dialect promises it. Production satisfies it with
  `BatchD1Live` (D1's own `batch`); the tests satisfy it with
  `BatchTransactionLive` (`withTransaction` on `node:sqlite`). Both are atomic,
  and the two callers that need it name the guarantee rather than the driver.
- **`BatchD1Live` has its own test.** The service suite runs on the SQLite
  driver, so `@effect/sql-d1` and the one method the generic `SqlClient` lacks
  would otherwise ship untested. `testing/d1-driver.test.ts` runs the real
  `MetadataLive` over `testing/d1-fake.ts` — a `D1Database` binding on
  `node:sqlite`, answering the same `prepare`/`bind`/`first`/`all`/`run`/`raw`/
  `batch` surface, with `batch` atomic by the same guarantee D1 makes. That
  leaves the platform as the only thing faked below it.
- **ADR 0005 is amended**, since the thing it describes no longer exists in that
  shape.

The caveats recorded in the ADR rather than discovered later:

- `@effect/sql-d1` supports neither transactions nor `updateValues`. A future
  write that needs rollback must go through `Batch` or not happen.
- `WebsiteEnv['DB']` is now the real `D1Database`, because the driver demands
  exactly that type. `WebsiteEnv['PHOTOS']` stays structural: the platform ships
  its own `ReadableStream`, which is mutually unassignable with the DOM one the
  services hand to `new Response`. `packages/web/src/env-bindings.test.ts` is a
  bidirectional assignability check between the env shape and `R2BucketLike`,
  because the two have drifted before and the result was a cast rather than an
  error.
- `SqlResolver.grouped` and `Migrator` were **not** adopted. `grouped` wants a
  resolver per statement and the queries here are a handful of multi-column
  reads; `Migrator` is for running migrations, and both `harness.ts` and
  `alchemy.run.ts` want "apply these files' statements" rather than a
  ledger-tracked version, which is what the migration table would be for.

### A3 / A4 — the Workers' HTTP paths — done

Both Workers dispatch through `HttpRouter`. The `if`-chains and the
hand-normalised trailing slash are gone; `HttpRouter.cors` replaced the ~40
lines of hand-rolled CORS including the `b3` / `traceparent` preflight list, and
`HttpRouter` replaced the website Worker's four-branch `async`.

Two things that turned out to matter, and neither is obvious:

- **`HttpRouter.middleware` may only require services the router itself
  provides.** The Access gate and the rate limiters are arguments of `fetch`,
  not router services, so the middleware closes over them — which is sound
  because the app is rebuilt per request from those same arguments. The
  platform's `Request` is provided into the request that came from it for the
  same reason: `HttpServerRequest` has no `formData()`, and the upload is a
  multipart body only the platform can read.
- **A path parameter matches one segment.** `${IMAGE_PATH}/:key` 404s every
  image in the bucket, because every key is `originals/<id>.jpg`. The route is
  `/*` and the key validation stayed in the handler, where it belongs — that
  check is about R2, not about routing.

One behaviour changed, deliberately: a preflight from a disallowed origin answers
`204` without `access-control-allow-origin` where it used to answer `403`. The
refusal is the absent header in both cases and that is the part a browser
enforces. `access.test.ts` asserts `204` explicitly so the change is visible.

The 404 is an explicit catch-all route. Global middleware cannot reach the
answer the router produces _before_ a route is matched, and the hand-written
dispatcher put security headers on every response; the catch-all makes the 404 a
route like any other, so it keeps them.

`HttpStaticServer` was **not** used for the website Worker's asset branch: it
reads from a `FileSystem` root, and the assets here come from a Workers Static
Assets binding reached by `fetch`. The catch-all route asks the binding.

Both dispatchers are covered by new tests — `api-routes.test.ts` and
`page-routes.test.ts` — because path matching is an observable contract that a
dispatcher refactor can break silently.

### C4 / C5 — the small ones — done

- **`localStorage`** was one site, in two functions. It is now
  `packages/web/src/admin/prefs.ts`: a `GridPrefs` service over
  `KeyValueStore.layerStorage`, which owns the storage key, the SSR guard, and
  the fact that a value outside the five choices is a _decoding failure_ rather
  than a `find(...) ?? 4` at the point of use. A store that throws is a
  preference that cannot be remembered, not a failure the operator can act on,
  and both the read and the write now say so once instead of twice.

  One asymmetry, and it is Foldkit's: `init` is synchronous by contract, so the
  startup _read_ stays a plain function and the _write_ is a command over the
  service. Both go through one decode, so they cannot disagree.

- **`scripts/seed.ts`** is an `Effect` program with a Schema for the seed data,
  `HttpClient` for the apply path, and the shared `UploadResponseBody` for
  reading what the API answered — so it cannot print a success the Admin would
  render as a failure. It has its own `tsconfig.json`: it runs in Node, and the
  packages must not inherit Node globals from the base (ADR 0005).

  Two real bugs the rewrite fixed rather than preserved: the dry run now escapes
  SQL string literals, and it prints the width and height as numbers. It used
  to quote them, which a `STRICT` table refuses — so the dry run was printing
  statements the database would reject. The output was verified against a real
  migrated `node:sqlite` database: 8 tags, 12 photos, 8 links, and idempotent
  on a second run.

## Remaining

- **`SqlResolver` / `Migrator`** — see the A1/A2 notes above; deliberately not
  adopted, with the reason.
- **The real D1 driver against a real D1.** `BatchD1Live` and `MetadataLive` are
  covered by `d1-driver.test.ts`, over a D1-_shaped_ binding on `node:sqlite`.
  Running them against a real D1 needs `wrangler` or miniflare, neither of which
  the repo has, and the dev server needs Cloudflare credentials this environment
  does not have. So the D1 driver is verified for shape, atomicity and error
  mapping — not against Cloudflare's implementation.
- **The view layer** — see below. Unchanged, deliberately.

## What should not be effectified

- **The view layer** (`packages/web/src/{admin,public}/views/*.ts`, 5,693 lines
  of HTML builders) and **`components/ui/*`** (4,109 lines). Correctly plain
  functions returning foldkit HTML. `placeholderDataUrl` above is the same call.
- **EXIF parsing in `image-meta.ts`** — `Effect.tryPromise({ catch: () => undefined })`
  is already the Effect-idiomatic spelling for a genuinely optional fact.
