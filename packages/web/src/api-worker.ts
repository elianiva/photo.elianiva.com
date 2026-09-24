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
import { clientKey, createRateLimiter } from './rate-limit'

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

const securityHeaders = (): Record<string, string> => ({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
})

const withSecurity = (response: Response): Response => {
  const out = new Response(response.body, response)
  for (const [k, v] of Object.entries(securityHeaders())) {
    if (!out.headers.has(k)) out.headers.set(k, v)
  }
  return out
}

const UPLOAD_MAX_BYTES = 20 * 1024 * 1024
const ALLOWED_UPLOAD_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
])

const sanitizeError = (error: unknown): string => {
  if (error instanceof Error) {
    if (error.name === 'StorageError') return error.message
    return 'internal error'
  }
  return 'internal error'
}

// Per-isolate fixed windows: uploads are expensive (R2 + D1), RPCs are cheap reads.
const uploadLimiter = createRateLimiter(10, 60_000)
const adminRpcLimiter = createRateLimiter(60, 60_000)
const publicRpcLimiter = createRateLimiter(180, 60_000)

const rateLimited = (
  limiter: ReturnType<typeof createRateLimiter>,
  request: Request,
): Response | null => {
  const result = limiter.check(clientKey(request))
  if (result.allowed) return null
  return jsonResponse(
    { message: 'rate limit exceeded' },
    { status: 429, headers: { 'retry-after': String(result.retryAfter) } },
  )
}

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
    const title = titleRaw.trim().slice(0, 200)
    if (file.size <= 0 || file.size > UPLOAD_MAX_BYTES) {
      return jsonResponse({ message: 'file must be non-empty and under 20MB' }, { status: 413 })
    }
    if (file.type !== '' && !ALLOWED_UPLOAD_TYPES.has(file.type)) {
      return jsonResponse({ message: 'unsupported image type' }, { status: 415 })
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
      typeof slugField === 'string' && slugField.trim() !== '' ? slugField.slice(0, 200) : title,
    )
    const r2Key = `originals/${id}-${slug}.${extFromName(file.name || 'photo.jpg')}`
    const takenAtValue =
      typeof takenAtRaw === 'string' && takenAtRaw.trim() !== ''
        ? takenAtRaw.trim().slice(0, 64)
        : meta.takenAt

    const created = yield* PhotoService.use((service) =>
      service.create({
        slug,
        title,
        r2Key,
        width: meta.width,
        height: meta.height,
        takenAt: takenAtValue,
        metadata: JSON.stringify(mergedMetadata),
        blurhash: parseBlurhash(form.get('blurhash')),
        contentType: file.type || 'image/jpeg',
        bytes,
        tagIds: tagIds.slice(0, 32),
      }),
    )
    return jsonResponse(created, { status: 201 })
  }).pipe(
    Effect.provide(PhotoServiceLive.pipe(Layer.provide(gatewayLayer(env)))),
    Effect.catch((error: unknown) =>
      Effect.succeed(jsonResponse({ message: sanitizeError(error) }, { status: 500 })),
    ),
  )
  return Effect.runPromise(program)
}

const gatewayLayer = (env: ApiEnv) => {
  if (env.DB === undefined || env.DB === null || env.PHOTOS === undefined || env.PHOTOS === null) {
    throw new Error('missing D1 or R2 binding')
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return GatewayLive({ db: env.DB as never, photos: env.PHOTOS as never })
}

const handleImageProxy = async (env: ApiEnv, request: Request): Promise<Response> => {
  const url = new URL(request.url)
  const r2Key = decodeURIComponent(url.pathname.slice('/image/'.length))
  if (
    r2Key === '' ||
    r2Key.length > 256 ||
    r2Key.includes('..') ||
    !r2Key.startsWith('originals/') ||
    r2Key.includes('\0')
  ) {
    return jsonResponse({ message: 'not found' }, { status: 404 })
  }
  const object = await env.PHOTOS.get(r2Key)
  if (!object) return jsonResponse({ message: 'not found' }, { status: 404 })
  const headers = new Headers()
  headers.set('content-type', object.httpMetadata?.contentType ?? 'image/jpeg')
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  return new Response(object.body, { headers })
}

const buildRpcHandler = (env: ApiEnv): ((request: Request) => Promise<Response>) => {
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
  return handler
}

const ALLOWED_ORIGINS = new Set([
  'https://photo.elianiva.com',
  'https://photo-api.elianiva.com',
  'https://photo.localhost',
  'https://photo-api.localhost',
])

const corsHeaders = (request: Request): Record<string, string> => {
  const origin = request.headers.get('origin')
  if (origin === null) return {}
  if (!ALLOWED_ORIGINS.has(origin)) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, cf-access-jwt-assertion, authorization',
    'access-control-allow-credentials': 'true',
    'access-control-max-age': '86400',
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
    const respond = (res: Response): Response => withSecurity(withCors(request, res))
    if (request.method === 'OPTIONS') {
      const headers = corsHeaders(request)
      if (Object.keys(headers).length > 0) {
        return withSecurity(new Response(null, { status: 204, headers: new Headers(headers) }))
      }
      return withSecurity(new Response(null, { status: 403 }))
    }

    const url = new URL(request.url)

    if (url.pathname === '/health') {
      try {
        const row = await env.DB.prepare('SELECT 1 as ok').first<{ ok: number }>()
        if (row === null) throw new Error('db probe failed')
        return respond(jsonResponse({ ok: true }))
      } catch {
        return respond(jsonResponse({ ok: false }, { status: 503 }))
      }
    }

    if (url.pathname === '/upload' && request.method === 'POST') {
      const limited = rateLimited(uploadLimiter, request)
      if (limited !== null) return respond(limited)
      const rejection = await verifyAdminAccess(request, env)
      if (rejection !== null) return respond(rejection)
      const res = await handleUpload(env, request)
      return respond(res)
    }

    if (url.pathname === '/admin/rpc') {
      const limited = rateLimited(adminRpcLimiter, request)
      if (limited !== null) return respond(limited)
      const rejection = await verifyAdminAccess(request, env)
      if (rejection !== null) return respond(rejection)
      const res = await buildRpcHandler(env)(request)
      return respond(res)
    }

    if (url.pathname.startsWith('/image/')) {
      const res = await handleImageProxy(env, request)
      return respond(res)
    }

    if (url.pathname === '/rpc') {
      const limited = rateLimited(publicRpcLimiter, request)
      if (limited !== null) return respond(limited)
      const res = await buildRpcHandler(env)(request)
      return respond(res)
    }

    return respond(new Response('Not found', { status: 404 }))
  },
}

const verifyAdminAccess = async (request: Request, env: ApiEnv): Promise<Response | null> => {
  const teamDomain = env.ACCESS_TEAM_DOMAIN
  if (teamDomain === undefined || teamDomain === '') {
    return jsonResponse({ message: 'server misconfigured' }, { status: 500 })
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (token === null) {
    return jsonResponse({ message: 'missing access token' }, { status: 401 })
  }
  const result = await verifyAccessToken(token, teamDomain)
  if (!result.ok) {
    return jsonResponse({ message: 'access denied' }, { status: 401 })
  }
  const allowlist = (env.ACCESS_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0)
  if (allowlist.length > 0) {
    const email = result.email?.toLowerCase() ?? ''
    if (!allowlist.includes(email)) {
      return jsonResponse({ message: 'access denied' }, { status: 403 })
    }
  }
  return null
}
