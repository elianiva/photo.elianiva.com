import { Effect } from 'effect'
import { Server } from 'foldkit/experimental'
import { Flags, init, view } from './main'

const flagsForRequest = (): Flags => ({
  renderedAt: new Date().toISOString(),
  renderedOn: 'Server' as const,
})

export const renderPage = (request: Request): Promise<Server.EntryResult> =>
  Effect.runPromise(
    Effect.gen(function* () {
      if (request.method === 'OPTIONS') {
        return Server.Responded(
          new Response(null, {
            status: 204,
            headers: { allow: Server.HOST_METHOD_ANSWERS.allow },
          }),
        )
      }

      const renderedApplication = yield* Server.renderToString(
        { Flags, init, view },
        {
          flags: flagsForRequest(),
          buildId: import.meta.env.FOLDKIT_BUILD_ID,
        },
      )

      return Server.Rendered(renderedApplication, {
        headers: {
          // SSR cache: edge caches for 60s, stale-while-revalidate for 5min
          'cache-control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
          'x-content-type-options': 'nosniff',
        },
      })
    }),
  )
