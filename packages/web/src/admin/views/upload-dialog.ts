/**
 * Admin upload dialog — the design's Upload Modal (frame `d268defeb1b3791e`,
 * dialog `79b5db1ff22b4be2`). One panel: a drop strip, the queue of Upload
 * Items, the batch options, and a footer whose primary action counts the
 * drafts it will create.
 *
 * The queue is sequential (the design's `1 OF 4 READY · 1 FAILED` is
 * one-at-a-time). `update` marks the next `pending` item `uploading`; the
 * upload itself is the `uploadRun` subscription in `subscriptions.ts`, keyed
 * on exactly that state, so the row is the only place the run is written
 * down. A failed item does not stop the chain — the next `pending` one starts.
 *
 * Four item states, per the design: `done`, `processing` (`AVIF · 2400, 1600,
 * 800 px`, fed by `E6`), `uploading` (a 2px bar and a byte readout), and
 * `failed` (the server's reason, in `--color.accent`). The reason is the
 * server's, not a client-side guess — the Worker's 400 body carries it.
 */

import type { HtmlBuilder } from 'foldkit/html'
import { Check, Image as ImageIcon, X } from 'lucide'

import * as Button from '@/components/ui/button'
import * as Dialog from '@/components/ui/dialog'
import * as DropZone from '@/components/ui/drop-zone'
import * as FileDrop from '@/components/ui/file-drop'
import * as Input from '@/components/ui/input'
import * as ToggleRow from '@/components/ui/toggle-row'

import { icon } from '@/lib/icons'

import { UPLOAD_ACCEPT, UPLOAD_CONSTRAINTS, Message as M, previewStore } from '../model'
import type { Model, Msg, QueueItem } from '../model'
import { embedCombo, formatBytes, type Child } from './shared'

/** The design's constraints strip: one format, one cap. */
const constraints = UPLOAD_CONSTRAINTS

const queueThumbnail = (item: QueueItem, h: HtmlBuilder<Msg>): Child => {
  const preview = previewStore.get(item.id)
  const box =
    'size-12 shrink-0 border border-role-outline-variant bg-role-surface-container object-cover'
  if (preview !== undefined) {
    return h.img([h.Src(preview), h.Alt(''), h.Class(box)])
  }
  // Previews exist only after a client-side drop (SSR renders the fallback).
  return h.div(
    [
      h.Class(
        'flex size-12 shrink-0 items-center justify-center border border-role-outline-variant bg-role-surface-container text-role-text-disabled',
      ),
    ],
    [icon(h, ImageIcon, 'size-4')],
  )
}

/** `3:2 · 6000 × 4000`, once the run has decoded the file's pixels. Empty
 *  until then — the detail line omits what it does not know rather than
 *  inventing a frame. */
const frameDetail = (item: QueueItem): string =>
  item.ratio !== undefined && item.width !== undefined && item.height !== undefined
    ? `${item.ratio} · ${String(item.width)} × ${String(item.height)}`
    : ''

const uploadPercent = (item: QueueItem): number =>
  item.size === 0 ? 0 : Math.min(100, Math.round((item.loaded / item.size) * 100))

const detailText = (item: QueueItem): string => {
  const frame = frameDetail(item)
  switch (item.status) {
    case 'pending':
      return formatBytes(item.size)
    case 'uploading':
      return [`${formatBytes(item.loaded)} of ${formatBytes(item.size)}`, frame]
        .filter((part) => part !== '')
        .join(' · ')
    case 'processing':
      return item.renditionLabel ?? 'Renditions in progress…'
    case 'done':
      return [frame, formatBytes(item.size)].filter((part) => part !== '').join(' · ')
    case 'failed':
      return item.error ?? 'Upload failed'
  }
}

const detailClass = (item: QueueItem): string =>
  item.status === 'failed'
    ? 'type-caption italic text-role-accent'
    : 'type-exif-sm text-role-text-disabled'

/** The right side of the name row: a percent while uploading, the design's
 *  `PROCESSING` kicker, a check when done, or the failed category. */
const rowMeta = (item: QueueItem, h: HtmlBuilder<Msg>): Child => {
  switch (item.status) {
    case 'uploading':
      return h.span(
        [h.Class('shrink-0 type-exif tabular-nums text-role-text-secondary')],
        [`${String(uploadPercent(item))}%`],
      )
    case 'processing':
      return h.span([h.Class('shrink-0 type-kicker text-role-text-secondary')], ['PROCESSING'])
    case 'done':
      return h.span([h.Class('shrink-0 text-role-text-primary')], [icon(h, Check, 'size-3')])
    case 'failed':
      // The design's failed row heads its reason with the category the failure
      // belongs to. The only server-side rejection today is a Ratio the frame
      // cannot be snapped to, which is a crop; anything else is generic.
      return h.span(
        [h.Class('shrink-0 type-kicker text-role-accent')],
        [item.error?.startsWith('Unsupported ratio') === true ? 'CROP' : 'FAILED'],
      )
    case 'pending':
      return h.span([h.Class('shrink-0 type-exif text-role-text-disabled')], ['QUEUED'])
  }
}

/** The 2px bar the design draws under an uploading row. */
const uploadBar = (item: QueueItem, h: HtmlBuilder<Msg>): Child => {
  const percent = uploadPercent(item)
  return h.div(
    [
      h.Class('relative h-0.5 w-full overflow-hidden bg-role-hairline'),
      h.Role('progressbar'),
      h.AriaLabel(`${item.name} upload progress`),
      h.AriaValuemin(0),
      h.AriaValuemax(100),
      h.AriaValuenow(percent),
    ],
    [
      h.div(
        [
          h.Class('h-full bg-role-rule transition-[width] duration-(--motion-duration-fast)'),
          h.Style({ width: `${String(percent)}%` }),
        ],
        [],
      ),
    ],
  )
}

const queueRow = (item: QueueItem, h: HtmlBuilder<Msg>): Child =>
  h.li(
    [
      h.Key(item.id),
      h.Class(
        'flex items-center gap-(--spacing-md) border-b border-role-hairline py-(--spacing-md)',
      ),
    ],
    [
      queueThumbnail(item, h),
      h.div(
        [h.Class('flex min-w-0 flex-1 flex-col gap-1')],
        [
          h.div(
            [h.Class('flex items-center justify-between gap-(--spacing-sm)')],
            [
              h.span(
                [h.Class('min-w-0 flex-1 truncate type-exif text-role-text-primary')],
                [item.name],
              ),
              rowMeta(item, h),
            ],
          ),
          ...(item.status === 'uploading' ? [uploadBar(item, h)] : []),
          h.p([h.Class(`truncate ${detailClass(item)}`)], [detailText(item)]),
        ],
      ),
      ...(item.status === 'failed'
        ? [
            Button.button(
              {
                onClick: M.RetryUpload({ id: item.id }),
                variant: 'ghost',
                attributes: [h.AriaLabel(`Retry ${item.name}`)],
              },
              'Retry',
              h,
            ),
          ]
        : []),
      ...(item.status === 'pending' || item.status === 'failed'
        ? [
            Button.button(
              {
                onClick: M.RemoveQueueItem({ id: item.id }),
                variant: 'ghost',
                attributes: [h.AriaLabel(`Remove ${item.name}`)],
              },
              icon(h, X, 'size-4'),
              h,
            ),
          ]
        : []),
    ],
  )

const uploadOptions = (model: Model, h: HtmlBuilder<Msg>): ReadonlyArray<Child> => [
  h.div(
    [h.Class('flex flex-col gap-1.5')],
    [
      h.span([h.Class('type-kicker text-role-text-secondary')], ['TAGS']),
      // The design's SERIES select is gone (decision 5): grouping is Tags, and
      // this is the picker the dialog already carried.
      embedCombo(model, h),
    ],
  ),
  Input.input(
    {
      id: 'upload-taken-at',
      label: 'TAKEN AT',
      description: 'Applied to every file in this batch — overrides EXIF.',
      type: 'datetime-local',
      value: model.uploadTakenAt,
      onInput: (value) => M.SetUploadTakenAt({ value }),
    },
    h,
  ),
  h.div(
    [h.Class('flex flex-col')],
    [
      // Reads the Settings singleton (fetched when the dialog opens), so a
      // new Photo's export columns are seeded from the stored defaults.
      ToggleRow.toggleRow(
        {
          id: 'upload-use-export-defaults',
          label: 'Use export defaults',
          isChecked: model.uploadUseExportDefaults,
          onToggle: (isChecked) => M.SetUploadUseExportDefaults({ isChecked }),
        },
        h,
      ),
      // Off is the dialog's default, so an upload lands as a draft. Turning it
      // on publishes at creation.
      ToggleRow.toggleRow(
        {
          id: 'upload-publish-when-ready',
          label: 'Publish when ready',
          isChecked: model.uploadPublishWhenReady,
          onToggle: (isChecked) => M.SetUploadPublishWhenReady({ isChecked }),
        },
        h,
      ),
    ],
  ),
]

/** The footer's counts, computed once so the view and its tests read the same
 *  numbers. `draftCount` is what the primary label counts: every queued file
 *  that is not a failure. */
export interface UploadFooterSummary {
  readonly ready: number
  readonly failed: number
  readonly pending: number
  readonly total: number
  readonly draftCount: number
}

export const uploadFooterSummary = (model: Model): UploadFooterSummary => {
  const ready = model.queue.filter(
    (item) => item.status === 'done' || item.status === 'processing',
  ).length
  const failed = model.queue.filter((item) => item.status === 'failed').length
  const pending = model.queue.filter((item) => item.status === 'pending').length
  return {
    ready,
    failed,
    pending,
    // The run's snapshot once it has started, so a removal mid-batch cannot
    // move the denominator; the queue's own length before that.
    total: model.batchTotal > 0 ? model.batchTotal : model.queue.length,
    draftCount: model.queue.length - failed,
  }
}

/** `1 OF 4 READY · 1 FAILED`, the design's status line. */
export const uploadFooterStatus = (summary: UploadFooterSummary): string =>
  `${String(summary.ready)} OF ${String(summary.total)} READY · ${String(summary.failed)} FAILED`

/** The primary's label: the drafts it will create. */
export const uploadPrimaryLabel = (summary: UploadFooterSummary): string =>
  `Add ${String(summary.draftCount)} to drafts`

const uploadFooter = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const summary = uploadFooterSummary(model)
  const primaryLabel = uploadPrimaryLabel(summary)

  const onPrimary: Msg =
    summary.pending > 0
      ? M.StartUploads()
      : M.GotUploadDialogMessage({ message: Dialog.Message.RequestedClose() })
  const onCancel = model.uploading
    ? M.CancelUploads()
    : M.GotUploadDialogMessage({ message: Dialog.Message.RequestedClose() })

  return Dialog.footer(
    { className: 'mt-(--spacing-md)' },
    [
      h.div(
        [h.Class('flex flex-wrap items-center gap-(--spacing-sm)')],
        [
          h.span(
            [
              h.Class('type-exif text-role-text-disabled'),
              h.DataAttribute('slot', 'upload-footer-status'),
            ],
            [uploadFooterStatus(summary)],
          ),
          ...(summary.failed > 0
            ? [
                Button.button(
                  { onClick: M.RetryAllFailed(), variant: 'ghost' },
                  `Retry all (${String(summary.failed)})`,
                  h,
                ),
              ]
            : []),
        ],
      ),
      h.div(
        [h.Class('flex items-center gap-(--spacing-sm)')],
        [
          Button.button({ onClick: onCancel, variant: 'secondary' }, 'Cancel', h),
          Button.button(
            {
              onClick: onPrimary,
              isDisabled: model.uploading || summary.draftCount === 0,
            },
            primaryLabel,
            h,
          ),
        ],
      ),
    ],
    h,
  )
}

const uploadDialogContent = (
  model: Model,
  render: Dialog.DialogContent<Msg>,
  h: HtmlBuilder<Msg>,
): ReadonlyArray<Child> => {
  const hasQueue = model.queue.length > 0
  const uploading = model.queue.find((item) => item.status === 'uploading')
  return [
    h.div(
      [h.Class('flex items-start justify-between gap-(--spacing-sm)')],
      [
        Dialog.title({ attributes: render.title }, ['Upload photographs'], h),
        Dialog.closeButton({ attributes: render.closeButton }, [icon(h, X)], h),
      ],
    ),
    Dialog.description(
      { attributes: render.description },
      ['JPEG only. Dimensions and EXIF are read server-side.'],
      h,
    ),
    h.submodel({
      slotId: 'admin-file-drop',
      model: model.fileDrop,
      view: FileDrop.view,
      viewInputs: DropZone.dropZone(
        {
          message: hasQueue ? 'Add more photographs' : 'Drop photographs or browse',
          constraints,
          multiple: true,
          accept: UPLOAD_ACCEPT,
        },
        h,
      ),
      toParentMessage: (message) => M.GotFileDropMessage({ message }),
    }),
    ...(hasQueue
      ? [
          h.ul(
            [h.Class('flex flex-col')],
            model.queue.map((item) => queueRow(item, h)),
          ),
          h.div([h.Class('flex flex-col gap-(--spacing-md)')], uploadOptions(model, h)),
          // Announce the run for screen readers; the bars are per-item.
          ...(uploading !== undefined
            ? [
                h.p(
                  [h.Role('status'), h.AriaLive('polite'), h.Class('sr-only')],
                  [`Uploading ${uploading.name} — ${String(uploadPercent(uploading))} per cent`],
                ),
              ]
            : []),
          uploadFooter(model, h),
        ]
      : []),
  ]
}

export const uploadDialog = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.submodel({
    slotId: 'admin-upload-dialog',
    model: model.uploadDialog,
    view: Dialog.view,
    viewInputs: Dialog.styledViewInputs<Msg>(
      {
        className: 'items-start pt-[8vh]',
        panelClass: 'w-full max-w-[600px] max-h-[84vh] overflow-y-auto',
        content: (render, innerH) => uploadDialogContent(model, render, innerH),
      },
      h,
    ),
    toParentMessage: (message) => M.GotUploadDialogMessage({ message }),
  })
