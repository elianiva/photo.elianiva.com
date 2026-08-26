/**
 * Admin upload dialog: FileDrop zone plus the upload queue — per-item
 * status badges, retry/remove actions, batch tag/taken-at inputs.
 */

import type { HtmlBuilder } from 'foldkit/html'

import * as Badge from '@/components/ui/badge'
import * as Button from '@/components/ui/button'
import * as Dialog from '@/components/ui/dialog'
import * as FileDrop from '@/components/ui/file-drop'
import * as Input from '@/components/ui/input'
import * as Spinner from '@/components/ui/spinner'

import { UPLOAD_LIMITS, Message as M } from '../model'
import type { Model, Msg, QueueItem } from '../model'
import { embedCombo, formatBytes, type Child } from './shared'

const statusBadge = (item: QueueItem, h: HtmlBuilder<Msg>): Child => {
  if (item.status === 'uploading') {
    return h.span(
      [h.Class('inline-flex items-center gap-1.5')],
      [Spinner.spinner({}, h), Badge.badge({ variant: 'default' }, ['Uploading…'], h)],
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

const queueRow = (item: QueueItem, h: HtmlBuilder<Msg>): Child =>
  h.li(
    [
      h.Key(item.id),
      h.Class('flex items-center gap-3 rounded-lg border border-stone-200 px-3 py-2'),
    ],
    [
      h.div(
        [h.Class('min-w-0 flex-1')],
        [
          h.p([h.Class('truncate text-sm font-medium')], [item.name]),
          h.p(
            [h.Class('text-xs text-stone-500')],
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
              { onClick: M.RetryUpload({ id: item.id }), variant: 'ghost', size: 'sm' },
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
              '×',
              h,
            ),
          ]
        : []),
    ],
  )

const uploadDialogContent = (
  model: Model,
  render: Dialog.DialogContent<Msg>,
  h: HtmlBuilder<Msg>,
): ReadonlyArray<Child> => {
  const pendingCount = model.queue.filter((item) => item.status === 'pending').length
  const failedCount = model.queue.filter((item) => item.status === 'failed').length
  return [
    h.div(
      [h.Class('p-4 flex flex-col gap-4')],
      [
        h.div(
          [h.Class('flex items-start justify-between gap-2')],
          [
            Dialog.title({ attributes: render.title }, ['Upload photos'], h),
            Dialog.closeButton({ attributes: render.closeButton }, ['×'], h),
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
              content: [
                h.p([h.Class('text-base font-medium')], ['Drag & drop images here']),
                h.p(
                  [h.Class('mt-1 text-sm text-muted-foreground')],
                  ['or click to browse — JPEG, PNG, WebP, GIF, AVIF'],
                ),
              ],
            },
            h,
          ),
          toParentMessage: (message) => M.GotFileDropMessage({ message }),
        }),
        ...(model.queue.length > 0
          ? [
              h.ul(
                [h.Class('flex flex-col gap-2 max-h-64 overflow-y-auto')],
                [...model.queue.map((item) => queueRow(item, h))],
              ),
              h.div(
                [h.Class('grid grid-cols-2 gap-3')],
                [
                  Input.input(
                    {
                      id: 'upload-taken-at',
                      label: 'Taken at (overrides EXIF)',
                      type: 'datetime-local',
                      value: model.uploadTakenAt,
                      onInput: (value) => M.SetUploadTakenAt({ value }),
                    },
                    h,
                  ),
                ],
              ),
              h.div(
                [h.Class('flex flex-col gap-1.5')],
                [
                  h.span([h.Class('text-sm font-medium')], ['Tags for this batch']),
                  embedCombo(model, 'upload', h),
                ],
              ),
              h.p(
                [h.Class('text-xs text-stone-500')],
                [
                  `${String(model.queue.length)}/${String(UPLOAD_LIMITS.maxFiles)} files · max ${String(UPLOAD_LIMITS.maxFileSize / (1024 * 1024))} MB each`,
                ],
              ),
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
                  Button.button(
                    {
                      onClick: M.StartUploads(),
                      isDisabled: model.uploading || pendingCount === 0,
                    },
                    model.uploading ? 'Uploading…' : `Upload ${pendingCount} photo(s)`,
                    h,
                  ),
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
        panelClass: 'w-full max-w-lg max-h-[84vh] overflow-y-auto',
        content: (render, innerH) => uploadDialogContent(model, render, innerH),
      },
      h,
    ),
    toParentMessage: (message) => M.GotUploadDialogMessage({ message }),
  })
