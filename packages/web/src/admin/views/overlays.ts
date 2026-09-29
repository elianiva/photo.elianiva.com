/**
 * Admin overlay views: the destructive-action confirm dialog and the toast
 * stack. Both are child submodels dispatched through Got*Message.
 */

import type { HtmlBuilder } from 'foldkit/html'

import * as Button from '@/components/ui/button'
import * as Dialog from '@/components/ui/dialog'

import { AdminToast, Message as M } from '../model'
import type { Model, Msg } from '../model'
import type { Child } from './shared'

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
                [
                  model.pendingConfirm === undefined
                    ? ''
                    : model.pendingConfirm.kind === 'photo'
                      ? `“${model.pendingConfirm.label}” will be removed from storage permanently.`
                      : `Tag “${model.pendingConfirm.label}” will be deleted and detached from all photos.`,
                ],
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
                    'Yes, delete',
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
