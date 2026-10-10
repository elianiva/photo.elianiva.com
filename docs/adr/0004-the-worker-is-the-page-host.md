# The website Worker is the page host, and it reads D1 through the same Layer stack

Accepted.

## One page host, in development and in production

`packages/web/src/worker.ts` renders the home page with `Server.renderToString`,
injects the result into the client template it reads through the `ASSETS`
binding, serves the Admin shell, and answers `/sitemap.xml` and the API-path
misses. It is the only thing in the repo that serves a page, in either stage.

Getting there took two corrections.

**The site shipped as a client-only SPA.** `Alchemy Website.Foldkit` is
assets-only: it `vite build`s the client and serves `dist/index.html` as-is, so
there is no server-rendered root for `Runtime.hydrate` to find. SSR needed a
custom Workers host, and the site shipped as a SPA until one existed.

**Then the page host was the asset layer.** The Worker owned page paths, but
Cloudflare serves a matching asset _before_ a Worker — and `dist/client/index.html`
is a matching asset. So `GET /` was answered with the client template: an empty
`<div id="root">`, no `data-foldkit-app` stamp, no Flags payload. The client's
`Runtime.hydrate` read the missing stamp as a refused handoff and contained the
document behind the refusal shield — in dev and deployed alike, not development
only.

The dev server's own middleware was believed to be in charge at the same time
and was not: `foldkit({ ssr: { serverEntry } })` makes the plugin own HTML
navigations in development, but it stands that middleware down when the `ssr`
environment is not runnable, and the Cloudflare Vite plugin backs `ssr` with
workerd. `GET /nope` with `Accept: text/html` returning a Worker 404 is what
proved the Worker was the only page host that had ever answered.

So `assets.runWorkerFirst` in `alchemy.run.ts` is
`['/', '/index.html', '/about', '/admin', '/admin/*']` ahead of
`notFoundHandling: 'none'`: the Worker's page paths run first, and everything
else keeps the asset layer's own assets-first order, so a hashed bundle, a font
and a Vite module never enter the Worker. `/index.html` is in that list and
answers with a 308 to `/` — it is the home page's own URL under its old spelling,
and the one thing the asset layer can serve for a page is a template no client
can boot. **A page path added later is a Worker-first path too**, or the asset
layer answers it with the template.

The public site is one app with more than one document, and that is what makes
the rule mechanical rather than a memory test. `public/route.ts` declares the
documents — the home page, `About` and a Tag page — and the Worker answers a path
from that table alone, so `/about` is a Worker-first path because the table says
it is a page and not because anyone remembered to add it to a list, and so is
every `/tag/<slug>` the Nav prints. A path the table names none of is not a
public document and falls through to the asset layer, which has no page to serve
for it. One case is answered inside the Worker rather than by the asset layer: a
`/tag/<slug>` whose slug names no Tag gets a `404` status from the Worker rather
than the template, because serving the home page at a URL the Nav does not link to
is a page the site does not have.

`foldkit({ ssr: { serverEntry } })` is gone, and with it `src/entry.server.ts`
and the `readFrontOverHttp` read it needed. A foldkit server entry takes only a
`Request`, so it cannot reach `env.DB` — that read existed over HTTP _only_
because the entry believed it was the host that had no bindings.
`@foldkit/vite-plugin` still runs, for the build id, view identity and the
DevTools overlay.

## One data-access style

The website Worker is the only place that could have reached for a binding
directly: its sitemap handler ran a hand-written
`env.DB.prepare('SELECT takenAt FROM photos …')`. It no longer does. It builds
the same stack the API Worker builds, from the same bindings, through the same
`Gateway`:

```
GatewayLive({ db: env.DB, photos: env.PHOTOS })
  → PublicPhotoServiceLive
    → Effect runtime
      → worker.ts (the home page, the sitemap)
```

`packages/web/src/lib/public-site.ts` owns the website Worker's side of that
stack and is the only module that names a binding. A direct `env.DB.prepare` is
not a third style to be extended; it is deleted.

The decisive cost was testability. `pnpm dev` cannot run in CI, so a
hand-written SQL seam in `worker.ts` is the one piece of a read path no test can
reach. Everything behind a Layer is exercised against real SQLite through
ADR 0005's harness.

**Two read models, one Photo.** `PublicPhotoService`
(`packages/api/src/public-photo.ts`) sits beside `PhotoService` rather than
inside it, because the two answer for different audiences: `PhotoService` is the
Admin's and deliberately sees Drafts, failed uploads and the Trash, while every
`PublicPhotoService` method filters to `published` and non-Trashed _inside
itself_, so no caller can forget. They share the `Gateway`, the `PHOTO_COLUMNS`
list, the tag loader and the row decoder, so they cannot disagree about what a
Photo is.

**Grouping and counting stay in SQL.** `takenAt` is `YYYY-MM-DD` TEXT, so
`substr(takenAt, 1, 7)` groups published Photos into the home page's Timeline
Months and the collation orders those months; the frame count and number
range are `COUNT`/`MIN`/`MAX` over the same set. Dragging every published row
into the isolate to group it in JavaScript would put a whole table through the
line on every request.

## Consequences

- The home page is rendered from the real D1 and R2 bindings in development, so the
  page a developer sees is the page that deploys. There is no dev-only renderer
  to drift from the deployed one — the two renderers in the earlier draft were
  why the bug was invisible from the code, because both read as the live path.
- The photographs are in the HTML the reader receives, so there is no request to
  await before first paint and no second copy of the read.
- A failed read is not a failed page. The home page renders the copy that says
  there is nothing here yet, and the sitemap's `lastmod` is left out rather
  than failing the route: a sitemap without `lastmod` is valid, and one that
  500s tells a crawler the site is broken over a date it does not need.
- The sitemap's `lastmod` is `MAX(takenAt)` over **published, non-trashed**
  Photos, so a trashed photograph stops dating the sitemap.
- API URLs are root-relative paths in every stage (the dev server proxies `/api`
  to the API Worker). They must not depend on a `window` probe: the Worker
  renders the home page's photo URLs and has no `window`, so a browser-only
  origin stamped `/api/image/…` into the HTML and the client asked for the dev
  port, which foldkit reports as a server DOM that did not match the first
  client view and rebuilds.
- `curl /` is the check that caught all of this, and it is in the
  `verify-photo` skill's doctor: a dev page with no `data-foldkit-app` is a
  refused handoff, not a slow build.
