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

const colsToggle = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('flex items-center gap-1 rounded-full bg-stone-100 p-1 ring-1 ring-stone-200')],
    COL_CHOICES.map((cols) =>
      h.button(
        [
          h.OnClick(M.SelectedCols({ cols })),
          h.Attribute('aria-label', `${String(cols)} columns`),
          h.AriaPressed(String(cols === model.cols)),
          h.Class(
            cols === model.cols
              ? 'rounded-full bg-white px-2.5 py-1 text-xs font-medium text-stone-900 shadow-sm ring-1 ring-stone-200'
              : 'rounded-full px-2.5 py-1 text-xs font-medium text-stone-600 hover:text-stone-900',
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
    [h.Class('sticky top-0 z-20 border-b border-stone-200 bg-white/85 backdrop-blur')],
    [
      h.div(
        [h.Class('mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3')],
        [
          h.div(
            [h.Class('mr-auto flex items-center gap-4')],
            [
              h.a(
                [h.Href('/'), h.Class('text-sm font-semibold tracking-tight hover:text-stone-600')],
                ['photo.elianiva.com'],
              ),
              h.span([h.Class('text-xs uppercase tracking-widest text-stone-400')], ['Admin']),
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
    [h.Class('min-h-screen bg-stone-50 text-stone-900')],
    [
      header(model, h),
      h.main(
        [h.Class('mx-auto max-w-6xl px-6 pb-24')],
        [
          h.h1([h.Class('mt-8 text-2xl font-semibold tracking-tight')], ['Photos']),
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
