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

const OtpIdp = Cloudflare.Access.IdentityProvider('otp', {
  type: 'onetimepin',
})

export default Alchemy.Stack(
  'photo-elianiva-com',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    // --- Env-driven only, no fallback (per ADR 0007) ---
    // Set via Alchemy secrets / CF secrets, not process.env.
    // See README for `alchemy secret set` commands.
    //
    // Local dev (`alchemy dev --stage dev`) creates no Access applications
    // and runs unauthenticated by design (ADR 0007): ACCESS_TEAM_DOMAIN
    // defaults to '' there and access.ts skips JWT verification when empty.
    // Non-dev stages still require both values explicitly.
    const isLocalDev = (yield* Stage) === 'dev'
    const allowedEmailsRaw = yield* Config.string('ACCESS_ALLOWED_EMAILS')
    const teamDomain = isLocalDev
      ? yield* Config.string('ACCESS_TEAM_DOMAIN').pipe(Config.withDefault(''))
      : yield* Config.string('ACCESS_TEAM_DOMAIN')

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

    const AdminApp = Cloudflare.Access.Application('photo-admin', {
      type: 'self_hosted',
      domain: 'photo.elianiva.com/admin',
      policies: AccessPolicies,
      sessionDuration: '24h',
    })

    const AdminApiApp = Cloudflare.Access.Application('photo-admin-api', {
      type: 'self_hosted',
      domain: 'photo-api.elianiva.com/admin/rpc',
      policies: AccessPolicies,
      sessionDuration: '24h',
    })

    const UploadApp = Cloudflare.Access.Application('photo-admin-upload', {
      type: 'self_hosted',
      domain: 'photo-api.elianiva.com/upload',
      policies: AccessPolicies,
      sessionDuration: '24h',
    })

    class Website extends Cloudflare.Website.Vite<Website>()('photo', {
      rootDir: 'packages/web',
      main: 'src/worker.ts',
      viteEnvironments: { entry: 'worker' },
      assets: { notFoundHandling: 'single-page-application' },
      domain: 'photo.elianiva.com',
      compatibility: { flags: ['nodejs_compat'], date: '2025-09-01' },
      dev: { port: 5173, strictPort: true },
      env: {
        PHOTOS: PhotoBucket,
        DB: PhotoDb,
        IMAGES: Cloudflare.Images.Images('IMAGES'),
        ACCESS_TEAM_DOMAIN: teamDomain,
      },
    }) {}

    const ApiWorker = Cloudflare.Worker('photo-api', {
      main: 'packages/web/src/api-worker.ts',
      compatibility: { date: '2025-09-01', flags: ['nodejs_compat'] },
      domain: 'photo-api.elianiva.com',
      env: {
        PHOTOS: PhotoBucket,
        DB: PhotoDb,
        ACCESS_TEAM_DOMAIN: teamDomain,
      },
      dev: { port: 13371, strictPort: true },
    })

    // Edge gating is a production concern — skip Access resources entirely
    // on local dev so the stack boots without touching Cloudflare Access.
    if (!isLocalDev) {
      // Ensure Access resources are created before the site
      yield* OtpIdp
      yield* AdminApp
      yield* AdminApiApp
      yield* UploadApp
    }
    // Data resources always converge the real cloud, even during `alchemy
    // dev` — Alchemy.remote() opts them out of local emulation so local dev
    // reads/writes the same photos as production.
    yield* PhotoBucket.pipe(Alchemy.remote())
    yield* PhotoDb.pipe(Alchemy.remote())

    const website = yield* Website
    const api = yield* ApiWorker

    return {
      url: website.url,
      apiUrl: api.url,
      bucketName: (yield* PhotoBucket).bucketName,
      databaseName: (yield* PhotoDb).databaseName,
    }
  }),
)

// Worker env shape — Website is inside the Stack so we can't use InferEnv.
// Keep structural bindings the Worker actually uses (PHOTOS.get/put/delete, DB.prepare/batch).
export type WebsiteEnv = {
  readonly PHOTOS: {
    get(
      key: string,
    ): Promise<{ httpMetadata?: { contentType?: string }; body: ReadableStream | null } | null>
    put(
      key: string,
      value: ArrayBuffer | ReadableStream | string,
      options?: { httpMetadata?: { contentType?: string } },
    ): Promise<unknown>
    delete(key: string): Promise<unknown>
  }
  readonly DB: {
    prepare(query: string): {
      bind(...values: ReadonlyArray<unknown>): {
        first<T = unknown>(): Promise<T | null>
        all<T = unknown>(): Promise<{ results?: ReadonlyArray<T> }>
        run(): Promise<unknown>
      }
      first<T = unknown>(): Promise<T | null>
      all<T = unknown>(): Promise<{ results?: ReadonlyArray<T> }>
      run(): Promise<unknown>
    }
    batch(statements: ReadonlyArray<unknown>): Promise<ReadonlyArray<unknown>>
  }
  readonly IMAGES: unknown
  readonly ACCESS_TEAM_DOMAIN: string
}
