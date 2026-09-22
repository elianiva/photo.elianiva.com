import { Effect, Layer } from 'effect'
import * as Server from 'foldkit/experimental/server'
import type { WebsiteEnv } from '../../../alchemy.run'
import { Flags as GalleryFlags, Model as GalleryModel } from './gallery/model'
import { init as galleryInit } from './gallery/update'
import { view as galleryView } from './gallery/view'
import { GatewayLive, PhotoService, PhotoServiceLive } from '@photo/api'

type WorkerEnvWithAssets = WebsiteEnv & {
  ASSETS: { fetch: typeof fetch }
}

const gatewayLayer = (env: WorkerEnvWithAssets) => {
  if (env.DB === undefined || env.DB === null || env.PHOTOS === undefined || env.PHOTOS === null) {
    throw new Error('missing D1 or R2 binding')
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return GatewayLive({ db: env.DB as never, photos: env.PHOTOS as never })
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- import.meta.env is Vite-injected, probe without tightening type
const BUILD_ID =
  ((import.meta.env as unknown as Record<string, unknown>)['FOLDKIT_BUILD_ID'] as
    | string
    | undefined) ?? 'development'

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

const renderGallerySsr = async (
  env: WorkerEnvWithAssets,
  request: Request,
): Promise<Response | null> => {
  const template = await fetchTemplate(env, request)
  if (template === null) return null
  const flags = await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* PhotoService
      const page = yield* service.list({ limit: 60 })
      return { photos: [...page.items], nextCursor: page.nextCursor }
    }).pipe(
      Effect.provide(PhotoServiceLive.pipe(Layer.provide(gatewayLayer(env)))),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- Flags nextCursor is string|null, narrow from Effect error fallback
      Effect.catch(() =>
        Effect.succeed({ photos: [], nextCursor: null as unknown as string | null }),
      ),
    ),
  )
  const galleryConfig = {
    Model: GalleryModel,
    Flags: GalleryFlags,
    init: galleryInit,
    view: galleryView,
  }
  let rendered: Server.RenderedApplication | null = null
  try {
    rendered = await Effect.runPromise(
      Server.renderToString(galleryConfig, {
        flags,
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
  input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const renderSitemap = async (env: WorkerEnvWithAssets): Promise<Response> => {
  let lastmod = ''
  try {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const db = env.DB as never as {
      prepare(q: string): { all<T>(): Promise<{ results?: ReadonlyArray<T> }> }
    }
    const raw = await db
      .prepare(`SELECT takenAt FROM photos ORDER BY takenAt DESC LIMIT 1`)
      .all<{ takenAt: string | null }>()
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

  // Public gallery: SSR per the foldkit server-rendering contract.
  if ((url.pathname === '/' || url.pathname === '') && request.method === 'GET') {
    const ssr = await renderGallerySsr(env, request)
    if (ssr !== null) return ssr
    return new Response('Not found', { status: 500 })
  }

  // Sitemap: the only crawler route besides `/` (robots.txt points here).
  if (url.pathname === '/sitemap.xml' && request.method === 'GET') {
    return renderSitemap(env)
  }

  // Admin: SPA shell only. The client entry boots a fresh app (no SSR stamp).
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
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
