/**
 * Admin view root: the shell every route renders inside — header (brand +
 * Upload), the route's own page, and the app-level overlays (edit Sheet,
 * upload Dialog, confirm AlertDialog, toast stack) plus the Library's
 * lightbox. The page itself is chosen by the route in `views/pages.ts`.
 *
 * The root element carries the theme scope, read off the route the Model
 * already holds. `data-theme="dark"` re-themes this whole subtree and nothing
 * above it, which is how the Editor sits dark inside a document the public
 * front page shares — see `lib/theme.ts`.
 */

import type { Document, HtmlBuilder } from 'foldkit/html'

import * as Button from '@/components/ui/button'
import * as Spinner from '@/components/ui/spinner'
import { scopeTheme, themeForRoute } from '@/lib/theme'

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

/** The design's `Segment`: 28px of 4/12 padding, `$typography.exif`, no
 *  container box and no corner radius. The chosen step fills with
 *  `color.primary` and reads in `color.on-primary`. */
const colsToggle = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('flex items-center'), h.Role('group'), h.AriaLabel('Grid density')],
    COL_CHOICES.map((cols) =>
      h.button(
        [
          h.OnClick(M.SelectedCols({ cols })),
          h.AriaLabel(`${String(cols)} columns`),
          h.AriaPressed(String(cols === model.cols)),
          h.Class(
            cols === model.cols
              ? 'bg-role-primary px-(--spacing-md) py-(--spacing-xs) type-exif text-role-on-primary'
              : 'px-(--spacing-md) py-(--spacing-xs) type-exif text-role-text-secondary transition-colors duration-(--motion-duration-fast) hover:text-role-text-primary',
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
        [
          h.Class(
            `${GUTTER} flex flex-wrap items-center gap-x-(--spacing-lg) gap-y-(--spacing-sm) py-(--spacing-sm)`,
          ),
        ],
        [
          h.div(
            [h.Class('mr-auto flex items-center gap-(--spacing-sm)')],
            [
              h.a(
                [
                  h.Href('/'),
                  h.Class(
                    'type-ui text-role-text-primary hover:text-role-text-secondary transition-colors duration-(--motion-duration-fast)',
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
                    variant: 'secondary',
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
          Button.button({ onClick: M.OpenUpload() }, 'Upload photos', h),
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
    Atoms: () => 'Atoms — Admin',
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
    [
      scopeTheme(themeForRoute(model.route), h),
      h.Class('min-h-screen bg-role-surface text-role-text-primary'),
    ],
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
