/**
 * Admin view root: the shell every route renders inside — header (brand +
 * Upload), the route's own page, and the app-level overlays (edit Sheet,
 * upload Dialog, confirm AlertDialog, toast stack) plus the Library's
 * lightbox. The page itself is chosen by the route in `views/pages.ts`.
 */

import type { Document, HtmlBuilder } from 'foldkit/html'

import * as Button from '@/components/ui/button'
import * as Spinner from '@/components/ui/spinner'

import { Message as M } from './model'
import type { Model, Msg } from './model'
import { AppRoute } from './route'
import { editSheet } from './views/edit-sheet'
import { lightbox } from './views/lightbox'
import { confirmDialog, toastStack } from './views/overlays'
import { routePage } from './views/pages'
import type { Child } from './views/shared'
import { GUTTER } from './views/shared'
import { uploadDialog } from './views/upload-dialog'

// ---------------------------------------------------------------------------
// grid density toggle: square-tile column count (2–6), persisted on change
// ---------------------------------------------------------------------------

const COL_CHOICES = [2, 3, 4, 5, 6] as const

const colsToggle = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [
      h.Class(
        'flex items-center gap-1 rounded-full bg-role-surface-container p-1 ring-1 ring-role-outline-variant',
      ),
    ],
    COL_CHOICES.map((cols) =>
      h.button(
        [
          h.OnClick(M.SelectedCols({ cols })),
          h.Attribute('aria-label', `${String(cols)} columns`),
          h.AriaPressed(String(cols === model.cols)),
          h.Class(
            cols === model.cols
              ? 'rounded-full bg-role-surface px-2.5 py-1 text-xs font-medium text-role-text-primary shadow-sm ring-1 ring-role-outline-variant'
              : 'rounded-full px-2.5 py-1 text-xs font-medium text-role-text-secondary hover:text-role-text-primary',
          ),
        ],
        [String(cols)],
      ),
    ),
  )

// ---------------------------------------------------------------------------
// header: brand + grid density toggle + upload button (search lives nowhere —
// tags are the filter)
// ---------------------------------------------------------------------------

const header = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.header(
    [h.Class('sticky top-0 z-20 border-b border-role-hairline bg-role-surface/85 backdrop-blur')],
    [
      h.div(
        [h.Class(`${GUTTER} flex flex-wrap items-center gap-x-6 gap-y-3 py-3`)],
        [
          h.div(
            [h.Class('mr-auto flex items-center gap-4')],
            [
              h.a(
                [
                  h.Href('/'),
                  h.Class(
                    'type-ui font-firm text-role-text-primary hover:text-role-text-secondary transition-colors duration-(--motion-duration-fast)',
                  ),
                ],
                ['photo.elianiva.com'],
              ),
              h.span([h.Class('type-kicker text-role-text-disabled')], ['Admin']),
            ],
          ),
          colsToggle(model, h),
          ...(model.uploading
            ? [
                // A batch keeps running after the dialog closes — surface it
                // here so the header is the place to get back to it.
                Button.button(
                  {
                    onClick: M.OpenUpload(),
                    variant: 'outline',
                    size: 'sm',
                  },
                  h.span(
                    [h.Class('inline-flex items-center gap-1.5')],
                    [
                      Spinner.spinner({ className: 'size-3' }, h),
                      `Uploading ${String(model.queue.filter((item) => item.status === 'done').length)}/${String(model.batchTotal)}`,
                    ],
                  ),
                  h,
                ),
              ]
            : []),
          Button.button({ onClick: M.OpenUpload(), size: 'sm' }, 'Upload photos', h),
        ],
      ),
    ],
  )

// ---------------------------------------------------------------------------
// document
// ---------------------------------------------------------------------------

const SUFFIX = ' — Admin'

const routeTitle = (model: Model): string =>
  AppRoute.match(model.route, {
    Library: () => 'Admin — photo.elianiva.com',
    Drafts: () => `Drafts${SUFFIX}`,
    Settings: () => `Settings${SUFFIX}`,
    Photo: () =>
      model.photoStatus === 'ready' && model.photo !== undefined
        ? `${model.photo.title}${SUFFIX}`
        : `Photo${SUFFIX}`,
    NotFound: () => `Not found${SUFFIX}`,
  })

export const view = (model: Model, h: HtmlBuilder<Msg>): Document => ({
  title: routeTitle(model),
  body: h.div(
    [h.Class('min-h-screen bg-role-surface text-role-text-primary')],
    [
      header(model, h),
      h.main([h.Class(`${GUTTER} pb-(--spacing-5xl)`)], [routePage(model, h)]),
      editSheet(model, h),
      uploadDialog(model, h),
      confirmDialog(model, h),
      toastStack(model, h),
      ...(model.selectedId !== null ? [lightbox(model, h)] : []),
    ],
  ),
})
