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

/** The Library's two views: the table and the tile grid. The same read feeds
 *  both, so this is a view mode over one Library and not a second page. */
export const LibraryView = S.Literals(['list', 'grid'])
export type LibraryView = typeof LibraryView.Type

/** The Library's query string. `view` is the only parameter the Library carries
 *  today; #26 adds the filter set (status, ratio, sort, tag, q, page) to this
 *  same Struct. Absence is the default, so `/admin` is the table and
 *  `?view=grid` is the grid. */
export const LibraryQuery = S.Struct({
  view: S.OptionFromOptional(LibraryView),
})
export type LibraryQuery = typeof LibraryQuery.Type

export const AppRoute = defineRouteUnion({
  /** `/admin` — every Photo. `?view=grid` draws it as tiles. */
  Library: LibraryQuery.fields,
  /** `/admin/atoms` — the Desk's design-system sheet: every atom in
   *  `components/ui`, drawn in the page each one belongs to. A surface for
   *  looking at the atoms, not a destination: nothing in the Admin links to
   *  it, and the sidebar's nav is the design's own six rows. */
  Atoms: {},
  /** `/admin/drafts` — Photos that are not published. */
  Drafts: {},
  /** `/admin/scheduled` — drafts flagged for later publication. Nothing
   *  promotes a scheduled Photo yet (CONTEXT.md, Status), so this route
   *  exists before the page does. */
  Scheduled: {},
  /** `/admin/uploads` — the upload queue. */
  Uploads: {},
  /** `/admin/trash` — soft-deleted Photos. */
  Trash: {},
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

export const draftsRouter = pipe(admin, slash(literal('drafts')), mapTo(AppRoute.Drafts))

export const scheduledRouter = pipe(admin, slash(literal('scheduled')), mapTo(AppRoute.Scheduled))

export const uploadsRouter = pipe(admin, slash(literal('uploads')), mapTo(AppRoute.Uploads))

export const trashRouter = pipe(admin, slash(literal('trash')), mapTo(AppRoute.Trash))

export const settingsRouter = pipe(admin, slash(literal('settings')), mapTo(AppRoute.Settings))

export const photoRouter = pipe(
  admin,
  slash(literal('photos')),
  slash(schemaSegment('id', PhotoId)),
  mapTo(AppRoute.Photo),
)

/** Every admin route. A parser only matches when it consumes the whole path,
 *  so the shared `admin` prefix never shadows a longer route. */
const adminParser = oneOf(
  photoRouter,
  settingsRouter,
  trashRouter,
  scheduledRouter,
  uploadsRouter,
  draftsRouter,
  atomsRouter,
  libraryRouter,
)

/** A route back into its URL. The inverse of {@link urlToAppRoute}, built from
 *  the same routers, so the sidebar's links and the router can never disagree
 *  about what a route is called. `NotFound` is the one route with no router of
 *  its own — it is the path that named none, so it prints as itself. */
export const appRouteToUrl = (route: AppRoute): string =>
  AppRoute.match(route, {
    Library: ({ view }) => libraryRouter({ view }),
    Atoms: () => atomsRouter(),
    Drafts: () => draftsRouter(),
    Scheduled: () => scheduledRouter(),
    Uploads: () => uploadsRouter(),
    Trash: () => trashRouter(),
    Settings: () => settingsRouter(),
    Photo: ({ id }) => photoRouter({ id }),
    NotFound: ({ path }) => path,
  })

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

/** The Library route at a view, with the default (the table) named by
 *  omission so a bare `/admin` stays the plain URL. */
export const libraryRoute = (view?: LibraryView): AppRoute =>
  AppRoute.Library({
    view: view === undefined || view === 'list' ? Option.none() : Option.some(view),
  })

/** The Library's URL at a view. The same table that parsed the URL prints it,
 *  so a link and the toggle cannot disagree about what a view is called. */
export const libraryUrl = (view?: LibraryView): string => appRouteToUrl(libraryRoute(view))

/** The view a route asks for. The route is the whole of a URL's meaning, so
 *  this is where the view is read and nowhere else. A route that is not the
 *  Library has no view, and the answer is the default — the table. */
export const libraryViewOf = (route: AppRoute): LibraryView => {
  if (route._tag !== 'Library') return 'list'
  return Option.isSome(route.view) ? route.view.value : 'list'
}
