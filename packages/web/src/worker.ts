import { Effect, Layer } from 'effect'
import * as Server from 'foldkit/experimental/server'
import type { WebsiteEnv } from '../../../alchemy.run'
import { Flags as GalleryFlags, Model as GalleryModel } from './gallery/model'
import { init as galleryInit } from './gallery/update'
import { view as galleryView } from './gallery/view'
import { Model as AdminModel, init as adminInit, view as adminView } from './admin/entry'
import { GatewayLive, PhotoService, PhotoServiceLive } from '@photo/api'

type WorkerEnvWithAssets = WebsiteEnv & {
  ASSETS: { fetch: typeof fetch }
}

const gatewayLayer = (env: WorkerEnvWithAssets) =>
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  GatewayLive({ db: env.DB as never, photos: env.PHOTOS as never })

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

const renderAdminSsr = async (
  env: WorkerEnvWithAssets,
  request: Request,
): Promise<Response | null> => {
  const template = await fetchTemplate(env, request)
  if (template === null) return null
  const config = {
    Model: AdminModel,
    init: adminInit,
    view: adminView,
  }
  let renderedAdmin: Server.RenderedApplication | null = null
  try {
    renderedAdmin = await Effect.runPromise(
      Server.renderToString(config, {
        buildId: BUILD_ID,
      }),
    )
  } catch {
    return null
  }
  if (renderedAdmin === null) return null
  try {
    return Server.toResponse(template, Server.Rendered(renderedAdmin))
  } catch {
    return null
  }
}

export default {
  fetch(request: Request, env: WorkerEnvWithAssets, _ctx: unknown): Promise<Response> {
    return main(request, env)
  },
}

const main = async (request: Request, env: WorkerEnvWithAssets): Promise<Response> => {
  const url = new URL(request.url)

  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
    if (request.method === 'GET') {
      const ssr = await renderAdminSsr(env, request)
      if (ssr !== null) return ssr
      return env.ASSETS.fetch(new Request(new URL('/index.html', request.url).toString()))
    }
  }
  if ((url.pathname === '/' || url.pathname === '') && request.method === 'GET') {
    const ssr = await renderGallerySsr(env, request)
    if (ssr !== null) return ssr
  }

  if (env.ASSETS) return env.ASSETS.fetch(request)
  return new Response('Not found', { status: 404 })
}
