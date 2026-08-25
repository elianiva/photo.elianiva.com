import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Effect from 'effect/Effect'

const PhotoBucket = Cloudflare.R2.Bucket('photo-originals', {
  name: 'photo-elianiva-originals',
})

const PhotoDb = Cloudflare.D1.Database('photo', {
  name: 'photo-elianiva',
  migrations: './migrations',
})

const OtpIdp = Cloudflare.Access.IdentityProvider('otp', {
  type: 'onetimepin',
})

const AdminApp = Cloudflare.Access.Application('photo-admin', {
  type: 'self_hosted',
  domain: 'photo.elianiva.com/admin',
  policies: [
    {
      decision: 'allow',
      include: [
        { email: 'git@elianiva.my.id' },
        { email: 'git@elianiva.com' },
      ],
    },
  ],
  sessionDuration: '24h',
})

class Website extends Cloudflare.Website.Foldkit<Website>()('photo', {
  rootDir: 'packages/web',
  domain: 'photo.elianiva.com',
  main: 'src/worker.ts',
  env: {
    PHOTOS: PhotoBucket,
    DB: PhotoDb,
    IMAGES: Cloudflare.Images.Images('IMAGES'),
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
