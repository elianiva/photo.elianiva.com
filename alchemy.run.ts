import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Effect from 'effect/Effect'

class Website extends Cloudflare.Website.Foldkit<Website>()('photo', {
  rootDir: 'packages/web',
  domain: 'photo.elianiva.com',
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
