/**
 * Admin overlay views: the destructive-action confirm dialog and the toast
 * stack. Both are child submodels dispatched through Got*Message.
 */

import type { HtmlBuilder } from 'foldkit/html'

import * as Button from '@/components/ui/button'
import * as Dialog from '@/components/ui/dialog'

import { AdminToast, Message as M, isBusy } from '../model'
import type { Model, Msg, PendingConfirm } from '../model'
import type { Child } from './shared'

/** What the confirm button says. Delete is permanent: there is no Trash. */
const confirmLabel = (_pending: PendingConfirm | undefined): string => 'Yes, delete'

const confirmCopy = (pending: PendingConfirm | undefined): string => {
  if (pending === undefined) return ''
  if (pending.kind === 'photo') {
    return `“${pending.label}” will be deleted for good: it leaves the Library, its original is removed from R2, and its number is never reused.`
  }
  return `${String(pending.count)} photograph${
    pending.count === 1 ? '' : 's'
  } will be deleted for good: they leave the Library, their originals are removed from R2, and their numbers are never reused.`
}

export const confirmDialog = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.submodel({
    slotId: 'admin-confirm-dialog',
    model: model.confirmDialog,
    view: Dialog.view,
    viewInputs: Dialog.styledViewInputs<Msg>(
      {
        panelClass: 'w-full max-w-sm',
        content: (render, innerH) => [
          h.div(
            [h.Class('p-4 flex flex-col gap-4')],
            [
              h.div(
                [h.Class('flex items-start justify-between gap-2')],
                [
                  Dialog.title({ attributes: render.title }, ['Are you sure?'], innerH),
                  Dialog.closeButton({ attributes: render.closeButton }, ['×'], innerH),
                ],
              ),
              Dialog.description(
                { attributes: render.description },
                [confirmCopy(model.pendingConfirm)],
                innerH,
              ),
              h.div(
                [h.Class('flex justify-end gap-2')],
                [
                  Button.button(
                    {
                      onClick: M.GotConfirmMessage({
                        message: Dialog.Message.RequestedClose(),
                      }),
                      variant: 'secondary',
                      isDisabled: isBusy(model, 'confirm'),
                    },
                    'Cancel',
                    innerH,
                  ),
                  Button.button(
                    {
                      onClick: M.ConfirmPending(),
                      variant: 'destructive',
                      isLoading: isBusy(model, 'confirm'),
                    },
                    confirmLabel(model.pendingConfirm),
                    innerH,
                  ),
                ],
              ),
            ],
          ),
        ],
      },
      h,
    ),
    toParentMessage: (message) => M.GotConfirmMessage({ message }),
  })

export const toastStack = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.submodel({
    slotId: 'admin-toasts',
    model: model.toast,
    view: AdminToast.view,
    viewInputs: AdminToast.styledViewInputs(
      model.toast,
      {
        position: 'BottomRight',
        toContent: (entry, innerH) => [
          innerH.p([innerH.Class('type-ui')], [entry.payload.title]),
          ...(entry.payload.detail !== undefined
            ? [
                innerH.p(
                  [innerH.Class('type-exif text-role-text-secondary mt-1')],
                  [entry.payload.detail],
                ),
              ]
            : []),
        ],
      },
      h,
    ),
    toParentMessage: (message) => M.GotToastMessage({ message }),
  })
