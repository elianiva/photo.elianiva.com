# Stack: pnpm + Turborepo + Foldkit + Effect + Alchemy, two Workers on one hostname

Accepted.

## Decision

A pnpm workspace (`packages/*`) driven by Turborepo (`build` and `typecheck`
and `test` depend on `^build`, `dev` persistent), Tailwind CSS v4 through
`@tailwindcss/vite`, and Alchemy in `alchemy.run.ts`. Matches the org
conventions in `lutra`/`foldcn`/`saku` and keeps infra, frontend and domain
model in one repo.

- `packages/web` — Foldkit frontend **and** both Workers.
- `packages/api` — Photo/Tag/Settings services over the D1 and R2 bindings.
- `packages/shared` — the contract (below).

`alchemy.run.ts` deploys two Workers on **one** hostname:

| Resource                                                                           | Answers                                                                                      | Gated                                        |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `Website.Vite` (`packages/web/src/worker.ts`) — custom domain `photo.elianiva.com` | the Front (`/`, server-rendered), the Admin shell (`/admin*`), `/sitemap.xml`, static assets | `/admin*` by Access                          |
| `Worker` (`packages/web/src/api-worker.ts`) — route `photo.elianiva.com/api/*`     | the API surface (ADR 0003)                                                                   | `/api/admin/rpc` and `/api/upload` by Access |

The route is a more specific match than the custom domain, so the two Workers
never both claim a URL. Two Workers stay two Workers because `alchemy dev`
binds the real D1 and R2 to a Worker resource while the site's Vite dev server
has no bindings at all. In production they share an origin; in development they
are two fixed localhost ports, which is the only stage where CORS exists.

`Website.Vite` takes no `main`: `src/worker.ts` is the entry of the `ssr`
environment in `packages/web/vite.config.ts`, and that single description is
what both `pnpm build` and `pnpm infra:deploy` read. A second description of
the same build would be a wrong one is invisible to `pnpm build` and fatal at
deploy.

## `packages/shared` owns the contract

The domain schemas (`PhotoId`/`TagId` brands, `Tag`, `PhotoMetadata`,
`PhotoWithTags`, the D1 row shapes) and the RPC groups with the domain errors
they can fail with live here, in `photo.ts` and `rpc.ts`. `packages/web` and
`packages/api` both depend on it as `workspace:*` and consume it as TypeScript
source through the `paths`/alias mapping — no build step, Vite transforms it on
the fly.

The package was introduced on day one, for a Hello placeholder, so the contract
boundary existed before any storage choice locked the domain shape. The
pre-RPC `api.ts` (`HelloResponse`, `ApiError`, per-verb request/response
schemas) was deleted once ADR 0003 moved the contract into `rpc.ts`, rather than
left beside it as a second contract: a dead module is worse than no module,
because the next reader cannot tell which one is the contract.

## Consequences

- Renaming an RPC or a schema field fails typecheck at every call site.
- A new capability is one group member in `packages/shared` and one handler in
  `packages/api`; there is no URL, router arm or method to keep in step.
- The website Worker imports `@photo/api`, so the public read model ships in
  both Worker bundles.
