/**
 * Admin view root: header (brand + Upload), tag filter bar (chips with
 * counts + result line), and composition of the region views in `views/`
 * (justified day-grouped grid, lightbox, edit Sheet, upload Dialog, confirm
 * AlertDialog, toast stack). Header and content share one max-width
 * container so their edges align.
 */

import type { Document, HtmlBuilder } from 'foldkit/html'
import type { Tag } from '@photo/shared'

import * as Button from '@/components/ui/button'
import * as Spinner from '@/components/ui/spinner'

import { Message as M } from './model'
import type { Model, Msg } from './model'
import { editSheet } from './views/edit-sheet'
import { grid } from './views/grid'
import { lightbox } from './views/lightbox'
import { confirmDialog, toastStack } from './views/overlays'
import * as TagManager from './tag-manager'
import type { Child } from './views/shared'
import { uploadDialog } from './views/upload-dialog'

// ---------------------------------------------------------------------------
// grid density toggle: square-tile column count (2–6), persisted on change
// ---------------------------------------------------------------------------

const COL_CHOICES = [2, 3, 4, 5, 6] as const

/** The design system's page margin, and the content column the header aligns to. */
const GUTTER =
  'mx-auto w-full max-w-(--layout-content-max) px-(--layout-margin-mobile) sm:px-(--layout-margin)'

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
// filter bar: TagManager submodel (chips with counts + inline create +
// result line). No "All photos" pill — an empty chip selection *is* all
// photos; the count line states it.
// ---------------------------------------------------------------------------

const filterBar = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const activeLabel = model.tags.find((tag) => tag.slug === model.activeTagSlug)?.label
  return h.submodel({
    slotId: 'admin-tag-manager',
    model: model.tagManager,
    view: TagManager.view,
    viewInputs: {
      tags: model.tags,
      // Counts describe the loaded result set, so they only mean something
      // unfiltered — a filtered list would repeat the same count on every chip.
      ...(model.activeTagSlug === undefined
        ? {
            countFor: (tag: Tag): number =>
              model.photos.filter((photo) =>
                (photo.tags ?? []).some((entry) => entry.id === tag.id),
              ).length,
          }
        : { activeSlug: model.activeTagSlug }),
      resultText: `${String(model.photos.length)} photo${model.photos.length === 1 ? '' : 's'}${
        activeLabel !== undefined ? ` · filtered by “${activeLabel}”` : ''
      }`,
    },
    toParentMessage: (message) => M.GotTagManagerMessage({ message }),
  })
}

// ---------------------------------------------------------------------------
// document
// ---------------------------------------------------------------------------

export const view = (model: Model, h: HtmlBuilder<Msg>): Document => ({
  title: 'Admin — photo.elianiva.com',
  body: h.div(
    [h.Class('min-h-screen bg-role-surface text-role-text-primary')],
    [
      header(model, h),
      h.main(
        [h.Class(`${GUTTER} pb-(--spacing-5xl)`)],
        [
          h.h1([h.Class('mt-(--spacing-2xl) type-section text-role-text-primary')], ['Photos']),
          filterBar(model, h),
          grid(model, h),
        ],
      ),
      editSheet(model, h),
      uploadDialog(model, h),
      confirmDialog(model, h),
      toastStack(model, h),
      ...(model.selectedId !== null ? [lightbox(model, h)] : []),
    ],
  ),
})
