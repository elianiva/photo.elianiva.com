# The website Worker is the page host, and its paths run before the asset layer

## Status

Accepted

## Context

#38 made the Front a server-rendered page again: `worker.ts` renders it with
`Server.renderToString`, injects the result into the client template, and the
client entry calls `Runtime.hydrate`. Loading `/` on the dev server produced

```
[foldkit] Runtime.hydrate could not find a server-rendered root stamped with
`data-foldkit-app`. Use Runtime.run for a fresh client boot.
```

— the error ADR 0002 recorded when the site was still a client-only SPA, back
in a new place. Two arrangements were believed to be in charge of the same
request, and the one that was not charged the page won it:

- **The dev server entry.** `foldkit({ ssr: { serverEntry } })` makes
  `@foldkit/vite-plugin` own HTML navigations in development. It stands that
  middleware down when the `ssr` environment is not runnable, and the Cloudflare
  Vite plugin backs `ssr` with workerd, so `src/entry.server.ts` never ran. A
  request that only the middleware could have answered proved it: `GET /nope`
  with `Accept: text/html` is a 404 from the Worker, not a rendered Front from
  the entry.
- **The asset layer.** The Worker is the page host, but Cloudflare serves a
  matching asset _before_ the Worker, and `dist/client/index.html` is a
  matching asset. So `GET /` was answered with the client template: an empty
  `<div id="root">`, no `data-foldkit-app` stamp, no Flags payload. The client's
  `Runtime.hydrate` read the missing stamp as a refused handoff, stopped before
  `init`, and contained the document behind the refusal shield.

The second one was the live bug in both stages, not development only: the
deployed asset layer resolves `/` to the same `index.html`.

## Decision

One page host, the website Worker, in development and in production. It
renders the Front, serves the Admin shell, answers the sitemap and the API
misses, and reads the client template through the `ASSETS` binding to fill it.

Its page paths are worker-first, which is what `assets.runWorkerFirst` in
`alchemy.run.ts` is for: `['/', '/index.html', '/admin', '/admin/*']` ahead of
`notFoundHandling: 'none'`. Everything else keeps the asset layer's
assets-first order, so a hashed bundle, a font and a Vite module are still
served without entering the Worker.

`/index.html` is in that list and answers with a redirect to `/`. It is the
Front's own URL under its old spelling, and the one thing the asset layer can
serve for a page is a template no client can boot.

`foldkit({ ssr: { serverEntry } })` is gone, and with it `src/entry.server.ts`
and the `readFrontOverHttp` read it needed. A foldkit server entry takes only a
`Request`, so it cannot reach `env.DB`; the read it performed over HTTP to the
API Worker's port existed only because the entry believed it was the host that
had no bindings. `@foldkit/vite-plugin` still runs, for the build id, view
identity and the DevTools overlay.

## Consequences

- The Front is rendered from the real D1 and R2 bindings in development, so the
  page a developer sees is the page that deploys. The dev HTTP hop to the API
  Worker is gone with the second read path.
- A dev-only server entry cannot drift from the deployed one, because there is
  no dev-only one. The two renderers in ADR 0002 and ADR 0010's plan were the
  reason the bug was invisible from the code: both read as the live path.
- Static assets cost one Worker invocation only where the Worker renders pages.
  The paths that do not render anything keep the platform's own asset path.
- A page path added later is a Worker-first path too, or the asset layer
  answers it with the template. `index.html` is the reason that is a rule here
  rather than a habit.
- `curl /` is the check that caught it, and it is in the `verify-photo` skill's
  doctor: a dev page with no `data-foldkit-app` is a refused handoff, not a
  slow build.
