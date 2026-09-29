/**
 * Admin view root: the shell every route renders inside. Two columns — the
 * sidebar (brand, nav, tags, session footer) and the page column, which opens
 * with the Page Head and continues into the route's own page. The app-level
 * overlays (edit Sheet, upload Dialog, tag actions, confirm AlertDialog, toast
 * stack) plus the Library's lightbox sit on top of both. The page itself is
 * chosen by the route in `views/pages.ts`.
 *
 * The root element carries the theme scope, read off the route the Model
 * already holds. `data-theme="dark"` re-themes this whole subtree and nothing
 * above it, which is how the Editor sits dark inside a document the public
 * front page shares — see `lib/theme.ts`.
 *
 * A session the API could not verify replaces the whole shell rather than
 * sitting in a corner of it: there is no signed-out state, so a page that
 * renders at all is a page whose Access session is proven.
 */

import type { Document, HtmlBuilder } from 'foldkit/html'

import { scopeTheme, themeForRoute } from '@/lib/theme'

import type { Model, Msg } from './model'
import { editSheet } from './views/edit-sheet'
import { lightbox } from './views/lightbox'
import { confirmDialog, toastStack } from './views/overlays'
import { documentTitle, pageHead } from './views/page-head'
import { routePage } from './views/pages'
import { sessionExpired } from './views/session'
import { sidebar, tagActionsDialog } from './views/sidebar'
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
          h.main([h.Class(`${GUTTER} flex-1 pb-(--spacing-5xl)`)], [routePage(model, h)]),
        ],
      ),
      tagActionsDialog(model, h),
      editSheet(model, h),
      uploadDialog(model, h),
      confirmDialog(model, h),
      toastStack(model, h),
      ...(model.selectedId !== null ? [lightbox(model, h)] : []),
    ],
  ),
})

export const view = (model: Model, h: HtmlBuilder<Msg>): Document =>
  model.session.status === 'expired' ? sessionExpired(h) : shell(model, h)
