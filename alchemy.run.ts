import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Effect from 'effect/Effect'

/**
 * ADR 0007: the account's Access team domain (https://<team>.cloudflareaccess.com).
 * Set before deploying to a gated stage; empty ⇒ the Worker skips in-worker
 * JWT verification (local dev), relying on the edge gate alone.
 */
const ACCESS_TEAM_DOMAIN = ''

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

const AccessPolicies = [
  {
    decision: 'allow' as const,
    include: [{ email: 'git@elianiva.my.id' }, { email: 'git@elianiva.com' }],
  },
]

const AdminApp = Cloudflare.Access.Application('photo-admin', {
  type: 'self_hosted',
  domain: 'photo.elianiva.com/admin',
  policies: AccessPolicies,
  sessionDuration: '24h',
})

// ADR 0007: admin RPC + multipart upload are edge-gated separately from the
// /admin pages, so a public route can never be repointed at a mutation.
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
  // Fixed local dev port so the portless proxy has a stable target
  // (https://photo.localhost → 127.0.0.1:13370).
  dev: { port: 13370, strictPort: true },
  env: {
    PHOTOS: PhotoBucket,
    DB: PhotoDb,
    IMAGES: Cloudflare.Images.Images('IMAGES'),
    // In-worker JWT verification input (ADR 0007); empty on dev stages.
    ACCESS_TEAM_DOMAIN,
  },
}) {}

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>

export default Alchemy.Stack(
  'photo-elianiva-com',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
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
