import { Effect, Layer } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc'
import type { WebsiteEnv } from '../../../alchemy.run'
import {
  AdminRpcHandlersLive,
  AdminSession,
  extractImageMeta,
  GatewayLive,
  PhotoService,
  PhotoServiceLive,
  PublicPhotoServiceLive,
  PublicRpcHandlersLive,
  SettingsService,
  SettingsServiceLive,
  TagServiceLive,
  type AdminSessionValue,
} from '@photo/api'
import {
  InvalidInput,
  PhotoAdminRpcs,
  PhotoPublicRpcs,
  hasJpegMagic,
  isJpegUpload,
} from '@photo/shared'
import { verifyAdminAccess } from './access'
import { clientKey, createRateLimiter, type RateLimiter } from './rate-limit'

// The stage arrives as a binding because the admin gate is stage-dependent:
// blank `ACCESS_TEAM_DOMAIN` means unauthenticated on `dev` and a hard failure
// anywhere else. See `verifyAdminAccess` in ./access.
type ApiEnv = WebsiteEnv & { readonly STAGE: string }

const slugify = (input: string): string =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled'

/** The one extension an original may be stored under. Uploads are JPEG only
 *  (chain decision 6), so the picker hint, the MIME check and the stored key
 *  cannot drift into three different format lists — there is one format. */
const ORIGINAL_EXTENSION = 'jpg'

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

// 80 MB. The Workers request-body cap is 100 MB on Free/Pro (200 MB Business,
// 500 MB Enterprise), and a zone's Maximum Upload Size can lower it further, so
// 80 MB fits with headroom on the cheapest plan and there is no reason to raise
// it. Verified against Cloudflare's Workers limits before settling on it.
const UPLOAD_MAX_BYTES = 80 * 1024 * 1024

const sanitizeError = (error: unknown): string => {
  if (error instanceof Error) {
    // Domain rejections (an unsupported ratio, malformed settings) carry a
    // message meant for the operator; a storage failure carries one for the
    // logs. The upload dialog's failed row prints whichever the caller routes.
    if (error instanceof InvalidInput) return error.message
    if (error.name === 'StorageError') return error.message
    return 'internal error'
  }
  return 'internal error'
}

// Per-isolate fixed windows: uploads are expensive (R2 + D1), RPCs are cheap reads.
// Ten uploads a minute at 80 MB is an 800 MB/min ceiling for the single
// Access-gated operator. That is above what a home uplink sustains, so the
// window is a burst guard against a runaway client rather than the real
// throughput limit, and ten still admits the design's four-file batch in one
// run. The request-body cap, not the window, is what actually bounds memory.
const uploadLimiter = createRateLimiter(10, 60_000)
const adminRpcLimiter = createRateLimiter(60, 60_000)
const publicRpcLimiter = createRateLimiter(180, 60_000)

const rateLimited = (limiter: RateLimiter, request: Request): Response | null => {
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
      return jsonResponse({ message: 'file must be non-empty and under 80MB' }, { status: 413 })
    }
    if (!isJpegUpload(file.name, file.type)) {
      return jsonResponse({ message: 'unsupported image — JPEG only' }, { status: 415 })
    }
    const takenAtRaw = form.get('takenAt')
    // The dialog's two Toggle Rows. `Publish when ready` off (the default)
    // creates a draft; `Use export defaults` on seeds the six export columns
    // from the Settings singleton rather than from the schema defaults.
    const publishWhenReady = form.get('publishWhenReady') === 'true'
    const useExportDefaults = form.get('useExportDefaults') === 'true'
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

    // A declared `image/jpeg` is not enough: a renamed PNG or HEIC can carry
    // the type. The bytes' own SOI marker is the second, unforgeable check, so
    // only a real JPEG ever reaches `extractImageMeta` and R2.
    if (!hasJpegMagic(new Uint8Array(bytes))) {
      return jsonResponse({ message: 'unsupported image — JPEG only' }, { status: 415 })
    }

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
    const r2Key = `originals/${id}-${slug}.${ORIGINAL_EXTENSION}`
    const takenAtValue =
      typeof takenAtRaw === 'string' && takenAtRaw.trim() !== ''
        ? takenAtRaw.trim().slice(0, 64)
        : meta.takenAt

    // `Use export defaults` reads the Settings singleton rather than trusting
    // the client's copy, so the seeded columns are the stored ones.
    const exportDefaults = useExportDefaults
      ? yield* SettingsService.use((service) => service.read).pipe(
          Effect.map((settings) => ({
            previewLongEdge: settings.defaultPreviewLongEdge,
            previewFormat: settings.defaultPreviewFormat,
            previewQuality: settings.defaultPreviewQuality,
            fullQuality: settings.defaultFullQuality,
            keepExif: settings.defaultKeepExif,
            removeGps: settings.defaultRemoveGps,
          })),
        )
      : undefined

    const created = yield* PhotoService.use((service) =>
      service.create({
        slug,
        title,
        r2Key,
        width: meta.width,
        height: meta.height,
        status: publishWhenReady ? 'published' : 'draft',
        ...(exportDefaults === undefined ? {} : { exportDefaults }),
        takenAt: takenAtValue,
        aperture: meta.aperture,
        shutter: meta.shutter,
        iso: meta.iso,
        focalLength: meta.focalLength,
        metadata: JSON.stringify(mergedMetadata),
        blurhash: parseBlurhash(form.get('blurhash')),
        contentType: 'image/jpeg',
        bytes,
        tagIds: tagIds.slice(0, 32),
      }),
    )
    return jsonResponse(created, { status: 201 })
  }).pipe(
    Effect.provide(
      Layer.mergeAll(PhotoServiceLive, SettingsServiceLive).pipe(Layer.provide(gatewayLayer(env))),
    ),
    // A rejection the operator can act on (an unsupported ratio) is a 400 with
    // its own message; everything else is an opaque 500. The failed Upload Item
    // prints the message, so the ratio reason reaches it from here.
    Effect.catch((error: unknown) =>
      Effect.succeed(
        jsonResponse(
          { message: sanitizeError(error) },
          { status: error instanceof InvalidInput ? 400 : 500 },
        ),
      ),
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

/** The claims `verifyAdminAccess` just verified, provided into the admin
 *  handler layer per request, so a handler that reads the session reads the
 *  one the gate checked. The public route has no gate, so it provides the
 *  stand-down shape and the admin group is unreachable there. */
const buildRpcHandler = (
  env: ApiEnv,
  session: AdminSessionValue,
): ((request: Request) => Promise<Response>) => {
  const routerLayer = HttpRouter.layer
  const handlersLayer = Layer.merge(
    PublicRpcHandlersLive,
    Layer.provide(AdminRpcHandlersLive, Layer.succeed(AdminSession, session)),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(PhotoServiceLive, PublicPhotoServiceLive, TagServiceLive, SettingsServiceLive),
    ),
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
  // The dev pair: the site's Vite dev server and this Worker's `dev.port`.
  'http://localhost:5173',
  'http://localhost:13371',
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
    // Effect's HTTP RPC client appends a slash to the URL it is given, so the
    // app itself asks for `/rpc/` and `/admin/rpc/`. Every path below is
    // matched by hand against this string, so the trailing slash is dropped
    // once here instead of being spelled into each comparison — otherwise the
    // site's own client gets the Not found below from every read.
    const pathname = url.pathname.replace(/\/+$/, '')

    if (pathname === '/health') {
      try {
        const row = await env.DB.prepare('SELECT 1 as ok').first<{ ok: number }>()
        if (row === null) throw new Error('db probe failed')
        return respond(jsonResponse({ ok: true }))
      } catch {
        return respond(jsonResponse({ ok: false }, { status: 503 }))
      }
    }

    if (pathname === '/upload' && request.method === 'POST') {
      const limited = rateLimited(uploadLimiter, request)
      if (limited !== null) return respond(limited)
      // The upload is edge-gated, not identified: nothing it writes carries
      // the operator's email, so the verified address is read and dropped.
      const gate = await verifyAdminAccess(request, env)
      if (!gate.ok) return respond(gate.response)
      const res = await handleUpload(env, request)
      return respond(res)
    }

    if (pathname === '/admin/rpc') {
      const limited = rateLimited(adminRpcLimiter, request)
      if (limited !== null) return respond(limited)
      const gate = await verifyAdminAccess(request, env)
      if (!gate.ok) return respond(gate.response)
      const res = await buildRpcHandler(env, {
        email: gate.email,
        teamDomain: gate.teamDomain,
      })(request)
      return respond(res)
    }

    if (url.pathname.startsWith('/image/')) {
      const res = await handleImageProxy(env, request)
      return respond(res)
    }

    if (pathname === '/rpc') {
      const limited = rateLimited(publicRpcLimiter, request)
      if (limited !== null) return respond(limited)
      // The admin group is mounted on `/admin/rpc`, which this path never
      // matches, so the session it carries is unreachable from here.
      const res = await buildRpcHandler(env, { email: null, teamDomain: null })(request)
      return respond(res)
    }

    return respond(new Response('Not found', { status: 404 }))
  },
}
