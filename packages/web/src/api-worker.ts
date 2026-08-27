import { Effect, Layer } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc'
import type { WebsiteEnv } from '../../../alchemy.run'
import {
  AdminRpcHandlersLive,
  extractImageMeta,
  GatewayLive,
  PhotoService,
  PhotoServiceLive,
  PublicRpcHandlersLive,
  TagServiceLive,
} from '@photo/api'
import { PhotoAdminRpcs, PhotoPublicRpcs } from '@photo/shared'
import { verifyAccessToken } from './access'

type ApiEnv = WebsiteEnv

const slugify = (input: string): string =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled'

const extFromName = (name: string): string => {
  const parts = name.split('.')
  const ext = parts.length > 1 ? parts[parts.length - 1]!.toLowerCase() : 'jpg'
  if (['jpg', 'jpeg', 'webp', 'png', 'avif', 'heic', 'heif'].includes(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext
  }
  return 'jpg'
}

const jsonResponse = (data: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const BLURHASH_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~'

const parseBlurhash = (raw: FormDataEntryValue | null): string | undefined => {
  if (typeof raw !== 'string') return undefined
  const hash = raw.trim()
  if (hash.length < 6 || hash.length > 64) return undefined
  for (const char of hash) {
    if (!BLURHASH_ALPHABET.includes(char)) return undefined
  }
  return hash
}

const parseMetadataObject = (raw: FormDataEntryValue | null): Record<string, unknown> => {
  if (typeof raw !== 'string' || raw === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const handleUpload = (env: ApiEnv, request: Request): Promise<Response> => {
  const program = Effect.gen(function* () {
    const form: FormData = yield* Effect.tryPromise({
      try: () => request.formData(),
      catch: () => new Error('invalid multipart form'),
    })
    const file = form.get('file')
    const titleRaw = form.get('title')
    if (!(file instanceof File) || typeof titleRaw !== 'string' || titleRaw.trim() === '') {
      return jsonResponse({ message: 'file and title are required' }, { status: 400 })
    }
    const takenAtRaw = form.get('takenAt')
    const tagIdsRaw = form.get('tagIds')
    let tagIds: ReadonlyArray<string> = []
    if (typeof tagIdsRaw === 'string' && tagIdsRaw.trim() !== '') {
      try {
        const parsed: unknown = JSON.parse(tagIdsRaw)
        if (Array.isArray(parsed)) tagIds = parsed.filter((v): v is string => typeof v === 'string')
      } catch {
        tagIds = []
      }
    }

    const bytes: ArrayBuffer = yield* Effect.tryPromise({
      try: () => file.arrayBuffer(),
      catch: () => new Error('failed to read upload'),
    })

    const meta = yield* extractImageMeta(bytes).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (meta === undefined) {
      return jsonResponse({ message: 'not a readable image' }, { status: 400 })
    }

    const userMeta = parseMetadataObject(form.get('metadata'))
    const mergedMetadata: Record<string, unknown> = {}
    for (const [key, value] of Object.entries({
      caption: userMeta['caption'],
      location: userMeta['location'],
      camera: userMeta['camera'] ?? meta.camera,
      lens: userMeta['lens'] ?? meta.lens,
    })) {
      if (typeof value === 'string' && value.trim() !== '') mergedMetadata[key] = value.trim()
    }

    const id = crypto.randomUUID()
    const slugField = form.get('slug')
    const slug = slugify(
      typeof slugField === 'string' && slugField.trim() !== '' ? slugField : titleRaw,
    )
    const r2Key = `originals/${id}-${slug}.${extFromName(file.name || 'photo.jpg')}`

    const created = yield* PhotoService.use((service) =>
      service.create({
        slug,
        title: titleRaw.trim(),
        r2Key,
        width: meta.width,
        height: meta.height,
        takenAt:
          typeof takenAtRaw === 'string' && takenAtRaw.trim() !== ''
            ? takenAtRaw.trim()
            : meta.takenAt,
        metadata: JSON.stringify(mergedMetadata),
        blurhash: parseBlurhash(form.get('blurhash')),
        contentType: file.type || 'image/jpeg',
        bytes,
        tagIds,
      }),
    )
    return jsonResponse(created, { status: 201 })
  }).pipe(
    Effect.provide(PhotoServiceLive.pipe(Layer.provide(gatewayLayer(env)))),
    Effect.catch((error: unknown) =>
      Effect.succeed(jsonResponse({ message: String(error) }, { status: 500 })),
    ),
  )
  return Effect.runPromise(program)
}

const gatewayLayer = (env: ApiEnv) =>
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  GatewayLive({ db: env.DB as never, photos: env.PHOTOS as never })

const handleImageProxy = async (env: ApiEnv, request: Request): Promise<Response> => {
  const url = new URL(request.url)
  const r2Key = decodeURIComponent(url.pathname.slice('/image/'.length))
  const object = await env.PHOTOS.get(r2Key)
  if (!object) return jsonResponse({ message: `Image ${r2Key} not found` }, { status: 404 })
  const headers = new Headers()
  headers.set('content-type', object.httpMetadata?.contentType ?? 'image/jpeg')
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  return new Response(object.body, { headers })
}

let cachedHandler: ((request: Request) => Promise<Response>) | undefined
let cachedEnv: ApiEnv | undefined

const rpcHandler = (env: ApiEnv): ((request: Request) => Promise<Response>) => {
  if (cachedHandler !== undefined && cachedEnv === env) return cachedHandler
  const routerLayer = HttpRouter.layer
  const handlersLayer = Layer.merge(PublicRpcHandlersLive, AdminRpcHandlersLive).pipe(
    Layer.provide(Layer.merge(PhotoServiceLive, TagServiceLive)),
    Layer.provide(gatewayLayer(env)),
  )
  const appLayer = Layer.mergeAll(
    RpcServer.layerHttp({ group: PhotoPublicRpcs, path: '/rpc', protocol: 'http' }).pipe(
      Layer.provide(routerLayer),
      Layer.provide(RpcSerialization.layerJson),
    ),
    RpcServer.layerHttp({ group: PhotoAdminRpcs, path: '/admin/rpc', protocol: 'http' }).pipe(
      Layer.provide(routerLayer),
      Layer.provide(RpcSerialization.layerJson),
    ),
    routerLayer,
  ).pipe(Layer.provide(handlersLayer))

  const webHandler = HttpRouter.toWebHandler(appLayer, { disableLogger: true })
  const handler = (request: Request): Promise<Response> => webHandler.handler(request)
  cachedHandler = handler
  cachedEnv = env
  return handler
}

const corsHeaders = (request: Request): Record<string, string> => {
  const origin = request.headers.get('origin')
  if (origin === null) return {}
  const allowed =
    origin.endsWith('.photo.localhost') ||
    origin === 'https://photo.localhost' ||
    origin === 'https://photo-api.localhost' ||
    origin.endsWith('.elianiva.com') ||
    origin === 'https://photo.elianiva.com'
  if (!allowed) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, cf-access-jwt-assertion, authorization',
    'access-control-allow-credentials': 'true',
    vary: 'Origin',
  }
}

const withCors = (request: Request, response: Response): Response => {
  const headers = corsHeaders(request)
  if (Object.keys(headers).length === 0) return response
  const out = new Response(response.body, response)
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v)
  return out
}

export default {
  async fetch(request: Request, env: ApiEnv, _ctx: unknown): Promise<Response> {
    if (request.method === 'OPTIONS') {
      const headers = corsHeaders(request)
      if (Object.keys(headers).length > 0) {
        return new Response(null, { status: 204, headers: new Headers(headers) })
      }
      return new Response(null, { status: 204 })
    }

    const url = new URL(request.url)

    if (url.pathname === '/health') {
      const res = jsonResponse({ ok: true })
      return withCors(request, res)
    }

    if (url.pathname === '/upload' && request.method === 'POST') {
      const rejection = await verifyAdminAccess(request, env)
      if (rejection !== null) return withCors(request, rejection)
      const res = await handleUpload(env, request)
      return withCors(request, res)
    }

    if (url.pathname === '/admin/rpc') {
      const rejection = await verifyAdminAccess(request, env)
      if (rejection !== null) return withCors(request, rejection)
      const res = await rpcHandler(env)(request)
      return withCors(request, res)
    }

    if (url.pathname.startsWith('/image/')) {
      const res = await handleImageProxy(env, request)
      return withCors(request, res)
    }

    if (url.pathname === '/rpc') {
      const res = await rpcHandler(env)(request)
      return withCors(request, res)
    }

    return withCors(request, new Response('Not found', { status: 404 }))
  },
}

const verifyAdminAccess = async (request: Request, env: ApiEnv): Promise<Response | null> => {
  const teamDomain = env.ACCESS_TEAM_DOMAIN
  if (teamDomain === undefined || teamDomain === '') return null
  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (token === null) {
    return jsonResponse({ message: 'missing access token' }, { status: 401 })
  }
  const result = await verifyAccessToken(token, teamDomain)
  if (!result.ok) {
    return jsonResponse({ message: `access denied: ${result.reason}` }, { status: 401 })
  }
  return null
}
