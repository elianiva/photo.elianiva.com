import * as Alchemy from 'alchemy'
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
    const allowedEmailsRaw = yield* Config.string('ACCESS_ALLOWED_EMAILS')
    const teamDomain = yield* Config.string('ACCESS_TEAM_DOMAIN')

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
      domain: 'photo.elianiva.com/api/admin',
      policies: AccessPolicies,
      sessionDuration: '24h',
    })

    const UploadApp = Cloudflare.Access.Application('photo-admin-upload', {
      type: 'self_hosted',
      domain: 'photo.elianiva.com/api/upload',
      policies: AccessPolicies,
      sessionDuration: '24h',
    })

    class Website extends Cloudflare.Website.Foldkit<Website>()('photo', {
      rootDir: 'packages/web',
      domain: 'photo.elianiva.com',
      main: 'src/worker.ts',
      dev: { port: 13370, strictPort: true },
      env: {
        PHOTOS: PhotoBucket,
        DB: PhotoDb,
        IMAGES: Cloudflare.Images.Images('IMAGES'),
        ACCESS_TEAM_DOMAIN: teamDomain,
      },
    }) {}

    // Ensure Access resources are created before the site
    yield* OtpIdp
    yield* AdminApp
    yield* AdminApiApp
    yield* UploadApp
    yield* PhotoBucket
    yield* PhotoDb

    const website = yield* Website

    return {
      url: website.url,
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
