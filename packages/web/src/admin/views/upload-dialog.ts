/**
 * Admin upload dialog: FileDrop zone plus the upload queue — per-item
 * previews, status badges, retry/remove/stop actions, batch tag/taken-at
 * inputs, and a run-scoped progress bar.
 *
 * Layout notes: the panel is the only scroll container (the queue list grows
 * naturally); the drop zone collapses to a slim "add more" strip once files
 * are queued so it stops competing with the list for vertical space.
 */

import type { HtmlBuilder } from 'foldkit/html'
import { Image as ImageIcon, X } from 'lucide'

import * as Badge from '@/components/ui/badge'
import * as Button from '@/components/ui/button'
import * as Dialog from '@/components/ui/dialog'
import * as FileDrop from '@/components/ui/file-drop'
import * as Input from '@/components/ui/input'
import * as Spinner from '@/components/ui/spinner'

import { icon } from '@/lib/icons'

import { UPLOAD_LIMITS, Message as M, previewStore } from '../model'
import type { Model, Msg, QueueItem } from '../model'
import { photoCountLabel } from '../helpers'
import { embedCombo, formatBytes, type Child } from './shared'

const statusBadge = (item: QueueItem, h: HtmlBuilder<Msg>): Child => {
  if (item.status === 'uploading') {
    // One badge carrying spinner + text — a spinner beside a badge reading
    // the same thing doubles the visual (and screen-reader) noise.
    return Badge.badge(
      { variant: 'default' },
      [
        h.span(
          [h.Class('inline-flex items-center gap-1.5')],
          [Spinner.spinner({ className: 'size-3' }, h), 'Uploading…'],
        ),
      ],
      h,
    )
  }
  const map: Record<
    Exclude<QueueItem['status'], 'uploading'>,
    { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
  > = {
    pending: { label: 'Queued', variant: 'secondary' },
    done: { label: 'Done', variant: 'outline' },
    failed: { label: 'Failed', variant: 'destructive' },
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- narrowing from QueueStatus union
  const config = map[item.status as Exclude<QueueItem['status'], 'uploading'>]
  return Badge.badge({ variant: config.variant }, [config.label], h)
}

const queueThumbnail = (item: QueueItem, h: HtmlBuilder<Msg>): Child => {
  const preview = previewStore.get(item.id)
  if (preview !== undefined) {
    return h.img([
      h.Src(preview),
      h.Alt(''),
      h.Class('size-10 shrink-0 rounded-md border border-stone-200 bg-stone-100 object-cover'),
    ])
  }
  // Previews exist only after a client-side drop (SSR renders the fallback).
  return h.div(
    [
      h.Class(
        'flex size-10 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-stone-100 text-stone-400',
      ),
    ],
    [icon(h, ImageIcon, 'size-4')],
  )
}

const queueRow = (item: QueueItem, h: HtmlBuilder<Msg>): Child =>
  h.li(
    [
      h.Key(item.id),
      h.Class('flex items-center gap-3 rounded-lg border border-stone-200 px-3 py-2'),
    ],
    [
      queueThumbnail(item, h),
      h.div(
        [h.Class('min-w-0 flex-1')],
        [
          h.p([h.Class('truncate text-sm font-medium')], [item.name]),
          h.p(
            [h.Class('truncate text-xs text-stone-500')],
            [
              item.error !== undefined
                ? `${formatBytes(item.size)} — ${item.error}`
                : formatBytes(item.size),
            ],
          ),
        ],
      ),
      statusBadge(item, h),
      ...(item.status === 'failed'
        ? [
            Button.button(
              {
                onClick: M.RetryUpload({ id: item.id }),
                variant: 'ghost',
                size: 'sm',
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
                size: 'sm',
                attributes: [h.AriaLabel(`Remove ${item.name}`)],
              },
              icon(h, X, 'size-4'),
              h,
            ),
          ]
        : []),
    ],
  )

/** Drop-zone body: full call-to-action before anything is queued, then a
 *  slim one-liner — constraints stay visible either way. */
const dropZoneContent = (hasQueue: boolean, h: HtmlBuilder<Msg>): ReadonlyArray<Child> => {
  const limits = `up to ${String(UPLOAD_LIMITS.maxFiles)} files · ${String(UPLOAD_LIMITS.maxFileSize / (1024 * 1024))} MB each`
  if (hasQueue) {
    return [
      h.span([h.Class('text-sm font-medium')], ['Add more images']),
      h.span([h.Class('text-xs text-muted-foreground')], [`drag here or click · ${limits}`]),
    ]
  }
  return [
    h.p([h.Class('text-base font-medium')], ['Drag & drop images here']),
    h.p(
      [h.Class('mt-1 text-sm text-muted-foreground')],
      [`or click to browse · JPEG, PNG, WebP, GIF, AVIF · ${limits}`],
    ),
  ]
}

const uploadDialogContent = (
  model: Model,
  render: Dialog.DialogContent<Msg>,
  h: HtmlBuilder<Msg>,
): ReadonlyArray<Child> => {
  const pendingCount = model.queue.filter((item) => item.status === 'pending').length
  const failedCount = model.queue.filter((item) => item.status === 'failed').length
  const doneCount = model.queue.filter((item) => item.status === 'done').length
  const hasQueue = model.queue.length > 0
  // Progress is measured against the snapshot taken when this run started,
  // not the live queue length — removals mid-batch must not move it, and
  // failures count as settled so the bar can actually reach 100%.
  const settledCount = doneCount + failedCount
  const progressPercent =
    model.batchTotal === 0 ? 0 : Math.min(100, Math.round((settledCount / model.batchTotal) * 100))
  return [
    h.div(
      [h.Class('flex flex-col gap-4')],
      [
        h.div(
          [h.Class('flex items-start justify-between gap-2')],
          [
            Dialog.title({ attributes: render.title }, ['Upload photos'], h),
            Dialog.closeButton({ attributes: render.closeButton }, [icon(h, X)], h),
          ],
        ),
        Dialog.description(
          { attributes: render.description },
          ['Drop images below — dimensions and EXIF are extracted server-side.'],
          h,
        ),
        h.submodel({
          slotId: 'admin-file-drop',
          model: model.fileDrop,
          view: FileDrop.view,
          viewInputs: FileDrop.styledViewInputs<Msg>(
            {
              multiple: true,
              accept: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
              content: dropZoneContent(hasQueue, h),
              ...(hasQueue
                ? { className: 'flex-row justify-start gap-3 px-4 py-3 text-left' }
                : {}),
            },
            h,
          ),
          toParentMessage: (message) => M.GotFileDropMessage({ message }),
        }),
        ...(hasQueue
          ? [
              h.div(
                [h.Class('flex items-center justify-between')],
                [
                  h.span([h.Class('text-sm font-medium')], ['Queue']),
                  h.span(
                    [h.Class('text-xs tabular-nums text-stone-500')],
                    [`${String(model.queue.length)}/${String(UPLOAD_LIMITS.maxFiles)} files`],
                  ),
                ],
              ),
              h.ul(
                [h.Class('flex flex-col gap-2')],
                [...model.queue.map((item) => queueRow(item, h))],
              ),
              Input.input(
                {
                  id: 'upload-taken-at',
                  label: 'Taken at',
                  description: 'Applied to all files in this batch — overrides EXIF.',
                  type: 'datetime-local',
                  value: model.uploadTakenAt,
                  onInput: (value) => M.SetUploadTakenAt({ value }),
                },
                h,
              ),
              h.div(
                [h.Class('flex flex-col gap-1.5')],
                [
                  h.span([h.Class('text-sm font-medium')], ['Tags for this batch']),
                  embedCombo(model, 'upload', h),
                ],
              ),
              ...(model.uploading
                ? [
                    // Announce progress for screen readers; the bar itself is
                    // decorative to them.
                    h.p(
                      [h.Role('status'), h.AriaLive('polite'), h.Class('sr-only')],
                      [`Uploaded ${String(doneCount)} of ${String(model.batchTotal)}`],
                    ),
                    h.div(
                      [h.Class('flex items-center gap-3')],
                      [
                        h.div(
                          [
                            h.Class('h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200'),
                            h.Role('progressbar'),
                            h.AriaLabel('Upload progress'),
                            h.AriaValuemin(0),
                            h.AriaValuemax(100),
                            h.AriaValuenow(progressPercent),
                          ],
                          [
                            h.div(
                              [
                                h.Class(
                                  'h-full rounded-full bg-primary transition-all duration-300',
                                ),
                                h.Style({ width: `${String(progressPercent)}%` }),
                              ],
                              [],
                            ),
                          ],
                        ),
                        h.span(
                          [h.Class('shrink-0 text-xs tabular-nums text-stone-500')],
                          [`${String(doneCount)}/${String(model.batchTotal)}`],
                        ),
                      ],
                    ),
                  ]
                : []),
              h.div(
                [h.Class('flex items-center justify-between gap-2 flex-wrap')],
                [
                  h.div(
                    [h.Class('flex items-center gap-2')],
                    [
                      Button.button(
                        {
                          onClick: M.ClearFinishedItems(),
                          variant: 'ghost',
                          size: 'sm',
                          isDisabled: !model.queue.some((item) => item.status === 'done'),
                        },
                        'Clear finished',
                        h,
                      ),
                      ...(failedCount > 0
                        ? [
                            Button.button(
                              {
                                onClick: M.RetryAllFailed(),
                                variant: 'outline',
                                size: 'sm',
                              },
                              `Retry all (${String(failedCount)})`,
                              h,
                            ),
                          ]
                        : []),
                    ],
                  ),
                  ...(model.uploading
                    ? [
                        Button.button(
                          {
                            onClick: M.CancelUploads(),
                            variant: 'outline',
                          },
                          'Stop',
                          h,
                        ),
                      ]
                    : [
                        Button.button(
                          {
                            onClick: M.StartUploads(),
                            isDisabled: pendingCount === 0,
                          },
                          pendingCount === 0
                            ? 'Nothing queued'
                            : `Upload ${photoCountLabel(pendingCount)}`,
                          h,
                        ),
                      ]),
                ],
              ),
            ]
          : []),
      ],
    ),
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
        panelClass: 'w-full max-w-xl max-h-[84vh] overflow-y-auto',
        content: (render, innerH) => uploadDialogContent(model, render, innerH),
      },
      h,
    ),
    toParentMessage: (message) => M.GotUploadDialogMessage({ message }),
  })
