import { Context, Effect, Layer } from 'effect'
import { Headers, HttpRouter, HttpServerResponse } from 'effect/http'
import * as Server from 'foldkit/experimental/server'
import type { WebsiteEnv } from '../../../alchemy.run'
import { timelineOf, EMPTY_TIMELINE, EMPTY_TAG_PAGE, figuresOf, tagPageOf } from './public/content'
import { Flags, Model as PublicModel } from './public/model'
import type { PublicLocation } from './public/route'
import { init as publicInit } from './public/update'
import { view as publicView } from './public/view'
import { readAbout, readNav, readHome, readTag, renderSitemap } from './lib/public-site'
import { WorkerLoggerLive } from './lib/logger'
import { themeDocument, themeForUrl } from './lib/theme'

type WorkerEnvWithAssets = WebsiteEnv & {
  ASSETS: { fetch: typeof fetch }
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'x-frame-options': 'DENY',
} as const

/**
 * The incoming web `Request`, as a service.
 *
 * `HttpServerRequest` is what the router matches on, and it is the right model
 * for that — but the asset binding, the SSR renderer and `renderSitemap` all
 * take the platform's `Request`, and rebuilding one per route would mean
 * reimplementing the body and headers it already holds. It is provided into the
 * request that came from it, which is why the app is built per request.
 */
class WebRequest extends Context.Service<WebRequest, Request>()('photo/PageWebRequest') {}

/**
 * The id this deployment stamps on the page it renders, and the id the client
 * carries. `@foldkit/vite-plugin` compiles the same value into both artifacts
 * from the `buildId` option in `vite.config.ts`, and `Runtime.hydrate` refuses
 * a page whose two ids differ.
 *
 * Read as the member expression rather than by probing the `import.meta.env`
 * object: a build-time define replaces the expression, and an object probe
 * misses it and answers a constant no client carries, which reads as a
 * deployment skew on every page.
 */
const BUILD_ID = import.meta.env.FOLDKIT_BUILD_ID

const FALLBACK_TEMPLATE =
  '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta name="description" content="Photography by elianiva — curated works." /><title>photo.elianiva.com — Photography</title></head><body><div id="root"></div><script type="module" src="/src/entry.ts"></script></body></html>'

const fetchTemplate = async (
  env: WorkerEnvWithAssets,
  request: Request,
): Promise<string | null> => {
  for (const path of ['/index.html', '/']) {
    try {
      const res = await env.ASSETS.fetch(new Request(new URL(path, request.url).toString()))
      if (res.ok) {
        const text = await res.text()
        if (text.includes('<div id="root"')) return text
      }
    } catch {
      void 0
      continue
    }
  }
  return FALLBACK_TEMPLATE
}

/** The public site's render, per document. One config, because the home page, the
 *  About page and a Tag page are three routes of one app rather than three
 *  apps: the Model carries the route, and the Worker hands each one the read
 *  its view draws. */
const publicConfig = {
  Model: PublicModel,
  Flags,
  init: publicInit,
  view: publicView,
}

/** The read each document is rendered from, before the render. The Nav is
 *  read for every document — it is the Header's, and the Header is the
 *  chrome all three share — so the two reads that are not the Nav's run
 *  beside it rather than after it.
 *
 *  A Tag page whose slug names no Tag is null: the site has no `404` document
 *  of its own yet (ADR 0006), so the Worker answers that URL with a 404 status
 *  rather than with the home page. */
const readFor = async (
  env: WorkerEnvWithAssets,
  location: PublicLocation,
): Promise<Flags | null> => {
  const nav = await readNav(env)
  if (location.route === 'tag') {
    const read = await readTag(env, location.tagSlug)
    return read === null
      ? null
      : {
          route: 'tag',
          timeline: EMPTY_TIMELINE,
          nextMonthCursor: null,
          figures: [],
          tag: tagPageOf(read),
          nav,
        }
  }
  if (location.route === 'about') {
    return {
      route: 'about',
      timeline: EMPTY_TIMELINE,
      nextMonthCursor: null,
      figures: figuresOf(await readAbout(env)),
      tag: EMPTY_TAG_PAGE,
      nav,
    }
  }
  const home = await readHome(env)
  return {
    route: 'home',
    timeline: timelineOf(home),
    nextMonthCursor: home.nextMonthCursor,
    figures: [],
    tag: EMPTY_TAG_PAGE,
    nav,
  }
}

const renderPublicSsr = async (
  env: WorkerEnvWithAssets,
  request: Request,
  location: PublicLocation,
): Promise<Response | 'not-found' | null> => {
  const template = await fetchTemplate(env, request)
  if (template === null) return null
  let rendered: Server.RenderedApplication | null = null
  try {
    // The photographs are read here, before the render, and handed to `init` as
    // Flags. `init` is synchronous, so this is the only place a read can happen
    // — and doing it here is what puts the photographs in the HTML the reader
    // receives rather than behind a request they watch the page make. The
    // Fields are the whole Flags struct: the other documents' reads are the
    // empty ones, and `init` drops them.
    const flags = await readFor(env, location)
    // A Tag page's slug naming no Tag is the one answer here that is not a
    // fault: the URL is a real path and there is no document at it.
    if (flags === null) return 'not-found'
    rendered = await Effect.runPromise(
      Server.renderToString(publicConfig, { buildId: BUILD_ID, flags }).pipe(
        Effect.provide(WorkerLoggerLive),
      ),
    )
  } catch {
    return null
  }
  if (rendered === null) return null
  try {
    return Server.toResponse(template, Server.Rendered(rendered))
  } catch {
    return null
  }
}

/** Asset-like paths served from static storage (hashed bundles, fonts, robots). */
const isAssetPath = (pathname: string): boolean =>
  pathname.startsWith('/assets/') ||
  pathname.startsWith('/@vite/') ||
  pathname.startsWith('/src/') ||
  pathname === '/robots.txt' ||
  pathname === '/favicon.ico' ||
  /\/[^/]+\.[a-z0-9]+$/i.test(pathname)

/**
 * Security headers on every answer, including the 404 and the redirect.
 *
 * Middleware rather than a wrapper around the final `Response`, so an answer
 * that never reaches a route — the catch-all 404 — carries them too. The
 * hand-written dispatcher applied these to whatever came back; this is the
 * router's way of making the same promise.
 */
const securityLayer = HttpRouter.middleware(
  (httpEffect) =>
    Effect.map(
      httpEffect,
      HttpServerResponse.setHeaders(Headers.fromRecordUnsafe(SECURITY_HEADERS)),
    ),
  { global: true },
)

/** The client template under its old spelling. It is a built asset, so the asset
 *  layer would answer it with the unfilled `#root` — a document the home page's
 *  `Runtime.hydrate` refuses. The canonical URL is `/`, so this says so instead
 *  of serving a page that cannot boot (ADR 0004). */
const canonicalRoute = HttpRouter.add('*', '/index.html', () =>
  Effect.service(WebRequest).pipe(
    Effect.map((request) => {
      const canonical = new URL(request.url)
      canonical.pathname = '/'
      return HttpServerResponse.redirect(canonical, { status: 308 })
    }),
  ),
)

/** Sitemap: the crawler route (robots.txt points here). `renderSitemap` already
 *  answers a `Response` with its own content type, so the route only has to
 *  carry the span. */
const sitemapRoute = (env: WorkerEnvWithAssets) =>
  HttpRouter.add('GET', '/sitemap.xml', () =>
    Effect.map(Effect.provide(renderSitemap(env), WorkerLoggerLive), HttpServerResponse.fromWeb),
  )

/** The asset binding, as a service. It is a `fetch`, so the route handlers
 *  cannot close over the one in `env` without threading it through each of
 *  them. */
class Assets extends Context.Service<Assets, WorkerEnvWithAssets['ASSETS']>()('photo/PageAssets') {}

/**
 * A public document rendered by SSR, as an `HttpServerResponse`.
 *
 * `null` from the render is this Worker's fault, not the reader's — the template
 * would not boot, or the render threw — so it answers `500` rather than falling
 * through to the asset layer, which would serve a page that cannot run.
 */
const ssrResponse = (env: WorkerEnvWithAssets, location: PublicLocation) =>
  Effect.gen(function* () {
    const request = yield* Effect.service(WebRequest)
    const rendered = yield* Effect.promise(() => renderPublicSsr(env, request, location))
    // Three answers, and each is a different party's fault: the document names a
    // Tag that is not there, or the photo behind it is gone; the template would
    // not boot or the render threw; or it rendered.
    if (rendered === 'not-found') {
      return HttpServerResponse.text('Not found', { status: 404 })
    }
    if (rendered === null) {
      return HttpServerResponse.text('Internal error', { status: 500 })
    }
    return HttpServerResponse.fromWeb(rendered)
  })

/** The home page, the About page, and a Tag's page — the three the route table names.
 *
 * `/tag/:slug` is a path parameter rather than the table's regex, and the slug
 * arrives already decoded by the matcher. A slug containing a slash cannot reach
 * the handler at all, which is a stronger answer than matching and refusing.
 */
const publicRoutes = (env: WorkerEnvWithAssets) =>
  Layer.mergeAll(
    HttpRouter.add('GET', '/', () => ssrResponse(env, { route: 'home' })),
    HttpRouter.add('GET', '/about', () => ssrResponse(env, { route: 'about' })),
    HttpRouter.add('GET', '/tag/:slug', () =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params
        const tagSlug = params.slug
        if (tagSlug === undefined) {
          return HttpServerResponse.text('Not found', { status: 404 })
        }
        return yield* ssrResponse(env, { route: 'tag', tagSlug })
      }),
    ),
  )

/** The Admin's URL space: the SPA shell for every path in it, so a deep route
 *  boots the app. The client parses the route and draws NotFound for a path that
 *  names none. The shell is the same `index.html` the home page gets, with one
 *  difference: the theme branch is named on `<html>`, because the Editor is dark
 *  and the first paint happens before any of this app has run. This Worker is
 *  the page host in development too — the Cloudflare Vite plugin backs the `ssr`
 *  environment with workerd, so `@foldkit/vite-plugin` stands its own dev
 *  middleware down and hands page requests here (ADR 0004). */
const adminRoute = HttpRouter.add('*', '/admin/*', () =>
  Effect.gen(function* () {
    const request = yield* Effect.service(WebRequest)
    const assets = yield* Assets
    const shell = yield* Effect.promise(() =>
      assets.fetch(new Request(new URL('/index.html', request.url).toString())),
    )
    if (!shell.ok) return HttpServerResponse.text('Not found', { status: 404 })
    return HttpServerResponse.text(
      themeDocument(yield* Effect.promise(() => shell.text()), themeForUrl(request.url)),
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  }),
)

/** Everything else: the asset binding, and a 404 when it has nothing. */
const assetRoute = HttpRouter.add('*', '/*', () =>
  Effect.gen(function* () {
    const request = yield* Effect.service(WebRequest)
    if (isAssetPath(new URL(request.url).pathname)) {
      const assets = yield* Assets
      const asset = yield* Effect.promise(() => assets.fetch(request))
      if (asset.status !== 404) return HttpServerResponse.fromWeb(asset)
    }
    return HttpServerResponse.text('Not found', { status: 404 })
  }),
)

/**
 * Every route, and the one layer the whole app needs.
 *
 * The order is the routing table: the specific documents, the crawler's sitemap,
 * the Admin's URL space, and a catch-all that asks the asset binding and 404s
 * when it has nothing. Registered in that order because the catch-all is a
 * wildcard and would otherwise answer for all of them.
 */
const appLayer = (env: WorkerEnvWithAssets) =>
  Layer.mergeAll(
    publicRoutes(env),
    sitemapRoute(env),
    canonicalRoute,
    adminRoute,
    assetRoute,
    securityLayer,
  ).pipe(Layer.provideMerge(HttpRouter.layer), Layer.provideMerge(WorkerLoggerLive))

/**
 * The router, wired to one set of bindings.
 *
 * Built per request for the same reason the API Worker's is: the bindings are an
 * argument of `fetch` and the route handlers close over them, and Effect's
 * `Context.Reference` memoises its default process-wide on first read, so a
 * module-scoped layer could not see a second Worker's `env`.
 *
 * `ignoreTrailingSlash` is load-bearing rather than cosmetic. The route table
 * says a trailing slash names the same document — `/about/` and `/about` are
 * one path, and the root is the one path a slash may not be stripped from — and
 * the hand-written chain did that normalisation itself, for the public routes
 * only. The router does it for every route.
 */
const handlerFor = (env: WorkerEnvWithAssets, request: Request) =>
  HttpRouter.toWebHandler(
    HttpRouter.provideRequest(
      Layer.mergeAll(Layer.succeed(Assets, env.ASSETS), Layer.succeed(WebRequest, request)),
    )(appLayer(env)),
    { disableLogger: true, routerConfig: { ignoreTrailingSlash: true } },
  ).handler

export default {
  fetch(request: Request, env: WorkerEnvWithAssets, _ctx: unknown): Promise<Response> {
    return handlerFor(env, request)(request)
  },
}
