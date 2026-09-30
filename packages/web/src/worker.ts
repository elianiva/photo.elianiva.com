import { Effect } from 'effect'
import * as Server from 'foldkit/experimental/server'
import type { WebsiteEnv } from '../../../alchemy.run'
import { isAdminPath } from './admin/route'
import { editionOf } from './home/content'
import { Flags, Model as HomeModel } from './home/model'
import { init as homeInit } from './home/update'
import { view as homeView } from './home/view'
import { readFront, renderSitemap } from './lib/public-site'
import { themeDocument, themeForUrl } from './lib/theme'

type WorkerEnvWithAssets = WebsiteEnv & {
  ASSETS: { fetch: typeof fetch }
}

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

const renderHomeSsr = async (
  env: WorkerEnvWithAssets,
  request: Request,
): Promise<Response | null> => {
  const template = await fetchTemplate(env, request)
  if (template === null) return null
  const homeConfig = {
    Model: HomeModel,
    Flags,
    init: homeInit,
    view: homeView,
  }
  let rendered: Server.RenderedApplication | null = null
  try {
    // The Edition is read here, before the render, and handed to `init` as
    // Flags. `init` is synchronous, so this is the only place a read can happen
    // — and doing it here is what puts the photographs in the HTML the reader
    // receives rather than behind a request they watch the page make.
    const read = await readFront(env)
    rendered = await Effect.runPromise(
      Server.renderToString(homeConfig, {
        buildId: BUILD_ID,
        flags: { edition: editionOf(read), nextSectionCursor: read.nextSectionCursor },
      }),
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

const withSecurityHeaders = (response: Response): Response => {
  const out = new Response(response.body, response)
  out.headers.set('x-content-type-options', 'nosniff')
  out.headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  out.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()')
  out.headers.set('x-frame-options', 'DENY')
  return out
}

export default {
  fetch(request: Request, env: WorkerEnvWithAssets, _ctx: unknown): Promise<Response> {
    return main(request, env).then(withSecurityHeaders)
  },
}

/** Asset-like paths served from static storage (hashed bundles, fonts, robots). */
const isAssetPath = (pathname: string): boolean =>
  pathname.startsWith('/assets/') ||
  pathname.startsWith('/@vite/') ||
  pathname.startsWith('/src/') ||
  pathname === '/robots.txt' ||
  pathname === '/favicon.ico' ||
  /\/[^/]+\.[a-z0-9]+$/i.test(pathname)

const main = async (request: Request, env: WorkerEnvWithAssets): Promise<Response> => {
  const url = new URL(request.url)

  // The client template under its old spelling. It is a built asset, so the
  // asset layer would answer it with the unfilled `#root` — a document the
  // front page's `Runtime.hydrate` refuses. The canonical URL is `/`, so this
  // says so instead of serving a page that cannot boot (ADR 0004).
  if (url.pathname === '/index.html') {
    const canonical = new URL(url)
    canonical.pathname = '/'
    return Response.redirect(canonical, 308)
  }

  // Public front page: SSR per the foldkit server-rendering contract.
  if ((url.pathname === '/' || url.pathname === '') && request.method === 'GET') {
    const ssr = await renderHomeSsr(env, request)
    if (ssr !== null) return ssr
    return new Response('Not found', { status: 500 })
  }

  // Sitemap: the only crawler route besides `/` (robots.txt points here).
  if (url.pathname === '/sitemap.xml' && request.method === 'GET') {
    return renderSitemap(env)
  }

  // Admin: SPA shell for every path in the Admin's URL space, so a deep route
  // boots the app. The client parses the route and draws NotFound for a path
  // that names none. The shell is the same `index.html` the Front gets, with
  // one difference: the theme branch is named on `<html>`, because the Editor
  // is dark and the first paint happens before any of this app has run. This
  // Worker is the page host in development too — the Cloudflare Vite plugin
  // backs the `ssr` environment with workerd, so `@foldkit/vite-plugin` stands
  // its own dev middleware down and hands page requests here (ADR 0004).
  if (isAdminPath(url.pathname)) {
    if (request.method === 'GET') {
      const shell = await env.ASSETS.fetch(
        new Request(new URL('/index.html', request.url).toString()),
      )
      if (!shell.ok) return new Response('Not found', { status: 404 })
      const headers = new Headers(shell.headers)
      headers.set('content-type', 'text/html; charset=utf-8')
      return new Response(themeDocument(await shell.text(), themeForUrl(request.url)), { headers })
    }
    return new Response('Not found', { status: 404 })
  }

  if (isAssetPath(url.pathname)) {
    const asset = await env.ASSETS.fetch(request)
    if (asset.status !== 404) return asset
  }
  return new Response('Not found', { status: 404 })
}
