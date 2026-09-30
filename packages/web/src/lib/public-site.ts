/**
 * The public site's read path in the website Worker.
 *
 * The API Worker answers over an Effect Layer stack — `GatewayLive` from the
 * D1 and R2 bindings, then the services over it (ADR 0006). The website Worker
 * answers a server-rendered page and a sitemap out of the same stack, so the
 * repo carries one data-access style and one read model: the sitemap's
 * hand-written `env.DB.prepare` is gone, and `frontStats` is the query behind
 * it.
 *
 * The Front itself reads the same way. It used to be the one page on the site
 * with no data behind it — a hardcoded Edition of stock photographs — and it is
 * now rendered from `frontPage` plus `frontStats`, the same two reads the
 * public `GetFrontPage` RPC composes. Rendering the Front here rather than
 * fetching it over HTTP is the point: the Edition is in the HTML the reader
 * receives, so there is no request to await before the first paint and no
 * second copy of the query.
 */

import { Effect, Layer, Schema as S } from 'effect'
import { GatewayLive, PublicPhotoService, PublicPhotoServiceLive } from '@photo/api'
import { FRONT_SECTION_COUNT, FrontPageResult } from '@photo/shared'
import type { FrontStats } from '@photo/shared'
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

/** The counters a Front that read nothing reports. The volume numeral is `I`
 *  rather than `V`: a first issue is the honest reading when no volume has
 *  been authored yet. */
const NO_PHOTOGRAPHS: FrontStats = {
  number: null,
  total: 0,
  latestTakenAt: null,
  volume: 'I',
  motto: null,
  siteSections: [],
  aboutCopy: null,
}

/**
 * The Front's read, off this Worker's own D1 and R2 bindings.
 *
 * `frontPage` and `frontStats` are the two halves of the public `GetFrontPage`
 * answer, read directly rather than over HTTP so the rendered HTML carries the
 * Edition. Both filter to published, non-trashed Photos inside
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
      const [page, stats] = yield* Effect.all(
        [service.frontPage({ sectionCount: FRONT_SECTION_COUNT }), service.frontStats()],
        { concurrency: 2 },
      )
      return { sections: page.sections, nextSectionCursor: page.nextSectionCursor, stats }
    }),
  ).then(
    (read) => read,
    () => ({ sections: [], nextSectionCursor: null, stats: NO_PHOTOGRAPHS }),
  )

/**
 * The same read, over HTTP, for the dev server.
 *
 * `alchemy dev` binds the real D1 and R2 to the API Worker and gives foldkit's
 * dev server no bindings at all, so the one place a read can come from in dev
 * is the API Worker's own port. The response is decoded against the shared
 * `GetFrontPage` schema, so the dev read and the bound read cannot disagree
 * about what the Front gets.
 */
export const readFrontOverHttp = async (apiBase: string): Promise<FrontRead> => {
  const response = await fetch(`${apiBase}/rpc/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      _tag: 'Request',
      id: 'front',
      tag: 'GetFrontPage',
      payload: { sectionCount: FRONT_SECTION_COUNT },
      headers: [],
    }),
  })
  if (!response.ok) return { sections: [], nextSectionCursor: null, stats: NO_PHOTOGRAPHS }
  const decoded: unknown = await response.json()
  // The server answers with an array of per-request exits, one per request in
  // the batch. A Failed exit is not a crash: the Front renders the copy that
  // says there is nothing here, which is the same page a site with no published
  // photograph draws.
  if (!Array.isArray(decoded)) {
    return { sections: [], nextSectionCursor: null, stats: NO_PHOTOGRAPHS }
  }
  for (const entry of decoded) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      'exit' in entry &&
      typeof entry.exit === 'object' &&
      entry.exit !== null &&
      '_tag' in entry.exit &&
      entry.exit._tag === 'Success' &&
      'value' in entry.exit
    ) {
      const value = S.decodeUnknownSync(FrontPageResult, { errors: 'all' })(entry.exit.value)
      return value
    }
  }
  return { sections: [], nextSectionCursor: null, stats: NO_PHOTOGRAPHS }
}

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
