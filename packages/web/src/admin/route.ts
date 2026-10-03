/**
 * Admin routes — the URL vocabulary of the Admin, declared once so the same
 * table both parses a URL into a Route and prints a Route back into a URL.
 * `defineRouteUnion` returns a Schema as well as a namespace, so `AppRoute`
 * lives in the admin Model and decodes.
 *
 * `Photo` takes the branded `PhotoId` through `schemaSegment`, so the Model
 * carries a Photo id and a segment that is not one never matches: it falls
 * through to `NotFound` instead of reaching a view that would have to defend
 * itself.
 *
 * The `Library` route also carries its filter, through `query`. The filter is
 * the exact case that combinator exists for: it parses a query string into a
 * typed value and prints that value back into one, so the Model's filter state
 * and the address bar cannot disagree. Every field is an `Option` —
 * `Schema.OptionFromOptional`, never `withConstructorDefault`, which is inert
 * here and caught by `foldkit/no-route-query-constructor-default`.
 */

import { Option, Schema as S, pipe } from 'effect'
import { PhotoId } from '@photo/shared'
import {
  defineRouteUnion,
  literal,
  mapTo,
  oneOf,
  parseUrlWithFallback,
  query,
  schemaSegment,
  slash,
} from 'foldkit/route'

// ---------------------------------------------------------------------------
// the Library filter
// ---------------------------------------------------------------------------

/** Status is one value per stored Status plus `all`, and `scheduled` — which
 *  is not a stored Status but is one of the design's segments (decision 3). A
 *  value the URL does not carry means `all`. */
export const LIBRARY_STATUS_FILTERS = ['all', 'published', 'draft', 'scheduled', 'failed'] as const
export type LibraryStatusFilter = (typeof LIBRARY_STATUS_FILTERS)[number]

/** Ratio is the six supported values plus `any` — a value the URL does not
 *  carry means `any`. */
export const LIBRARY_RATIO_FILTERS = ['any', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'] as const
export type LibraryRatioFilter = (typeof LIBRARY_RATIO_FILTERS)[number]

/** The two orderings the Filter Bar's SORT offers. `newest` is the default and
 *  the URL omits it. */
export const LIBRARY_SORTS = ['newest', 'oldest'] as const
export type LibrarySortValue = (typeof LIBRARY_SORTS)[number]

/** The Library's two views: the table and the tile grid. The same read feeds
 *  both, so this is a view mode over one Library and not a second page. */
export const LIBRARY_VIEWS = ['list', 'grid'] as const
export const LibraryView = S.Literals(LIBRARY_VIEWS)
export type LibraryView = typeof LibraryView.Type

/** The Model's own field schemas, from the same value sets. The Model is
 *  decoded on every render, so a filter is a literal union rather than a bare
 *  string there. */
export const LibraryStatusFilter = S.Literals(LIBRARY_STATUS_FILTERS)
export const LibraryRatioFilter = S.Literals(LIBRARY_RATIO_FILTERS)
export const LibrarySortFilter = S.Literals(LIBRARY_SORTS)

/** The wire's sort for a sort value: `newest` is `takenAt` descending, the
 *  service's default; `oldest` is the same column ascending. */
export const librarySortOf = (
  value: LibrarySortValue,
): { readonly key: 'takenAt'; readonly direction: 'asc' | 'desc' } => ({
  key: 'takenAt',
  direction: value === 'oldest' ? 'asc' : 'desc',
})

/** The Library's filter, as the Model holds it and as the URL carries it.
 *  `page` is a zero-based page number: the URL carries `1` for the second page
 *  and omits it for the first. */
export interface LibraryFilters {
  readonly status: LibraryStatusFilter
  readonly ratio: LibraryRatioFilter
  readonly sort: LibrarySortValue
  readonly q: string
  readonly page: number
  readonly view: LibraryView
}

/** The design's own opening state: every Photo, no ratio filter, nothing
 *  typed, page one, table view, newest first. */
export const defaultLibraryFilters: LibraryFilters = {
  status: 'all',
  ratio: 'any',
  sort: 'newest',
  q: '',
  page: 0,
  view: 'list',
}

/** The query fields, declared once so the Schema and the per-field Options
 *  cannot drift. Each is `OptionFromOptional(String)`: absent means the
 *  default above, and `Optional` is what the query parser hands `query`.
 *  `page` is `FiniteFromString`, so a page that is not a number is a decode
 *  failure the route table turns into `NotFound` rather than a silent zero. */
const libraryQueryFields = {
  status: S.OptionFromOptional(S.String),
  ratio: S.OptionFromOptional(S.String),
  sort: S.OptionFromOptional(S.String),
  q: S.OptionFromOptional(S.String),
  page: S.OptionFromOptional(S.FiniteFromString),
  view: S.OptionFromOptional(LibraryView),
}

export const LibraryQuery = S.Struct(libraryQueryFields)

/** A raw query value offered by this value set, or the default. Unknown values
 *  fall back rather than failing the route: a hand-typed `?status=nope` should
 *  draw the Library, not `NotFound`. */
const pick = <T extends string>(
  values: ReadonlyArray<T>,
  raw: string | undefined,
  fallback: T,
): T => {
  if (raw === undefined) return fallback
  return values.find((value): value is T => value === raw) ?? fallback
}

/** The route as a filter, whichever route it is — every non-Library route
 *  answers the defaults. */
export const libraryFiltersOf = (route: AppRoute): LibraryFilters =>
  route._tag !== 'Library'
    ? defaultLibraryFilters
    : {
        status: pick(LIBRARY_STATUS_FILTERS, Option.getOrUndefined(route.status), 'all'),
        ratio: pick(LIBRARY_RATIO_FILTERS, Option.getOrUndefined(route.ratio), 'any'),
        sort: pick(LIBRARY_SORTS, Option.getOrUndefined(route.sort), 'newest'),
        q: Option.getOrUndefined(route.q) ?? '',
        page: Math.max(0, Math.trunc(Option.getOrUndefined(route.page) ?? 0)),
        view: pick(LIBRARY_VIEWS, Option.getOrUndefined(route.view), 'list'),
      }

/** The filter as the query's per-field Options. A default is omitted, so the
 *  Library's own URL stays `/admin` until something is actually filtered. */
export const libraryQueryOf = (filters: LibraryFilters) => ({
  status: filters.status === 'all' ? Option.none() : Option.some(filters.status),
  ratio: filters.ratio === 'any' ? Option.none() : Option.some(filters.ratio),
  sort: filters.sort === 'newest' ? Option.none() : Option.some(filters.sort),
  q: filters.q === '' ? Option.none() : Option.some(filters.q),
  page: filters.page === 0 ? Option.none() : Option.some(filters.page),
  view: filters.view === 'list' ? Option.none() : Option.some(filters.view),
})

/** Whether two filters select the same rows, ignoring the page. A page move
 *  keeps the selection; a filter change is a claim about a different set, so it
 *  drops it. */
export const sameLibraryFilterSet = (a: LibraryFilters, b: LibraryFilters): boolean =>
  a.status === b.status &&
  a.ratio === b.ratio &&
  a.sort === b.sort &&
  a.q === b.q &&
  a.view === b.view

export const sameLibraryFilters = (a: LibraryFilters, b: LibraryFilters): boolean =>
  sameLibraryFilterSet(a, b) && a.page === b.page

export const AppRoute = defineRouteUnion({
  /** `/admin` — every Photo, and the filter the query string carries.
   *
   *  The design's `Desk Filter Bar` draws a `SCHEDULED` segment, and there is
   *  no publish time in the schema to select on (decision 3). The segment is
   *  still drawn, with no count, and selecting it selects nothing: the query
   *  that would back it — `status = 'draft' AND publishAt > now()` — has no
   *  column to read. #29's Scheduled page is the honest empty state. */
  Library: libraryQueryFields,
  /** `/admin/atoms` — the Desk's design-system sheet: every atom in
   *  `components/ui`, drawn in the page each one belongs to. A surface for
   *  looking at the atoms, not a destination: nothing in the Admin links to
   *  it, and the sidebar's nav is the design's own six rows. */
  Atoms: {},
  /** `/admin/scheduled` — drafts flagged for later publication. Nothing
   *  promotes a scheduled Photo yet (CONTEXT.md, Status), so this route
   *  exists before the page does. */
  Scheduled: {},
  /** `/admin/settings` — the site settings singleton. */
  Settings: {},
  /** `/admin/photos/<id>` — one Photo. */
  Photo: { id: PhotoId },
  /** A URL no admin route names. */
  NotFound: { path: S.String },
})
export type AppRoute = typeof AppRoute.Type

const adminRoot = 'admin'
const admin = literal(adminRoot)

export const libraryRouter = pipe(admin, query(LibraryQuery), mapTo(AppRoute.Library))

export const atomsRouter = pipe(admin, slash(literal('atoms')), mapTo(AppRoute.Atoms))

export const scheduledRouter = pipe(admin, slash(literal('scheduled')), mapTo(AppRoute.Scheduled))

export const settingsRouter = pipe(admin, slash(literal('settings')), mapTo(AppRoute.Settings))

export const photoRouter = pipe(
  admin,
  slash(literal('photos')),
  slash(schemaSegment('id', PhotoId)),
  mapTo(AppRoute.Photo),
)

/** Every admin route. A parser only matches when it consumes the whole path,
 *  so the shared `admin` prefix never shadows a longer route. */
const adminParser = oneOf(photoRouter, settingsRouter, scheduledRouter, atomsRouter, libraryRouter)

/** A route back into its URL. The inverse of {@link urlToAppRoute}, built from
 *  the same routers, so the sidebar's links and the router can never disagree
 *  about what a route is called. `NotFound` is the one route with no router of
 *  its own — it is the path that named none, so it prints as itself. */
export const appRouteToUrl = (route: AppRoute): string =>
  AppRoute.match(route, {
    Library: (filters) => libraryRouter(filters),
    Atoms: () => atomsRouter(),
    Scheduled: () => scheduledRouter(),
    Settings: () => settingsRouter(),
    Photo: ({ id }) => photoRouter({ id }),
    NotFound: ({ path }) => path,
  })

/** The Library route for a filter, and its URL. Named here so the sidebar's
 *  `Library` link, a filter change and a cold load all print the same URL from
 *  the same table. */
export const libraryRoute = (filters: LibraryFilters = defaultLibraryFilters): AppRoute =>
  AppRoute.Library(libraryQueryOf(filters))

export const libraryUrl = (filters: LibraryFilters = defaultLibraryFilters): string =>
  appRouteToUrl(libraryRoute(filters))

/** The view a route asks for. The route is the whole of a URL's meaning, so
 *  this is where the view is read and nowhere else. A route that is not the
 *  Library has no view, and the answer is the default — the table. */
export const libraryViewOf = (route: AppRoute): LibraryView => libraryFiltersOf(route).view

/** The route a URL names. A URL under `/admin` that no route names — a
 *  mistyped path, a photo id that is not one — is `NotFound`, which the Admin
 *  draws. A URL off the Admin entirely is `NotFound` too, but nothing ever
 *  asks: the bundle split and the edge both go through `isAdminPath` first. */
export const urlToAppRoute = parseUrlWithFallback(adminParser, AppRoute.NotFound)

/** Whether a path is in the Admin's URL space — `/admin` and everything under
 *  it, including the paths no route names. Two questions live here rather than
 *  in three call sites, and they are deliberately different: the route table
 *  above answers "which page is this", this answers "is this the Admin's
 *  document at all". A path inside the space that names no route still has to
 *  boot the Admin, or the edge would 404 a URL whose NotFound page is the
 *  client's to draw, and a mistyped admin path would boot the public Front. */
export const isAdminPath = (pathname: string): boolean =>
  pathname === `/${adminRoot}` || pathname.startsWith(`/${adminRoot}/`)
