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

type WorkerEnvWithAssets = WebsiteEnv & {
  ASSETS: { fetch: typeof fetch }
}

// ---------------------------------------------------------------------------
// Non-RPC endpoints: multipart upload (file bytes don't ride in JSON RPC)
// and the R2 image proxy (binary passthrough). Everything else client-facing
// is Effect RPC over HTTP (ADR 0006).
// ---------------------------------------------------------------------------

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

/** Base83 alphabet used by blurhash strings. */
const BLURHASH_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~'

/** Accept well-formed blurhash strings only (size flag + components + pixels). */
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

/** Multipart upload → R2 + D1 through PhotoService. Admin-gated (ADR 0007). */
const handleUpload = (env: WorkerEnvWithAssets, request: Request): Promise<Response> => {
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

    // Server-side metadata extraction: dimensions + EXIF come from the bytes
    // themselves; form fields act as per-upload overrides.
    const meta = yield* extractImageMeta(bytes).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (meta === undefined) {
      return jsonResponse({ message: 'not a readable image' }, { status: 400 })
    }

    // Form-provided camera/lens/caption/location override EXIF defaults.
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
    // SlugConflict cannot surface here — create() de-conflicts with a suffix.
    Effect.catch((error: unknown) =>
      Effect.succeed(jsonResponse({ message: String(error) }, { status: 500 })),
    ),
  )
  return Effect.runPromise(program)
}

/** The storage bindings as the Gateway service. Alchemy's inferred binding
 *  types are structurally compatible with the minimal contracts in
 *  @photo/api; the single assertion lives here at the wiring seam. */
const gatewayLayer = (env: WorkerEnvWithAssets) =>
  // SAFETY: Cloudflare D1/R2 bindings satisfy the structural D1DatabaseLike/R2BucketLike contracts.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  GatewayLive({ db: env.DB as never, photos: env.PHOTOS as never })

/** R2 original proxy — public, immutable cache (the CDN transforms sit in front). */
const handleImageProxy = async (env: WorkerEnvWithAssets, request: Request): Promise<Response> => {
  const url = new URL(request.url)
  const r2Key = decodeURIComponent(url.pathname.slice('/api/image/'.length))
  const object = await env.PHOTOS.get(r2Key)
  if (!object) return jsonResponse({ message: `Image ${r2Key} not found` }, { status: 404 })
  const headers = new Headers()
  headers.set('content-type', object.httpMetadata?.contentType ?? 'image/jpeg')
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  return new Response(object.body, { headers })
}

// ---------------------------------------------------------------------------
// Effect RPC over HTTP — one route per audience (ADR 0006).
// ---------------------------------------------------------------------------

interface AppCache {
  readonly env: WorkerEnvWithAssets
  readonly handler: (request: Request) => Promise<Response>
}

let cachedApp: AppCache | undefined

const rpcAppHandler = (env: WorkerEnvWithAssets): ((request: Request) => Promise<Response>) => {
  if (cachedApp !== undefined && cachedApp.env === env) return cachedApp.handler

  // One shared router instance: both RPC servers register their POST route on it.
  const routerLayer = HttpRouter.layer

  const handlersLayer = Layer.merge(PublicRpcHandlersLive, AdminRpcHandlersLive).pipe(
    Layer.provide(Layer.merge(PhotoServiceLive, TagServiceLive)),
    Layer.provide(gatewayLayer(env)),
  )

  const appLayer = Layer.mergeAll(
    RpcServer.layerHttp({ group: PhotoPublicRpcs, path: '/api/rpc', protocol: 'http' }).pipe(
      Layer.provide(routerLayer),
      Layer.provide(RpcSerialization.layerJson),
    ),
    RpcServer.layerHttp({ group: PhotoAdminRpcs, path: '/api/admin/rpc', protocol: 'http' }).pipe(
      Layer.provide(routerLayer),
      Layer.provide(RpcSerialization.layerJson),
    ),
    routerLayer,
  ).pipe(Layer.provide(handlersLayer))

  const webHandler = HttpRouter.toWebHandler(appLayer, { disableLogger: true })
  const handler = (request: Request): Promise<Response> => webHandler.handler(request)
  cachedApp = { env, handler }
  return handler
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  fetch(request: Request, env: WorkerEnvWithAssets, _ctx: unknown): Promise<Response> {
    return main(request, env)
  },
}

const main = async (request: Request, env: WorkerEnvWithAssets): Promise<Response> => {
  const url = new URL(request.url)

  // Admin SPA shell — the edge gate protects /admin*; this just serves assets.
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
    return env.ASSETS.fetch(new Request(new URL('/index.html', request.url).toString()))
  }

  if (url.pathname === '/api/upload' && request.method === 'POST') {
    const rejection = await verifyAdminAccess(request, env)
    if (rejection !== null) return rejection
    return handleUpload(env, request)
  }

  if (url.pathname === '/api/admin/rpc') {
    const rejection = await verifyAdminAccess(request, env)
    if (rejection !== null) return rejection
    return rpcAppHandler(env)(request)
  }

  if (url.pathname.startsWith('/api/image/')) return handleImageProxy(env, request)

  if (url.pathname.startsWith('/api/')) {
    return rpcAppHandler(env)(request)
  }

  if (env.ASSETS) return env.ASSETS.fetch(request)
  return new Response('Not found', { status: 404 })
}

/**
 * Defense-in-depth check for admin routes (ADR 0007). The edge Access
 * application is the primary gate; this verifies its JWT inside the Worker.
 * No ACCESS_TEAM_DOMAIN (local dev) ⇒ allow; set ⇒ fail closed on any doubt.
 */
const verifyAdminAccess = async (
  request: Request,
  env: WorkerEnvWithAssets,
): Promise<Response | null> => {
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
