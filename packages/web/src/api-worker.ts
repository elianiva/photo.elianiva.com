import { Effect, Layer, Option, Result, Schema as S } from 'effect'
import * as SqlClient from 'effect/sql/SqlClient'
import { FetchHttpClient, Headers, HttpRouter, HttpServerResponse } from 'effect/http'
import { RpcSerialization, RpcServer } from 'effect/rpc'
import type { WebsiteEnv } from '../../../alchemy.run'
import {
  AdminRpcHandlersLive,
  AdminSession,
  extractImageMeta,
  MetadataLive,
  PhotoService,
  PhotoServiceLive,
  PublicPhotoServiceLive,
  PublicRpcHandlersLive,
  SettingsService,
  SettingsServiceLive,
  TagServiceLive,
} from '@photo/api'
import {
  Blurhash,
  InvalidInput,
  PhotoAdminRpcs,
  PhotoPublicRpcs,
  TagIdList,
  UploadErrorBody,
  UploadSuccessBody,
  hasJpegMagic,
  isJpegUpload,
} from '@photo/shared'
import { rejectionResponse, verifyAdminAccess } from './access'
import { ADMIN_RPC_PATH, HEALTH_PATH, IMAGE_PATH, RPC_PATH, UPLOAD_PATH } from './lib/api'
import { WorkerLoggerLive } from './lib/logger'
import { RateLimit, RateLimitLive, clientKey } from './rate-limit'

// The stage arrives as a binding because the admin gate is stage-dependent:
// blank `ACCESS_TEAM_DOMAIN` means unauthenticated on `dev` and a hard failure
// anywhere else. See `verifyAdminAccess` in ./access. Both Workers take the
// same bindings, so they share one env type rather than declaring it twice.
type ApiEnv = WebsiteEnv

/** The Access gate's HTTP transport, over the platform's own `fetch`.
 *
 *  `FetchHttpClient.layer` alone would resolve `FetchHttpClient.Fetch` — a
 *  `Context.Reference`, which memoises its default on the reference object at
 *  first read for the lifetime of the module. Naming `globalThis.fetch` here
 *  pins nothing: the lookup happens per call, so the gate reads the platform's
 *  fetch as it is at the moment it makes the request. That is the same fetch the
 *  bare call this replaced used, and it is what lets the gate's tests stand a
 *  JWKS in its place.
 *
 *  `async`, and awaiting the call rather than returning it: the transport needs
 *  a settled promise of a `Response` to read, and handing it the call's return
 *  value directly leaves it with whatever the implementation handed back. */
const gateHttpLayer = Layer.provide(
  FetchHttpClient.layer,
  Layer.succeed(
    FetchHttpClient.Fetch,
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      globalThis.fetch(input, init),
  ),
)

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

/** A rejection body on the upload route, through the declared
 *  {@link UploadErrorBody}. The upload dialog's failed row prints `message`,
 *  so every refusal the Admin can reach answers with the one shape it knows how
 *  to read — including a rate limit, which the queue renders the same way. */
const uploadError = (message: string, status: number, headers?: HeadersInit): Response =>
  jsonResponse(UploadErrorBody.make({ message }), {
    status,
    ...(headers === undefined ? {} : { headers }),
  })

const securityHeaders = (): Record<string, string> => ({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
})

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

/** `JSON.parse` as a total function: `None` for text that is not JSON, rather
 *  than a `try`/`catch` at each of the three call sites below. The parsed value
 *  is `unknown` and the *shape* is the Schema's job, so parse and validate
 *  stay two separable steps. */
const parseJson = Option.liftThrowable((raw: string): unknown => JSON.parse(raw))

/** Parse a multipart text field and decode it as `schema`, in one step.
 *  `None` for a field that is absent, empty, not JSON, or not the declared
 *  shape — a body the client got wrong is answered from the fallback, never
 *  with a failure the operator cannot act on. */
const decodeJsonField = <A>(
  schema: S.ConstraintDecoder<A>,
  raw: FormDataEntryValue | null,
): Option.Option<A> =>
  typeof raw === 'string' && raw !== ''
    ? S.decodeUnknownOption(schema)(Option.getOrElse(parseJson(raw), () => null))
    : Option.none()

/** The Blurhash the browser encoded off the composition, decoded against the
 *  one {@link Blurhash} definition the `UpdatePhoto` payload also enforces, so
 *  an upload and a later Editor save cannot disagree about what a hash is. */
const parseBlurhash = (raw: FormDataEntryValue | null): string | undefined =>
  typeof raw === 'string'
    ? Option.getOrUndefined(S.decodeUnknownOption(Blurhash)(raw.trim()))
    : undefined

/** The free-form `metadata` blob the dialog sends. Kept as a JSON object
 *  rather than decoded to `PhotoMetadata`: the four keys the upload merges are
 *  picked from it below, and a body carrying keys the merge does not read is
 *  stored as nothing rather than as a failure. */
const parseMetadataObject = (raw: FormDataEntryValue | null): Record<string, unknown> =>
  Option.getOrElse(decodeJsonField(S.JsonObject, raw), () => ({}))

const handleUpload = (env: ApiEnv, request: Request): Promise<Response> => {
  const upload = Effect.fn('api.upload')(function* () {
    const form: FormData = yield* Effect.tryPromise({
      try: () => request.formData(),
      catch: () => new Error('invalid multipart form'),
    })
    const file = form.get('file')
    const titleRaw = form.get('title')
    if (!(file instanceof File) || typeof titleRaw !== 'string' || titleRaw.trim() === '') {
      return uploadError('file and title are required', 400)
    }
    const title = titleRaw.trim().slice(0, 200)
    if (file.size <= 0 || file.size > UPLOAD_MAX_BYTES) {
      return uploadError('file must be non-empty and under 80MB', 413)
    }
    if (!isJpegUpload(file.name, file.type)) {
      return uploadError('unsupported image — JPEG only', 415)
    }
    const takenAtRaw = form.get('takenAt')
    // The dialog's two Toggle Rows. `Publish when ready` off (the default)
    // creates a draft; `Use export defaults` on seeds the six export columns
    // from the Settings singleton rather than from the schema defaults.
    const publishWhenReady = form.get('publishWhenReady') === 'true'
    const useExportDefaults = form.get('useExportDefaults') === 'true'
    // The same `TagIdList` the `UpdatePhoto` payload is bounded by, so an
    // upload and an edit cap the same selection the same way. A body over the
    // bound is the client's own picker misbehaving; the upload proceeds with
    // no tags rather than failing a file that is otherwise fine.
    const tagIds: ReadonlyArray<string> = Option.getOrElse(
      decodeJsonField(TagIdList, form.get('tagIds')),
      () => [],
    )

    const bytes: ArrayBuffer = yield* Effect.tryPromise({
      try: () => file.arrayBuffer(),
      catch: () => new Error('failed to read upload'),
    })

    // A declared `image/jpeg` is not enough: a renamed PNG or HEIC can carry
    // the type. The bytes' own SOI marker is the second, unforgeable check, so
    // only a real JPEG ever reaches `extractImageMeta` and R2.
    if (!hasJpegMagic(new Uint8Array(bytes))) {
      return uploadError('unsupported image — JPEG only', 415)
    }

    const meta = yield* extractImageMeta(bytes).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (meta === undefined) {
      return uploadError('not a readable image', 400)
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
        tagIds,
      }),
    )
    // `renditionsPending` is declared rather than sniffed for: regeneration is
    // not built yet (CONTEXT.md `Rendition`, #35), so nothing an upload stores
    // owes a Rendition, and the Admin's queue holds a `true` here at
    // `processing` rather than publishing a Photo still waiting for one.
    return jsonResponse(UploadSuccessBody.make({ ...created, renditionsPending: false }), {
      status: 201,
    })
  })

  return Effect.runPromise(
    upload().pipe(
      Effect.provide(
        Layer.mergeAll(PhotoServiceLive, SettingsServiceLive).pipe(
          Layer.provide(metadataLayer(env)),
        ),
      ),
      // The upload's span is only reported if something reads it; the Worker's
      // logger is what turns it into a line `wrangler tail` prints.
      Effect.provide(WorkerLoggerLive),
      // A rejection the operator can act on (an unsupported ratio) is a 400 with
      // its own message; everything else is an opaque 500. The failed Upload Item
      // prints the message, so the ratio reason reaches it from here.
      Effect.catch((error: unknown) =>
        Effect.succeed(
          uploadError(sanitizeError(error), error instanceof InvalidInput ? 400 : 500),
        ),
      ),
    ),
  )
}

/** The metadata stack: the `SqlClient` over D1, D1's own atomic `Batch`, and
 *  the R2 `Gateway`. A Worker deployed without a binding cannot answer
 *  anything, so the missing binding is a startup error.
 *
 *  `MetadataLive`'s `photos` parameter is also what keeps `R2BucketBinding` in
 *  `alchemy.run.ts` honest: it is a member-for-member copy of `R2BucketLike`,
 *  and a member added to the contract without the copy is a type error right
 *  here. Nothing casts, so there is no `as never` for a gap to hide behind. */
const metadataLayer = (env: ApiEnv) => {
  if (env.DB === undefined || env.DB === null || env.PHOTOS === undefined || env.PHOTOS === null) {
    throw new Error('missing D1 or R2 binding')
  }
  return MetadataLive({ db: env.DB, photos: env.PHOTOS })
}

/** The D1 liveness probe behind `/api/health`. A `Result`, not a failure: a
 *  database that is not answering is the health endpoint reporting `503`, which
 *  is the one route whose whole job is to answer with that. */
const healthProbe = Effect.fn('api.health')(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* Effect.result(sql`SELECT 1 AS ok`)
  return Result.isSuccess(rows)
})

/** The R2 proxy behind `/api/image/<key>`. The key is checked before R2 is
 *  touched, so a traversal attempt costs a string comparison rather than a
 *  bucket read.
 *
 *  The key arrives from the router as a path parameter, which is why it is
 *  decoded here rather than sliced out of the URL: the route owns the prefix and
 *  this owns the shape of what follows it. A key spanning more than one segment
 *  never matches the route at all, which is a stronger answer than a check. */
const imageProxy = Effect.fn('api.imageProxy')(function* (env: ApiEnv, rawKey: string) {
  const r2Key = decodeURIComponent(rawKey)
  if (
    r2Key === '' ||
    r2Key.length > 256 ||
    r2Key.includes('..') ||
    !r2Key.startsWith('originals/') ||
    r2Key.includes('\0')
  ) {
    // Not an upload rejection: nothing decodes an image proxy's 404, so it
    // answers the same message shape without borrowing the upload contract.
    return yield* HttpServerResponse.json({ message: 'not found' }, { status: 404 })
  }
  const object = yield* Effect.tryPromise({
    try: () => env.PHOTOS.get(r2Key),
    // An R2 that is not answering is a 404 to the caller — a plate that cannot
    // be fetched is a missing plate — and the span records that it happened.
    catch: () => null,
  })
  // An object read with a precondition carries no stream, and there is no
  // precondition here, so this is unreachable in practice — answered rather than
  // handed to `Response` as a body it cannot use.
  if (
    object === null ||
    object === undefined ||
    object.body === null ||
    object.body === undefined
  ) {
    return yield* HttpServerResponse.json({ message: 'not found' }, { status: 404 })
  }
  const headers = new globalThis.Headers()
  headers.set('content-type', object.httpMetadata?.contentType ?? 'image/jpeg')
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  return HttpServerResponse.fromWeb(new globalThis.Response(object.body, { headers }))
})

/**
 * The Access gate, as middleware on the routes that need it.
 *
 * It provides `AdminSession` for the request that passed, so a handler that
 * reads the session reads the one the gate checked. As middleware the gate sits
 * *on* the route rather than in front of it: a route mounted without it is
 * ungated by construction, which is the opposite of what a chain of `if`s can
 * promise.
 *
 * The bindings and the web `Request` are closed over rather than read from the
 * context. `HttpRouter.middleware` may only require services the router itself
 * provides, and these are the two it cannot — they are an argument of `fetch`.
 * Closing over them is sound because the middleware is built per request, from
 * those same arguments, and the comment on `handlerFor` says so.
 */
const adminGate = (env: ApiEnv, request: globalThis.Request) =>
  HttpRouter.middleware<{ provides: AdminSession }>()((httpEffect) =>
    Effect.gen(function* () {
      const gate = yield* verifyAdminAccess(request, env).pipe(Effect.provide(gateHttpLayer))
      if (Result.isFailure(gate)) {
        // The reason is eight-way specific and the caller is told nothing but
        // the status, so it is logged here rather than in the body.
        yield* Effect.logWarning(gate.failure.reason)
        return HttpServerResponse.fromWeb(rejectionResponse(gate.failure))
      }
      return yield* Effect.provide(
        httpEffect,
        Layer.succeed(AdminSession, {
          email: gate.success.email,
          teamDomain: gate.success.teamDomain,
        }),
      )
    }),
  ).layer

/**
 * The three per-route windows.
 *
 * Per-isolate fixed windows: uploads are expensive (R2 + D1), RPCs are cheap
 * reads. Ten uploads a minute at 80 MB is an 800 MB/min ceiling for the single
 * Access-gated operator — above what a home uplink sustains, so the window is a
 * burst guard against a runaway client rather than the real throughput limit,
 * and ten still admits the design's four-file batch in one run. The request-body
 * cap, not the window, is what actually bounds memory.
 *
 * As middleware so the limit is declared next to the route it bounds: the three
 * differ by two orders of magnitude, and as three names inside a dispatcher that
 * difference is easy to attach to the wrong branch. The limiter itself is built
 * per request for the same reason the gate closes over its arguments — a
 * middleware cannot require a layer-provided service — which is also what the
 * hand-written dispatcher did.
 */
export type RouteName = 'upload' | 'adminRpc' | 'publicRpc'

const limited = (route: RouteName, limit: number, windowMs: number, request: globalThis.Request) =>
  HttpRouter.middleware((httpEffect) =>
    Effect.gen(function* () {
      const refusal = yield* Effect.gen(function* () {
        const limiter = yield* RateLimit
        const result = yield* limiter.check(clientKey(request))
        if (result.allowed) return null
        // The queue renders a spent window through the upload contract, so a
        // 429 from any route is the one body shape the Admin knows how to read.
        return uploadError('rate limit exceeded', 429, {
          'retry-after': String(result.retryAfter),
        })
      }).pipe(Effect.provide(RateLimitLive(limit, windowMs)))
      if (refusal === null) return yield* httpEffect
      return HttpServerResponse.fromWeb(refusal)
    }),
  ).layer

/** The upload route. Gated and limited, and the body is read once, here. */
const uploadRoute = (env: ApiEnv, request: globalThis.Request) =>
  HttpRouter.add('POST', UPLOAD_PATH, () =>
    Effect.map(
      Effect.promise(() => handleUpload(env, request)),
      HttpServerResponse.fromWeb,
    ),
  ).pipe(
    Layer.provide(adminGate(env, request)),
    Layer.provide(limited('upload', 10, 60_000, request)),
  )

/** The admin group. The gate is what makes it reachable, and it is mounted under
 *  its own path so the public route cannot name it. */
const adminRpcRoute = (env: ApiEnv, request: globalThis.Request) =>
  RpcServer.layerHttp({ group: PhotoAdminRpcs, path: ADMIN_RPC_PATH, protocol: 'http' }).pipe(
    Layer.provide(adminGate(env, request)),
    Layer.provide(limited('adminRpc', 60, 60_000, request)),
    Layer.provide(
      Layer.provide(
        AdminRpcHandlersLive,
        // Provided by the gate for the request that passed; the stand-down
        // shape is unreachable, because this route is not mounted anywhere the
        // gate does not run.
        Layer.succeed(AdminSession, { email: null, teamDomain: null }),
      ),
    ),
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(HttpRouter.layer),
  )

/** The public group. Cheap reads, and the only thing the public site calls. */
const publicRpcRoute = (env: ApiEnv, request: globalThis.Request) =>
  RpcServer.layerHttp({ group: PhotoPublicRpcs, path: RPC_PATH, protocol: 'http' }).pipe(
    Layer.provide(limited('publicRpc', 180, 60_000, request)),
    Layer.provide(PublicRpcHandlersLive),
    Layer.provide(
      Layer.mergeAll(PhotoServiceLive, PublicPhotoServiceLive, TagServiceLive, SettingsServiceLive),
    ),
    Layer.provide(metadataLayer(env)),
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(HttpRouter.layer),
  )

/**
 * The image proxy.
 *
 * A trailing `/*` rather than a `:key`, and that is not a style choice. Every
 * key this route serves is `originals/<id>.jpg` — it contains a slash — and a
 * `:key` matches one segment, so the route would 404 every image in the bucket.
 * The wildcard is the whole remainder of the path; `imageProxy` then does what
 * the old `startsWith` did and decides what is an acceptable key, because that
 * check is about R2 rather than about routing.
 */
const imageRoute = (env: ApiEnv) =>
  HttpRouter.add('*', `${IMAGE_PATH}/*`, () =>
    Effect.gen(function* () {
      const params = yield* HttpRouter.params
      return yield* imageProxy(env, params['*'] ?? '')
    }),
  )

/**
 * The only origins that get CORS headers: the two localhost ports the dev
 * server runs on. In production the Admin and the API share a hostname, so
 * nothing is cross-origin and this list is never consulted — which is the point,
 * because a cross-origin preflight is exactly what Cloudflare Access used to
 * answer with a bare 403. See `./lib/api` for the whole story.
 *
 * `b3` and `traceparent` are named in the allowed headers and are not
 * decoration: Effect's HTTP client stamps both onto every request it makes, so
 * the dev preflight asks for them by name. A preflight that does not answer with
 * the headers it asked for is a failed preflight, and the browser then drops the
 * POST without ever showing the Worker a response — which reads, in the Admin,
 * exactly like an unproven session: every read fails, `GetSession` is refused,
 * and the whole shell is replaced by the sign-in affordance. Nothing in
 * production is preflighted (the API is a route on the site's own hostname), so
 * this list is dev-only and its job is to match what the client actually sends.
 *
 * One behaviour did change, and it is the preflight for a disallowed origin: it
 * now answers `204` without `access-control-allow-origin` where the hand-written
 * dispatcher answered `403`. The refusal is the absent header in both cases, and
 * that is the part a browser enforces.
 */
const corsLayer = HttpRouter.cors({
  allowedOrigins: ['http://localhost:5173', 'http://localhost:13371'],
  allowedMethods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['content-type', 'authorization', 'cf-access-jwt-assertion', 'b3', 'traceparent'],
  credentials: true,
  maxAge: 86_400,
})

/**
 * The 404, as a route.
 *
 * The router will 404 an unmatched path on its own, and that answer is produced
 * before any route is matched — so global middleware never sees it, and the
 * security headers the hand-written dispatcher put on every response would go
 * missing on exactly the answer nobody is looking at. Declaring the catch-all
 * last makes the 404 a route like any other, with the same headers and the same
 * logging, and the specific routes above still win because the matcher prefers
 * them over a wildcard.
 */
const notFoundRoute = HttpRouter.add(
  '*',
  '/*',
  HttpServerResponse.text('Not found', { status: 404 }),
)

/**
 * Security headers on every answer, including the refusals and the 404.
 *
 * Global middleware, so a route that answers early — a spent window, a rejected
 * gate, the catch-all above — comes back with them rather than without. The
 * hand-written dispatcher applied these to the final `Response`; this is the
 * router's way of making the same promise, and `notFoundRoute` exists because
 * the one answer no route produces is the one that would otherwise be bare.
 */
const securityLayer = HttpRouter.middleware(
  (httpEffect) =>
    Effect.map(
      httpEffect,
      HttpServerResponse.setHeaders(Headers.fromRecordUnsafe(securityHeaders())),
    ),
  { global: true },
)

/** The health probe, as a route. */
const healthRoute = (env: ApiEnv) =>
  HttpRouter.add('GET', HEALTH_PATH, () =>
    Effect.gen(function* () {
      const healthy = yield* healthProbe().pipe(Effect.provide(metadataLayer(env)))
      // A `Result`, not a failure: a database that is not answering is the health
      // endpoint reporting `503`, which is the one route whose whole job is to
      // answer with that.
      return healthy
        ? yield* HttpServerResponse.json({ ok: true })
        : yield* HttpServerResponse.json({ ok: false }, { status: 503 })
    }),
  )

/**
 * Every route, and the three layers the whole app needs.
 *
 * The services and the router are merged into the app rather than wrapped
 * around it, so a missing dependency is a type error at the point the route is
 * declared rather than a "service not found" at request time — which is how the
 * hand-written `if`-chain failed, twice, during the SQL migration.
 */
const appLayer = (env: ApiEnv, request: globalThis.Request) =>
  Layer.mergeAll(
    healthRoute(env),
    uploadRoute(env, request),
    adminRpcRoute(env, request),
    publicRpcRoute(env, request),
    imageRoute(env),
    notFoundRoute,
    corsLayer,
    securityLayer,
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(PhotoServiceLive, PublicPhotoServiceLive, TagServiceLive, SettingsServiceLive),
    ),
    // The one place the metadata stack is named: the `SqlClient` over D1, D1's
    // atomic `Batch`, and the R2 `Gateway`. Provided around the whole app so a
    // route cannot reach a service without it.
    Layer.provideMerge(metadataLayer(env)),
    Layer.provideMerge(RpcSerialization.layerJson),
    // The router the RPC groups registered their routes with. Merged in as well
    // so it is the same instance the handler dispatches through.
    Layer.provideMerge(HttpRouter.layer),
    Layer.provideMerge(WorkerLoggerLive),
  )

/**
 * The router, wired to one set of bindings.
 *
 * Built per request, which is what the hand-written dispatcher did too: the
 * bindings are an argument of `fetch`, and Effect's `Context.Reference`
 * memoises its default process-wide on first read, so a module-scoped layer
 * could not see the second Worker's `env` — or a test's. The cost is a
 * `D1Client` and its prepared-statement cache per request, against a database
 * that is a network call anyway; the alternative is a `WeakMap` keyed on `env`
 * and a module-level cache that outlives the Worker it was built for.
 *
 * `ignoreTrailingSlash` is load-bearing rather than cosmetic: Effect's HTTP RPC
 * client appends a slash to the URL it is given, so the app asks for
 * `/api/rpc/` where the route is declared `/api/rpc`. The hand-written
 * dispatcher normalised the trailing slash away by hand; the router does it for
 * every route instead of the one that needed it.
 */
/**
 * Security headers on every answer.
 *
 * At the server chain rather than as route middleware, because the answers that
 * matter most here are the ones no route produced: the router's own 404, CORS's
 * preflight, and a rate-limit refusal. Route middleware cannot reach any of
 * them — the 404 in particular is generated before a route is matched — and the
 * hand-written dispatcher applied these to the final `Response`, so this keeps
 * that promise.
 */
const handlerFor = (env: ApiEnv, request: globalThis.Request) =>
  HttpRouter.toWebHandler(appLayer(env, request), {
    disableLogger: true,
    routerConfig: { ignoreTrailingSlash: true },
  }).handler

export default {
  fetch(request: globalThis.Request, env: ApiEnv): Promise<globalThis.Response> {
    return handlerFor(env, request)(request)
  },
}
