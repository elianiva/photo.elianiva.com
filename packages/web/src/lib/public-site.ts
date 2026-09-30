/**
 * The public site's read path in the website Worker.
 *
 * The API Worker answers over an Effect Layer stack — `GatewayLive` from the
 * D1 and R2 bindings, then the services over it (ADR 0003). The website Worker
 * answers a server-rendered page and a sitemap out of the same stack, so the
 * repo carries one data-access style and one read model: the sitemap's
 * hand-written `env.DB.prepare` is gone, and `frontStats` is the query behind
 * it.
 *
 * The Front itself reads the same way. It used to be the one page on the site
 * with no data behind it — a hardcoded Edition of stock photographs — and it is
 * now rendered from `frontPage`, the read the public `GetFrontPage` RPC
 * serves. Rendering the Front here rather than fetching it over HTTP is the
 * point: the photographs are in the HTML the reader receives, so there is no
 * request to await before the first paint and no second copy of the query. It
 * is also the only read path: the Worker renders the Front in development as
 * well as in production, so there is no second implementation that reads over
 * HTTP (ADR 0004).
 */

import { Effect, Layer } from 'effect'
import { GatewayLive, PublicPhotoService, PublicPhotoServiceLive } from '@photo/api'
import { FRONT_SECTION_COUNT } from '@photo/shared'
import type { WebsiteEnv } from '../../../../alchemy.run'
import { type FrontRead } from '@/home/content'

const siteLayers = (env: WebsiteEnv) => {
  if (env.DB === undefined || env.DB === null || env.PHOTOS === undefined || env.PHOTOS === null) {
    throw new Error('missing D1 or R2 binding')
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const gateway = GatewayLive({ db: env.DB as never, photos: env.PHOTOS as never })
  return PublicPhotoServiceLive.pipe(Layer.provide(gateway))
}

/** Run a public read against the Worker's own bindings. */
export const readSite = <A, E>(
  env: WebsiteEnv,
  effect: Effect.Effect<A, E, PublicPhotoService>,
): Promise<A> => Effect.runPromise(Effect.provide(effect, siteLayers(env)))

/**
 * The Front's read, off this Worker's own D1 and R2 bindings.
 *
 * `frontPage` is the whole of it: the published photographs grouped into the
 * months the Front draws them, and the cursor below the last one. The page's
 * words are authored in the views, so there is no second read to keep in step
 * with this one. The read filters to published, non-trashed Photos inside
 * `PublicPhotoService`, so a Draft cannot reach a visitor.
 *
 * A read that fails is not a failed page: the Front renders the copy that says
 * there is nothing here yet. A visitor gets a broadsheet honest about being
 * empty rather than a 500.
 */
export const readFront = (env: WebsiteEnv): Promise<FrontRead> =>
  readSite(
    env,
    Effect.gen(function* () {
      const service = yield* PublicPhotoService
      const page = yield* service.frontPage({ sectionCount: FRONT_SECTION_COUNT })
      return { sections: page.sections, nextSectionCursor: page.nextSectionCursor }
    }),
  ).then(
    (read) => read,
    () => ({ sections: [], nextSectionCursor: null }),
  )

const escapeXml = (input: string): string =>
  input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The sitemap's `lastmod`: the day the newest published Photo was taken.
 *
 * A read that fails — a database that is not there, a query the engine
 * refuses — leaves the element out rather than failing the route. A sitemap
 * with no `lastmod` is valid, and one that 500s tells a crawler the whole site
 * is broken over a date it does not need.
 */
const lastModified = async (env: WebsiteEnv): Promise<string> => {
  const latest = await readSite(
    env,
    PublicPhotoService.use((service) => service.frontStats()),
  ).then(
    (stats) => stats.latestTakenAt,
    () => null,
  )
  return latest?.slice(0, 10) ?? ''
}

const SITEMAP_URL = 'https://photo.elianiva.com/'

/** `/sitemap.xml` — the one crawler route besides `/` (robots.txt points here). */
export const renderSitemap = async (env: WebsiteEnv): Promise<Response> => {
  const lastmod = await lastModified(env)
  const lastmodElement = lastmod === '' ? '' : `<lastmod>${escapeXml(lastmod)}</lastmod>`
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITEMAP_URL}</loc>${lastmodElement}</url>
</urlset>
`
  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
