import { Effect } from 'effect'
import * as Server from 'foldkit/experimental/server'
import type { WebsiteEnv } from '../../../alchemy.run'
import { isAdminPath } from './admin/route'
import { Model as HomeModel } from './home/model'
import { init as homeInit } from './home/update'
import { view as homeView } from './home/view'

type WorkerEnvWithAssets = WebsiteEnv & {
  ASSETS: { fetch: typeof fetch }
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- import.meta.env is Vite-injected, probe without tightening type
const BUILD_ID = (() => {
  const viteEnv: unknown = import.meta.env
  if (typeof viteEnv === 'object' && viteEnv !== null && 'FOLDKIT_BUILD_ID' in viteEnv) {
    const id: unknown = viteEnv['FOLDKIT_BUILD_ID']
    if (typeof id === 'string' && id !== '') return id
  }
  return 'development'
})()

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
    init: homeInit,
    view: homeView,
  }
  let rendered: Server.RenderedApplication | null = null
  try {
    rendered = await Effect.runPromise(
      Server.renderToString(homeConfig, {
        buildId: BUILD_ID,
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

const escapeXml = (input: string): string =>
  input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const renderSitemap = async (env: WorkerEnvWithAssets): Promise<Response> => {
  let lastmod = ''
  try {
    const raw = await env.DB.prepare(
      `SELECT takenAt FROM photos ORDER BY takenAt DESC LIMIT 1`,
    ).all<{
      takenAt: string | null
    }>()
    const latest = raw.results?.[0]?.takenAt
    if (typeof latest === 'string' && latest !== '') lastmod = latest.slice(0, 10)
  } catch {
    lastmod = ''
  }
  const url = 'https://photo.elianiva.com/'
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url><loc>${url}</loc>${lastmod !== '' ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ''}</url>\n` +
    `</urlset>\n`
  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
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
  // that names none.
  if (isAdminPath(url.pathname)) {
    if (request.method === 'GET') {
      return env.ASSETS.fetch(new Request(new URL('/index.html', request.url).toString()))
    }
    return new Response('Not found', { status: 404 })
  }

  if (isAssetPath(url.pathname)) {
    const asset = await env.ASSETS.fetch(request)
    if (asset.status !== 404) return asset
  }
  return new Response('Not found', { status: 404 })
}
