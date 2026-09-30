/**
 * Admin overlay views: the destructive-action confirm dialog and the toast
 * stack. Both are child submodels dispatched through Got*Message.
 */

import type { HtmlBuilder } from 'foldkit/html'

import * as Button from '@/components/ui/button'
import * as Dialog from '@/components/ui/dialog'

import { AdminToast, Message as M } from '../model'
import type { Model, Msg, PendingConfirm } from '../model'
import type { Child } from './shared'

/** What the confirm asks. A bulk delete is a soft delete, and the button says
 *  what it does rather than calling a move to the Trash a delete. The Trash is
 *  a state and not a place the Admin lists (CONTEXT.md, Trash), so the copy
 *  promises what is actually true of a trashed Photo and no more: it leaves
 *  every list, its original stays in R2, and only a purge is irreversible. */
const confirmLabel = (pending: PendingConfirm | undefined): string =>
  pending?.kind === 'bulk' ? 'Yes, move to Trash' : 'Yes, delete'

const confirmCopy = (pending: PendingConfirm | undefined): string => {
  if (pending === undefined) return ''
  if (pending.kind === 'photo') {
    return `“${pending.label}” will be moved to Trash: it leaves the Library, its original stays in R2, and its number is never reused.`
  }
  if (pending.kind === 'bulk') {
    return `${String(pending.count)} photograph${
      pending.count === 1 ? '' : 's'
    } will be moved to Trash: they leave the Library, their originals stay in R2, and their numbers are never reused.`
  }
  return `Tag “${pending.label}” will be deleted and detached from all photos.`
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
            [h.Class('p-4 flex flex-col gap-(--spacing-lg)')],
            [
              h.div(
                [h.Class('flex items-start justify-between gap-(--spacing-sm)')],
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
                [h.Class('flex justify-end gap-(--spacing-sm)')],
                [
                  Button.button(
                    {
                      onClick: M.GotConfirmMessage({
                        message: Dialog.Message.RequestedClose(),
                      }),
                      variant: 'secondary',
                    },
                    'Cancel',
                    innerH,
                  ),
                  Button.button(
                    { onClick: M.ConfirmPending(), variant: 'destructive' },
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
