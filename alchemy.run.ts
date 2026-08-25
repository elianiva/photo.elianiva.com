import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Effect from 'effect/Effect'

class Website extends Cloudflare.Website.Vite<Website>()('photo', {
  rootDir: 'packages/web',
  domain: Alchemy.Stack.useSync((stack) =>
    stack.stage === 'prod' ? 'photo.elianiva.com' : undefined,
  ),
  assets: {
    runWorkerFirst: false,
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
    const website = yield* Website

    return {
      url: website.url,
    }
  }),
)
