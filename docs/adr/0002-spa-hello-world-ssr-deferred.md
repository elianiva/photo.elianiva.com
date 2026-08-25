# SPA hello world — SSR deferred to Workers host

Initial scaffold used `@foldkit/vite-plugin` `ssr: { serverEntry }` with `Runtime.hydrate` and `alchemy Website.Vite`, which produced `Error: [foldkit] Runtime.hydrate could not find a server-rendered root stamped with data-foldkit-app`. Investigation against `~/Development/repos/foldkit` (templates `rendering/ssr`, `packages/website/src/page/core/serverRendering.md`, snippet `serverRenderingWorkersHost.ts`) shows:

- `Alchemy Website.Foldkit` is **client-only SPA** (assets-only, `notFoundHandling: single-page-application`). It `vite build`s the client and serves `dist/index.html` as-is — no `renderPage` at request time, so hydration has no stamped root.
- `Alchemy Website.Vite` with a single call deploys TanStack/SolidStart server bundles via the Cloudflare Vite plugin's `viteEnvironments`. Foldkit's SSR entry (`src/entry.server.ts` → `Server.renderToString` → `Server.toResponse(template, result)`) is **not** a Vite environment the plugin knows — it needs a custom Workers host that imports the built template and calls `renderPage` per request (see `examples/ssr/server/main.ts` and Workers snippet: `import template from './dist/client/index.html'` + `Server.toResponse(template, await renderPage(request))`).
- `vite build` alone only emits `dist/client` (372 modules) — no `dist/server` without `vite build --ssr server/main.ts` (see `packages/create-foldkit-app/templates/rendering/ssr/scripts/build.mjs`).

Scaffold ships as **SPA** (`packages/web/vite.config.ts` → `foldkit()` no `ssr`, `src/entry.ts` → `Runtime.run`, `alchemy.run.ts` → `Website.Foldkit('photo', { domain: 'photo.elianiva.com' })`) so `https://photo.elianiva.com` boots via `Runtime.run` without hydration. Verified `curl https://photo.elianiva.com/` → SPA shell, `cf-cache-status: HIT`, no `[foldkit]` error.

SSR with `cache-control: public, max-age=60, s-maxage=60, stale-while-revalidate=300` (and `Flags` cookie variant for personalized views) will be reintroduced via a Workers host (`src/worker.ts` → `Server.toResponse`) or by making `entry.server.ts` the Cloudflare entry through `Alchemy Website.Vite` with `main` + `viteEnvironments`. See `docs/plan.md` Phase 2.

Supersedes the prior SSR intent; cache headers arrive with the Workers host.
