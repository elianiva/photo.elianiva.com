# SSR with cache-control headers

`packages/web` is SSR via `@foldkit/vite-plugin` `ssr: { serverEntry: '/src/entry.server.ts' }` (not SPA, not SSG prerender). `entry.server.ts` renders per request through `Server.renderToString` with `Flags` (hydration-safe) and returns `Server.Rendered` with `cache-control: public, max-age=60, s-maxage=60, stale-while-revalidate=300`. No KV binding in the scaffold — Cloudflare edge caches the SSR response. KV/R2 bindings arrive when the photo source is wired.

We chose SSR over SPA because a photography showcase benefits from server-rendered first paint and SEO for collections, and over SSG because collections will grow and invalidation via cache headers is simpler than a full-site prerender.
