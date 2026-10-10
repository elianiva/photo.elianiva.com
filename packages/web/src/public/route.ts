/**
 * Public routes — the URL vocabulary of the public site, declared once so the
 * same table answers both directions of a URL: which document a request names,
 * and where the Nav points when the reader is on that document. The Admin
 * keeps its table in `admin/route.ts` for the same reason, and the rule is the
 * same — the route is the whole of a URL's meaning, so nothing else may hold a
 * second copy of the path.
 *
 * Each route carries two paths because the home page's are genuinely two: the
 * Worker answers the document on `/`, and the Nav's `ALL` link points at
 * `/#` so that clicking the section the reader is already on returns them to
 * the top of it rather than re-rendering the page. One table, two fields,
 * both read — the pathname picks the document, the route picks the link that
 * carries the current mark.
 *
 * `tag` is the one route that carries something: a Tag page is a Tag's own
 * page (ADR 0006 — a Series page *is* a Tag page), so its path is
 * `/tag/<slug>` and the slug is part of what the path names. A location is
 * therefore a route plus, for that one, the slug the path was addressed by,
 * and every path is printed from here — the Nav's link, the sitemap's entry
 * and the Worker's own match are three answers to one question.
 *
 * A path the table does not name is not a public document, and the site has no
 * NotFound document of its own yet (the design's `404` is a later chain,
 * ADR 0006).
 */

import { Schema as S } from 'effect'

/** The public documents the site publishes. Each is a route, a Model field and
 *  a view, and the three are read off this one list. */
export const publicRoutes = ['home', 'about', 'tag'] as const
export type PublicRoute = (typeof publicRoutes)[number]

/** The schema the Model carries, so a decoded model cannot hold a route the
 *  table does not name. */
export const PublicRoute = S.Literals(publicRoutes)

/** A public document as a path names it: the route, and whatever the route
 *  carries. Only `tag` carries anything — the Tag slug the path was addressed
 *  by — so the other two are a route alone. */
export type PublicLocation =
  | { readonly route: 'home' }
  | { readonly route: 'about' }
  | { readonly route: 'tag'; readonly tagSlug: string }

/** Where a route lives: `path` is what a request asks for, `href` is what a
 *  link to it carries. `tag` is absent because its path is its slug's, and a
 *  slug is not known until a read names it. */
const ROUTE_PATHS: Record<
  Exclude<PublicRoute, 'tag'>,
  { readonly path: string; readonly href: string }
> = {
  home: { path: '/', href: '/#' },
  about: { path: '/about', href: '/about' },
}

/** Where a Tag's page lives. One path for the Nav's link, the sitemap's
 *  entry and the Worker's match, so a Tag is reachable at the URL the nav
 *  shows. The slug is a path segment of its own, which is what keeps a free-form
 *  label (`b&w`, `night`) out of the rest of the site's URL space. */
export const tagPath = (slug: string): string => `/tag/${slug}`

/** `/tag/<slug>`, one segment and nothing after it: a deeper path is not a Tag
 *  page, and matching it as one would answer a directory of photos. */
const TAG_PATH = /^\/tag\/([^/]+)$/

/** A trailing slash is the same document, so `/about/` and `/about` are one
 *  path. The root is left alone: stripping its slash would leave nothing. */
const normalise = (pathname: string): string =>
  pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname

/** A percent-escaped path segment, or null when the escape is malformed. A
 *  slug reaches the read as text, so `/tag/B%26W` is the Tag `B&W`; a path
 *  whose escape does not decode is not a URL at all, and it names no route. */
const decodeSegment = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/** The location a path names, or null when it names none. */
export const routeNamedBy = (pathname: string): PublicLocation | null => {
  const path = normalise(pathname)
  if (ROUTE_PATHS.home.path === path) return { route: 'home' }
  if (ROUTE_PATHS.about.path === path) return { route: 'about' }
  const tag = path.match(TAG_PATH)
  const tagSlug = tag?.[1] === undefined ? null : decodeSegment(tag[1])
  return tagSlug === null ? null : { route: 'tag', tagSlug }
}

/** Where the Worker answers a location. */
export const routePath = (location: PublicLocation): string =>
  location.route === 'tag' ? tagPath(location.tagSlug) : ROUTE_PATHS[location.route].path

/** The Nav's own spelling of a location — the `href` its Nav Link carries,
 *  and so the string the Header marks as current when the reader is there.
 *  A Tag page's two paths are one path, so `/#`'s reason does not apply. */
export const routeHref = (location: PublicLocation): string =>
  location.route === 'tag' ? tagPath(location.tagSlug) : ROUTE_PATHS[location.route].href
