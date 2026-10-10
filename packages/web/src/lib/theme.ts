/**
 * Theme scope. The design system has two branches, `light` and
 * `dark`, and `theme.css` declares both as plain custom properties under a
 * scope selector. A theme is therefore a matter of naming the scope on the
 * element the app is rendered into, not of shipping a second palette.
 *
 * `.dark` on the document root is the same block spelled as a class; the
 * Editor uses the attribute so it can be dark as a subtree while the Library
 * around it stays light.
 *
 * The branch is a function of the route, never a second copy of the path. The
 * route table is the one place the Admin's URL space is declared, so a URL the
 * router matches is a URL the theme agrees about — there is no prefix string
 * here that can fall behind the router the way one did when the Editor route
 * was still singular.
 *
 * The scope has to be named by the view rather than toggled after mount,
 * because the first paint is the one that must not flash. The view names it on
 * the app root; the shell names it on `<html>`, which is the only element
 * there is before the app has run.
 */

import { Option, Schema as S } from 'effect'
import type { Attribute, HtmlBuilder } from 'foldkit/html'
import { fromString as urlFromString } from 'foldkit/url'

import { AppRoute, urlToAppRoute } from '@/admin/route'

export const Theme = S.Literals(['light', 'dark'])
export type Theme = typeof Theme.Type

/** The attribute the theme scopes key off. */
export const themeAttribute = 'data-theme'

/** Where the operator's choice of Desk theme is kept. The shell's inline
 *  script in `index.html` reads the same key before first paint. */
export const THEME_STORAGE_KEY = 'photo-admin:theme'

/** The theme the Desk is drawn in until the operator picks the other. */
export const DEFAULT_ADMIN_THEME: Theme = 'dark'

/** The operator's stored Desk theme, or the default. Synchronous because
 *  Foldkit's `init` is, and total: a storage that throws or holds something
 *  else is the default rather than a broken first paint. */
export const storedAdminTheme = (): Theme => {
  if (typeof window === 'undefined') return DEFAULT_ADMIN_THEME
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    return raw === 'light' || raw === 'dark' ? raw : DEFAULT_ADMIN_THEME
  } catch {
    return DEFAULT_ADMIN_THEME
  }
}

/** The theme branch a route is drawn in. The Desk follows `adminTheme`, the
 *  operator's choice. The Editor is the exception: it is the dark room whatever
 *  the choice, and has no sidebar to change it from. A URL outside `/admin` is
 *  the public site's and stays light — so a route the table gains later is
 *  light until someone says otherwise. */
export const themeForRoute = (route: AppRoute, adminTheme: Theme = DEFAULT_ADMIN_THEME): Theme =>
  AppRoute.matchOrElse(
    route,
    {
      Library: (): Theme => adminTheme,
      Scheduled: (): Theme => adminTheme,
      Settings: (): Theme => adminTheme,
      Atoms: (): Theme => adminTheme,
      Photo: (): Theme => 'dark',
      // The Admin's own 404 is a page of the Desk; the public site's is not.
      NotFound: ({ path }): Theme =>
        path === '/admin' || path.startsWith('/admin/') ? adminTheme : 'light',
    },
    (): Theme => 'light',
  )

/** The theme branch a request URL is answered in. Goes through the same
 *  route table as the view, so the shell and the app cannot name two
 *  different branches for one URL. A URL that is not a URL at all is light. */
export const themeForUrl = (url: string): Theme => {
  const parsed = urlFromString(url)
  return Option.isNone(parsed) ? 'light' : themeForRoute(urlToAppRoute(parsed.value))
}

/** Persist the Desk theme. Failing to remember a preference is not something
 *  the operator can act on, so a blocked storage is swallowed. */
export const writeAdminTheme = (theme: Theme): void => {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // see above
  }
}

/** The scope attribute for a branch, as a foldkit attribute. */
export const scopeTheme = <M>(theme: Theme, h: HtmlBuilder<M>): Attribute<M> =>
  h.Attribute(themeAttribute, theme)

/** Name the branch on a shell's document element. The Admin is answered with
 *  the shell string rather than an app render, so its first paint's theme is
 *  a string edit on `<html>`; the view names the same attribute on the app
 *  root for every paint after it. */
export const themeDocument = (html: string, theme: Theme): string =>
  html.replace(/<html(\s[^>]*)?>/, `<html$1 ${themeAttribute}="${theme}">`)
