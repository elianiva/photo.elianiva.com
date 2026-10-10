/**
 * Where the API lives, in every stage, and what it is called.
 *
 * The API is a Worker of its own (`src/api-worker.ts`), but in production it
 * answers on the *site's* hostname behind a route rather than a second
 * hostname. That is the whole reason the Admin can log in at all, so it is
 * worth stating plainly:
 *
 * Cloudflare Access issues an **application token per Access application**, and
 * gates a request before the Worker ever runs. With the API on a hostname of
 * its own the Admin's reads were cross-origin, which failed twice over: the
 * browser's preflight `OPTIONS` never carried the `CF_Authorization` cookie
 * (a browser sends no cookies on a preflight, by design) so Cloudflare
 * answered it with a bare 403 and no CORS headers; and the real request that
 * followed 302-redirected to an interactive login that `fetch` cannot complete.
 * Same-origin removes both: no preflight to fail, and one cookie for the one
 * hostname the Admin is already on.
 *
 * Local development is the one stage that is still cross-origin, because the
 * site's Vite dev server and the API Worker get a fixed port each
 * (`dev.port` in `alchemy.run.ts`). That is what `apiOrigin` is for, and it is
 * why CORS survives in `api-worker.ts` — narrowed to the dev pair alone.
 */

/** In dev, the API Worker's own port. Everywhere else the API is this origin. */
const devApiOrigin = 'http://localhost:13371'

/**
 * The API's origin: the dev port in the dev stage, empty everywhere else (so
 * every URL below is a same-origin path on the deployed site).
 *
 * `import.meta.env.DEV` and not a `window` probe, because a server-rendered
 * view has to print the same URL the browser will. The website Worker renders
 * the home page's photos, and it has no `window`: a probe that answered the dev
 * port in the browser and `''` in the Worker stamped `/api/image/…` into the
 * HTML and asked the browser for
 * `http://localhost:13371/api/image/…`, which foldkit reports as a server DOM
 * that did not match the first client view and rebuilds (ADR 0004). Both stages
 * of a build agree on `DEV`, and the dev port is a property of the dev stage
 * rather than of the browser that happens to be on localhost.
 */
export const apiOrigin = (): string => (import.meta.env.DEV ? devApiOrigin : '')

/**
 * The empty string above is a *relative* base, and something downstream has to
 * be able to resolve it — worth knowing because the failure is not local.
 *
 * Effect's HTTP client turns a request's url into a `URL` with
 * `new URL(url, baseUrl())`, where `baseUrl` is `location.origin +
 * location.pathname` in a browser. A root-relative `/api/...` ignores the
 * base's path, so it lands on the site's own origin exactly as intended, in the
 * browser and in the Worker that server-renders it. Off the browser `baseUrl` is
 * `undefined` and a relative url throws `Invalid URL` — so a test that reaches
 * `rpcAdmin` without a DOM fails with a URL error rather than anything about
 * the request. Drive the Worker directly, as `access.test.ts` does.
 */

/**
 * Every path the API Worker answers, in one table. `api-worker.ts` matches
 * against these and the browser builds its URLs from them, so a route cannot
 * exist on one side only. All of them sit under the `API_PREFIX` the Worker
 * route claims, which is what keeps them off the website Worker's paths.
 */
export const API_PREFIX = '/api'

/** Public reads: published, non-trashed Photos. Ungated by design. */
export const RPC_PATH = `${API_PREFIX}/rpc`

/** Every read and write the Admin needs, including Drafts and the Trash. */
export const ADMIN_RPC_PATH = `${API_PREFIX}/admin/rpc`

/** The multipart JPEG upload. Edge-gated, and nothing else writes to R2. */
export const UPLOAD_PATH = `${API_PREFIX}/upload`

/** The R2 proxy that serves an original's bytes. Public, so the front can load a photo. */
export const IMAGE_PATH = `${API_PREFIX}/image`

/** Liveness, including a real D1 round trip. */
export const HEALTH_PATH = `${API_PREFIX}/health`

export const apiUrl = (path: string): string => `${apiOrigin()}${path}`
