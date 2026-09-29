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

import { Schema as S, pipe } from 'effect'
import { PhotoId } from '@photo/shared'
import {
  defineRouteUnion,
  literal,
  mapTo,
  oneOf,
  parseUrlWithFallback,
  schemaSegment,
  slash,
} from 'foldkit/route'

export const AppRoute = defineRouteUnion({
  /** `/admin` — every Photo. */
  Library: {},
  /** `/admin/atoms` — the Desk's design-system sheet: every atom in
   *  `components/ui`, drawn in the page each one belongs to. Nothing links to
   *  it yet; the sidebar arrives with #24. */
  Atoms: {},
  /** `/admin/drafts` — Photos that are not published. */
  Drafts: {},
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

export const libraryRouter = pipe(admin, mapTo(AppRoute.Library))

export const atomsRouter = pipe(admin, slash(literal('atoms')), mapTo(AppRoute.Atoms))

export const draftsRouter = pipe(admin, slash(literal('drafts')), mapTo(AppRoute.Drafts))

export const settingsRouter = pipe(admin, slash(literal('settings')), mapTo(AppRoute.Settings))

export const photoRouter = pipe(
  admin,
  slash(literal('photos')),
  slash(schemaSegment('id', PhotoId)),
  mapTo(AppRoute.Photo),
)

/** Every admin route. A parser only matches when it consumes the whole path,
 *  so the shared `admin` prefix never shadows a longer route. */
const adminParser = oneOf(photoRouter, settingsRouter, draftsRouter, atomsRouter, libraryRouter)

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
