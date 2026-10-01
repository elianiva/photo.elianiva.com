import type { D1Database } from '@cloudflare/workers-types'
import * as Alchemy from 'alchemy'
import { Stage } from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'

const PhotoBucket = Cloudflare.R2.Bucket('photo-originals', {
  name: 'photo-elianiva-originals',
})

const PhotoDb = Cloudflare.D1.Database('photo-db', {
  name: 'photo-elianiva',
  migrations: './migrations',
})

/** The identity provider the Admin's login uses: the one Cloudflare manages
 *  for the account, which is the email one-time PIN (a Zero Trust organization
 *  ships with it, so it is a lookup rather than a resource to create).
 *
 *  This is a plan-time *data source*, not a resource. Reading the uuid out of
 *  a created `Access.IdentityProvider` instead — `yield* idp` and then
 *  `idp.identityProviderId.asEffect()` — asks for a service the engine only
 *  provides while it is applying, and the stack then dies before it plans:
 *  `Service not found: RuntimeContext`, which is how #79 and everything after
 *  it failed to deploy and left production with no Access application at all.
 *  `Output.as()` is the shape the Plan layer resolves. */
const TeamIdp = Cloudflare.Access.getIdentityProvider({ type: 'cloudflare' })

/** The one hostname the whole site answers on. The website Worker owns it as a
 *  custom domain; the API Worker is mounted underneath it at `API_ROUTE_PREFIX`
 *  as a route, which is a more specific match and therefore wins for its own
 *  paths. See the Access application below for why that matters. */
const SITE_DOMAIN = 'photo.elianiva.com'

const SITE_ZONE = 'elianiva.com'

/** Everything the API Worker answers lives under here. A path outside the
 *  prefix belongs to the website Worker, so the two can never both claim a
 *  URL. Mirrored by `API_PREFIX` in `packages/web/src/lib/api.ts`. */
const API_ROUTE_PREFIX = '/api'

export default Alchemy.Stack(
  'photo-elianiva-com',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    // --- Env-driven only, no fallback (per ADR 0003) ---
    // Set via Alchemy secrets / CF secrets, not process.env.
    // See README for `alchemy secret set` commands.
    //
    // Local dev (`alchemy dev --stage dev`) creates no Access applications
    // and runs unauthenticated by design (ADR 0003), so the *binding* is
    // forced to '' there — and `access.ts` stands the admin gate down on a
    // blank team domain. Every other stage requires both values explicitly.
    //
    // Forced, not defaulted: `Config.withDefault('')` only supplies the empty
    // string when the variable is *absent*, so a real ACCESS_TEAM_DOMAIN in
    // `.env` — which the same file that `alchemy deploy --stage prod` reads
    // has to carry — would have gated local development instead, and the
    // browser there holds no `Cf-Access-Jwt-Assertion` to verify. That is the
    // whole stand-down, so it is a constant and not a lookup.
    //
    // STAGE rides along as a binding because only the Worker can see the
    // stage at request time, and the gate is stage-dependent.
    const stage = yield* Stage
    const isLocalDev = stage === 'dev'
    const allowedEmailsRaw = yield* Config.String('ACCESS_ALLOWED_EMAILS')
    const teamDomain = isLocalDev ? '' : yield* Config.String('ACCESS_TEAM_DOMAIN')

    const allowedEmails = allowedEmailsRaw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)

    if (allowedEmails.length === 0) {
      // fail closed — no fallback, must be set via Alchemy secrets
      throw new Error('ACCESS_ALLOWED_EMAILS is empty — set at least one email (comma-separated)')
    }

    const AccessPolicies = [
      {
        decision: 'allow' as const,
        include: allowedEmails.map((email) => ({ email })),
      },
    ]

    // ONE Access application for the whole Admin — the pages, the RPC and the
    // upload — rather than one per hostname and per path.
    //
    // Access issues an *application token per application* and evaluates a
    // request at the edge before the Worker runs. Splitting the Admin across
    // several applications on several hostnames meant the operator's login on
    // the site granted nothing on the API hostname, and a cross-origin call
    // could not complete the interactive login that would have fixed it: the
    // browser's preflight carries no cookies, so Cloudflare answered the
    // preflight with a bare 403 before the Worker was ever reached. One
    // application with three destinations on one hostname gives one login, one
    // app token and one same-origin cookie, and no preflight to fail.
    //
    // `destinations` is the field to reach for; `domain` is only the primary
    // one and is what the App Launcher shows. Cloudflare folds `domain` into
    // the destination set, so the first entry is the primary one named twice
    // — that is the API's own contract, not a second rule.
    const ADMIN_API_PREFIX = `${API_ROUTE_PREFIX}/admin`

    const adminApp = Cloudflare.Access.Application('photo-admin', {
      type: 'self_hosted',
      domain: `${SITE_DOMAIN}/admin`,
      destinations: [
        { type: 'public', uri: `${SITE_DOMAIN}/admin` },
        { type: 'public', uri: `${SITE_DOMAIN}${ADMIN_API_PREFIX}/rpc` },
        { type: 'public', uri: `${SITE_DOMAIN}${API_ROUTE_PREFIX}/upload` },
      ],
      policies: AccessPolicies,
      sessionDuration: '24h',
      // Exactly one IdP is declared, so the login can skip the provider picker
      // and go straight to the one-time PIN box. The uuid is an `Output`, which
      // the Plan layer resolves before the request is built.
      allowedIdps: [TeamIdp.identityProviderId.as<string>()],
      autoRedirectToIdentity: true,
    })

    // The Worker's build is described in `packages/web/vite.config.ts`
    // (`environments.ssr`): `src/worker.ts` as the entry of the environment
    // Alchemy treats as the Worker, built to `dist/ssr/worker.js`. A plain
    // `vite build` of that config builds the same environment, which is what
    // makes `pnpm build` a gate on the artifact `pnpm infra:deploy` uploads
    // instead of on a client-only bundle nobody deploys (#67).
    //
    // Nothing here names the entry, on purpose: `main` or a `viteEnvironments`
    // entry would be a second description of that build, and a wrong one is
    // invisible to `pnpm build` and fatal at deploy time — the shape of the 28
    // red deploys behind #67.
    class Website extends Cloudflare.Website.Vite<Website>()('photo', {
      rootDir: 'packages/web',
      assets: {
        notFoundHandling: 'none',
        // The page paths run the Worker before the asset layer (ADR 0004).
        //
        // `dist/client/index.html` is a built asset, and the asset layer is
        // served first by default, so `/` used to be answered with the client
        // template: an empty `#root` with no `data-foldkit-app` stamp. The
        // front page's `Runtime.hydrate` reads a missing stamp as "this page
        // was not server-rendered", refuses to boot, and puts the document
        // behind a refusal shield — the `[foldkit] Runtime.hydrate could not
        // find a server-rendered root` error, in dev and deployed alike.
        //
        // The Worker is the site's page host in both stages: it renders the
        // public documents, serves the Admin shell, and reads the client
        // template through the ASSETS binding to fill it. `/index.html` is the
        // Front under its old spelling, so the Worker answers it with a
        // redirect rather than with the bare template.
        //
        // **A public page path added later is a Worker-first path too.** The
        // list is the public route table's paths spelled out, because the asset
        // layer would otherwise answer `/about` with the client template: an
        // empty `#root` that no public document's `Runtime.hydrate` will adopt.
        runWorkerFirst: ['/', '/index.html', '/about', '/admin', '/admin/*'],
      },
      domain: SITE_DOMAIN,
      compatibility: { flags: ['nodejs_compat'], date: '2025-09-01' },
      dev: { port: 5173, strictPort: true },
      env: {
        PHOTOS: PhotoBucket,
        DB: PhotoDb,
        STAGE: stage,
        ACCESS_TEAM_DOMAIN: teamDomain,
        ACCESS_ALLOWED_EMAILS: allowedEmailsRaw,
      },
    }) {}

    // A Worker of its own, on the site's hostname rather than one of its own.
    // Two Workers stay two Workers because `alchemy dev` binds real D1/R2 to
    // the website Worker, and the read path it renders the Front with is that
    // Worker's own (ADR 0004) — but in production they share an origin, which
    // is what the Access application above needs. `dev.port` is the one place
    // they are still cross-origin.
    const ApiWorker = Cloudflare.Worker('photo-api', {
      main: 'packages/web/src/api-worker.ts',
      compatibility: { date: '2025-09-01', flags: ['nodejs_compat'] },
      routes: [{ pattern: `${SITE_DOMAIN}${API_ROUTE_PREFIX}/*`, zoneName: SITE_ZONE }],
      env: {
        PHOTOS: PhotoBucket,
        DB: PhotoDb,
        STAGE: stage,
        ACCESS_TEAM_DOMAIN: teamDomain,
        ACCESS_ALLOWED_EMAILS: allowedEmailsRaw,
      },
      dev: { port: 13371, strictPort: true },
    })

    // Edge gating is a production concern — skip Access resources entirely
    // on local dev so the stack boots without touching Cloudflare Access.
    if (!isLocalDev) {
      yield* adminApp
    }
    // Data resources always converge the real cloud, even during `alchemy
    // dev` — Alchemy.remote() opts them out of local emulation so local dev
    // reads/writes the same photos as production.
    yield* PhotoBucket.pipe(Alchemy.remote())
    yield* PhotoDb.pipe(Alchemy.remote())

    const website = yield* Website
    yield* ApiWorker

    return {
      url: website.url,
      // Same-origin, so this is a path on the site rather than a second
      // hostname. Spelled from the constant rather than from `website.url`,
      // which is a resource reference and not a string.
      apiUrl: `https://${SITE_DOMAIN}${API_ROUTE_PREFIX}`,
      bucketName: (yield* PhotoBucket).bucketName,
      databaseName: (yield* PhotoDb).databaseName,
    }
  }),
)

// Worker env shape — Website is inside the Stack so we can't use InferEnv.
//
// The two bindings get different treatment, for a reason worth writing down.
//
// D1 is the platform's own `D1Database`, because `@effect/sql-d1` demands
// exactly that type and nothing narrower will do. The hand-written subset that
// used to be here was wrong twice over: it drifted from the real binding, and it
// was narrow enough that the driver rejected it, so the call sites had to be
// handed the binding with an `as never` cast.
//
// R2 stays structural, and stays *this* file's own declaration rather than an
// import of the contract in `@photo/api`: `alchemy.run.ts` is resolved by
// NodeNext at the workspace root, which has no path mapping for the workspace
// packages. The platform ships its own `ReadableStream`, and it is not
// assignable to the DOM one the services hand to `new Response` — they declare
// `getReader` differently — so naming `R2Bucket` here would move the cast
// rather than remove it. `R2BucketBinding` is a member-for-member copy of
// `R2BucketLike`, and the one place the two meet — `MetadataLive`'s `photos`
// parameter, handed `env.PHOTOS` in `packages/web/src/api-worker.ts` — is what
// keeps them from drifting apart again, since a member added to the contract
// without the copy is a type error right there. Which is how the binding came
// to be missing `head` and `list` in the first place, and how the `as never`
// that papered over it came to exist.
export type R2ObjectBinding = {
  readonly key: string
  readonly size: number
  readonly uploaded: Date
  readonly httpMetadata?: { readonly contentType?: string } | undefined
  readonly body?: ReadableStream | null | undefined
}

export type R2BucketBinding = {
  get(key: string, options?: unknown): Promise<R2ObjectBinding | null>
  head(key: string): Promise<R2ObjectBinding | null>
  list(options?: {
    readonly prefix?: string | undefined
    readonly limit?: number | undefined
    readonly cursor?: string | undefined
  }): Promise<{
    readonly objects: ReadonlyArray<R2ObjectBinding>
    readonly truncated: boolean
    readonly cursor?: string | undefined
  }>
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | Blob | ReadableStream | string | null,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>
  delete(keys: string | ReadonlyArray<string>): Promise<unknown>
}

export type WebsiteEnv = {
  readonly PHOTOS: R2BucketBinding
  readonly DB: D1Database
  readonly STAGE: string
  readonly ACCESS_TEAM_DOMAIN: string
  readonly ACCESS_ALLOWED_EMAILS?: string
}
