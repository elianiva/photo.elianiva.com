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
 * Both public documents read the same way. The Front used to be the one page on
 * the site with no data behind it — a hardcoded Edition of stock photographs — and it is
 * now rendered from `frontPage`, the read the public `GetFrontPage` RPC
 * serves. The About page is rendered from the public list, the read
 * `ListPhotos` serves, and a Tag page from `byTag`. The Folio is rendered from
 * the Folio read rather than from a list of words in a view, so the nav is the
 * site's own Tags. Rendering them here rather than fetching over HTTP is
 * the point: the photographs are in the HTML the reader receives, so there is
 * no request to await before the first paint and no second copy of a query. It
 * is also the only read path: the Worker renders both in development as well
 * as in production, so there is no second implementation that reads over HTTP
 * (ADR 0004).
 */

import { Effect, Layer } from 'effect'
import { MetadataLive, PublicPhotoService, PublicPhotoServiceLive } from '@photo/api'
import { FRONT_SECTION_COUNT } from '@photo/shared'
import type { PhotoWithTags } from '@photo/shared'
import type { WebsiteEnv } from '../../../../alchemy.run'
import { type FolioEntry, type FrontRead, type TagRead } from '@/public/content'
import { routePath, type PublicLocation } from '@/public/route'

const siteLayers = (env: WebsiteEnv) => {
  if (env.DB === undefined || env.DB === null || env.PHOTOS === undefined || env.PHOTOS === null) {
    throw new Error('missing D1 or R2 binding')
  }
  return PublicPhotoServiceLive.pipe(Layer.provide(MetadataLive({ db: env.DB, photos: env.PHOTOS })))
}

/** The Folio a failed read leaves behind. One value rather than two literals,
 *  so "no tags" is a single answer the nav and the sitemap both print. */
const NO_FOLIO: ReadonlyArray<FolioEntry> = []

/** Run a public read against the Worker's own bindings, as an `Effect`. The form
 *  the Worker itself composes with, so a caller already inside a pipeline (the
 *  sitemap's two reads) does not have to leave it and come back. */
export const readSiteEffect = <A, E>(
  env: WebsiteEnv,
  effect: Effect.Effect<A, E, PublicPhotoService>,
): Effect.Effect<A, E> => Effect.provide(effect, siteLayers(env))

/** The same read, at the promise boundary the SSR render awaits. */
export const readSite = <A, E>(
  env: WebsiteEnv,
  effect: Effect.Effect<A, E, PublicPhotoService>,
): Promise<A> => Effect.runPromise(readSiteEffect(env, effect))

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
 * How many photographs the About page leads with.
 *
 * The design's desktop master draws one plate and its mobile master draws two,
 * so two is what the read asks for and the view drops the second where the
 * master does not draw it. It is the page's page-weight decision, the way
 * `FRONT_SECTION_COUNT` is the Front's, and the read is never asked for more of
 * the archive than the page can show.
 */
export const ABOUT_PLATE_COUNT = 2

/**
 * The About page's read: the published photographs it leads with, newest
 * first, off this Worker's own D1 and R2 bindings.
 *
 * The words on that page are authored in the views, so photographs are the
 * whole of the read — an empty answer is a real state and the page is the prose
 * and the kit with no plate on it. A read that fails is answered the same way,
 * for the reason `readFront` is: a visitor gets an honest broadsheet rather
 * than a 500.
 */
export const readAbout = (env: WebsiteEnv): Promise<ReadonlyArray<PhotoWithTags>> =>
  readSite(
    env,
    PublicPhotoService.use((service) => service.list({ limit: ABOUT_PLATE_COUNT })),
  ).then(
    (page) => page.items,
    () => [],
  )

/**
 * The Folio's entries, off this Worker's own bindings.
 *
 * The nav is this read rather than a list of words in a view, so it is read on
 * every public render: the Masthead is the chrome all three documents share,
 * and a Folio one document had and another did not would be a nav that changes
 * with the page.
 *
 * A read that fails leaves the Folio empty, which prints `ALL` and `ABOUT` with
 * nothing between them. That is the honest answer for the same reason
 * `readFront` returns an empty Edition: a visitor gets a broadsheet that does
 * not claim a section the database could not confirm.
 *
 * A Tag's `id` is dropped here rather than downstream: it is an internal detail
 * of the Admin's grouping, and the Folio's whole public vocabulary is the slug
 * and the label.
 */
/** The Folio, as an `Effect`, for a caller already composing one. The
 *  empty-Folio-on-failure decision stays with the caller, so the SSR render and
 *  the sitemap each make it once and visibly. */
export const readFolioEffect = (
  env: WebsiteEnv,
): Effect.Effect<ReadonlyArray<FolioEntry>, unknown> =>
  Effect.map(
    readSiteEffect(env, PublicPhotoService.use((service) => service.folio())),
    (folio) => folio.map(({ slug, label }) => ({ slug, label })),
  )

export const readFolio = (env: WebsiteEnv): Promise<ReadonlyArray<FolioEntry>> =>
  Effect.runPromise(
    Effect.orElseSucceed(readFolioEffect(env), () => NO_FOLIO),
  )

/**
 * A Tag page's read: the Tag and its published photographs, earliest first, so
 * the head of the list is the page's cover (ADR 0006 — a Series page is a Tag
 * page).
 *
 * A slug no Tag carries is `null`, and a read that fails is `null` for the same
 * reason: the site has no `404` document of its own yet (ADR 0006), so the
 * Worker answers a URL it cannot render with a 404 status rather than with the
 * Front — two URLs serving one document is a page the site does not have.
 */
export const readTag = (env: WebsiteEnv, slug: string): Promise<TagRead | null> =>
  readSite(
    env,
    PublicPhotoService.use((service) => service.byTag(slug)),
  ).then(
    (series) => series,
    () => null,
  )

/**
 * The sitemap's `lastmod`: the day the newest published Photo was taken.
 *
 * A read that fails — a database that is not there, a query the engine
 * refuses — leaves the element out rather than failing the route. A sitemap
 * with no `lastmod` is valid, and one that 500s tells a crawler the whole site
 * is broken over a date it does not need.
 */
const lastModified = (env: WebsiteEnv): Effect.Effect<string, never> =>
  Effect.map(
    Effect.orElseSucceed(
      readSiteEffect(env, PublicPhotoService.use((service) => service.frontStats())),
      () => null,
    ),
    (stats) => stats?.latestTakenAt?.slice(0, 10) ?? '',
  )

const SITEMAP_URL = 'https://photo.elianiva.com'

/** `/sitemap.xml` — the crawler route (robots.txt points here). It names the
 *  site's public documents, so a document the Worker answers and the sitemap
 *  does not list is a document a crawler is never told about. The paths are
 *  the route table's, not a second list of them, and a Tag page's path is
 *  printed from the same Folio the Masthead draws — the two are the same list,
 *  so a Tag page cannot be in the nav and out of the sitemap. */
/** `/sitemap.xml` — the crawler route. Named so the render shows up in the
 *  Worker's log beside the documents it was built from; without it a slow
 *  sitemap is indistinguishable from a slow Front. */
export const renderSitemap = Effect.fn('site.sitemap')(function* (env: WebsiteEnv) {
  // The two reads are independent, so they run together rather than in sequence.
  const [lastmod, folio] = yield* Effect.all([
    lastModified(env),
    Effect.orElseSucceed(readFolioEffect(env), () => NO_FOLIO),
  ])
  const lastmodElement = lastmod === '' ? '' : `<lastmod>${escapeXml(lastmod)}</lastmod>`
  const locations: ReadonlyArray<PublicLocation> = [
    { route: 'front' },
    { route: 'about' },
    ...folio.map((tag): PublicLocation => ({ route: 'tag', tagSlug: tag.slug })),
  ]
  const paths = locations.map((location) => routePath(location))
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((path) => `  <url><loc>${SITEMAP_URL}${path}</loc>${lastmodElement}</url>`).join('\n')}
</urlset>
`
  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
})
