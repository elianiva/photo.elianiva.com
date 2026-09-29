# The website Worker reads D1 through the same Layer stack as the API Worker

## Status

Accepted

## Context

`packages/web/src/worker.ts` — the website Worker — was the only place in the
repo that reached for a binding directly. Its sitemap handler ran
`env.DB.prepare('SELECT takenAt FROM photos ORDER BY takenAt DESC LIMIT 1')`
and nothing else, because it had no read path of its own. Meanwhile
`api-worker.ts` composed a proper stack: `GatewayLive({ db, photos })` ->
`PhotoServiceLive` / `TagServiceLive` -> `RpcGroup.toLayer` -> `HttpRouter` ->
`RpcServer`.

The Front is about to be drawn from the database (#38). Its read path had to
go somewhere, and the open question was how a server-rendered page reaches D1:

- **Direct SQL, extended.** Fastest and least code, and the Front's queries
  are reporting-shaped. Two data-access styles forever, and none of them
  testable without a hand-rolled harness.
- **Layers in the website Worker.** `GatewayLive` from `env.DB` / `env.PHOTOS`,
  a read-only public service over it, and the server entry runs it inside an
  `Effect` runtime. The sitemap query becomes a call to that service and the
  direct-SQL seam is deleted rather than extended. The website Worker gains a
  `@photo/api` import it did not have.
- **SSR over the network to the API Worker.** One service, no Layer wiring.
  An internal network hop per SSR request, and a hard dependency on the API
  Worker being up and CORS-correct.
- **Hybrid.** Layers for domain reads, direct SQL for aggregates. The worst of
  the first two.

The decisive cost is testability. `pnpm dev` cannot be run in CI, and the dev
SSR entry is served by the Vite middleware rather than by workerd, so a
hand-written SQL seam in `worker.ts` is the one piece of the read path that no
test can reach. Everything behind a Layer is exercised against real SQLite
through the harness ADR 0009 built.

## Decision

The website Worker builds the same stack the API Worker does, from the same
bindings, through the same `Gateway`. A direct `env.DB.prepare` is not a
third style to be extended; it is deleted.

`PublicPhotoService` (`packages/api/src/public-photo.ts`) is the public site's
read model. It sits beside `PhotoService` rather than inside it because the
two answer for different audiences: `PhotoService` is the Admin's and
deliberately sees Drafts, failed uploads and the Trash, while every
`PublicPhotoService` method filters to `published` and non-Trashed internally,
so no caller can forget. They share the `Gateway`, the `PHOTO_COLUMNS` list,
the tag loader and the row decoder, so the two cannot disagree about what a
Photo is and there is one read model rather than two.

`packages/web/src/lib/public-site.ts` owns the website Worker's side of that
stack. `worker.ts` asks it for the sitemap and nothing else reaches for a
binding.

Grouping and counting stay in SQL. `takenAt` is `YYYY-MM-DD` TEXT, so
`substr(takenAt, 1, 7)` groups published Photos into the Front's Edition
Sections and the collation orders those months; the frame count and number
range are `COUNT`/`MIN`/`MAX` over the same set. Pulling every published row
into the isolate to group it in JavaScript would put a whole table through the
line on every request.

## Consequences

- One data-access style repo-wide, and the sitemap's `lastmod` is now
  `MAX(takenAt)` over **published, non-trashed** Photos rather than every row,
  so a trashed photograph stops dating the sitemap.
- A read path that fails leaves the sitemap's `lastmod` out instead of failing
  the route: a sitemap without `lastmod` is valid, and one that 500s tells a
  crawler the site is broken over a date it does not need.
- The website Worker now imports `@photo/api`, so the public read model ships
  in the Worker bundle as well as the API Worker's.
- The public read is tested against real SQLite through ADR 0009's harness. The
  `worker.ts` seam it replaced was not tested at all.
- #38 draws the Front from this service. The dev SSR entry
  (`entry.server.ts`) is what serves the Front under `pnpm dev`, and it is
  called with a `Request` and nothing else — no `env` argument — so it has to
  read the bindings off `cloudflare:workers` rather than off a second
  parameter. That is #38's call to make; `readSite` is what it calls.
- Foldkit's dev middleware refuses a path that names an asset before the
  server entry sees it, so `/sitemap.xml` is a 404 in dev and only the Worker
  answers it. That gap predates this decision and is left alone: the sitemap
  has no dev mirror to give, because no request naming it reaches the entry.
