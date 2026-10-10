/**
 * Admin view root: the shell every route renders inside. Two columns — the
 * sidebar (brand, nav, session footer) and the page column, which opens
 * with the Page Head and continues into the route's own page. The app-level
 * overlays (upload Dialog, confirm AlertDialog, toast stack) sit on top of
 * both. The page itself is chosen by the route in `views/pages.ts`.
 *
 * The root element carries the theme scope, read off the route the Model
 * already holds. `data-theme="dark"` re-themes this whole subtree and nothing
 * above it, which is how the Editor sits dark inside a document the public
 * home page shares — see `lib/theme.ts`.
 *
 * A session the API could not verify replaces the whole shell rather than
 * sitting in a corner of it: there is no signed-out state, so a page that
 * renders at all is a page whose Access session is proven.
 *
 * The Editor is the one route that is not this shell. It is full-bleed and dark
 * with no sidebar, so it is a document of its own (`views/editor.ts`) chosen
 * here rather than a page rendered inside the shell with the sidebar
 * conditionally hidden — which keeps the shell's own structure untouched and
 * puts the one route switch in one place.
 */

import type { Document, HtmlBuilder } from 'foldkit/html'

import { scopeTheme, themeForRoute } from '@/lib/theme'

import type { Model, Msg } from './model'
import { editorDocument } from './views/editor'
import { confirmDialog, toastStack } from './views/overlays'
import { documentTitle, pageHead } from './views/page-head'
import { routePage } from './views/pages'
import { sessionExpired } from './views/session'
import { sidebar } from './views/sidebar'
import { GUTTER } from './views/shared'
import { uploadDialog } from './views/upload-dialog'

const shell = (model: Model, h: HtmlBuilder<Msg>): Document => ({
  title: documentTitle(model),
  body: h.div(
    [
      scopeTheme(themeForRoute(model.route), h),
      h.Class('bg-role-surface flex min-h-dvh text-role-text-primary'),
    ],
    [
      sidebar(model, h),
      h.div(
        [h.Class('flex min-w-0 flex-1 flex-col')],
        [
          pageHead(model, h, GUTTER),
          h.main([h.Class(`${GUTTER} flex-1 pb-24`)], [routePage(model, h)]),
        ],
      ),
      uploadDialog(model, h),
      confirmDialog(model, h),
      toastStack(model, h),
    ],
  ),
})

export const view = (model: Model, h: HtmlBuilder<Msg>): Document =>
  model.session.status === 'expired'
    ? sessionExpired(h, model.route)
    : model.route._tag === 'Photo'
      ? editorDocument(model, h)
      : shell(model, h)
