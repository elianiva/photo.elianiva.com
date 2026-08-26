/**
 * Admin child submodel folds: edit Sheet, upload Dialog, confirm Dialog,
 * FileDrop, toast stack, and the tag comboboxes. Each fold re-keys the
 * child's messages into the matching Got*Message variant.
 */

import { Option as Opt, Schema as S } from 'effect'
import * as Command from 'foldkit/command'
import { evo } from 'foldkit/struct'
import * as Update from 'foldkit/update'
import { Multi } from '@foldkit/ui/combobox'

import * as Dialog from '@/components/ui/dialog'
import * as FileDrop from '@/components/ui/file-drop'
import * as Sheet from '@/components/ui/sheet'

import { CreateTagCmd } from './commands'
import { disposeItemAssets, showToast, toQueueItem, toggleIn, type UpdateReturn } from './helpers'
import {
  AdminToast,
  Message,
  TagMultiCombo,
  UPLOAD_LIMITS,
  emptyDraft,
  fileStore,
  previewStore,
} from './model'
import type { Message as Msg, Model } from './model'

/** A user-driven close (Esc, backdrop, close button) surfaces as the child's
 *  `Closed` out-message; reset the edit state around it. */
export const foldSheet = Update.foldChild({
  update: Sheet.update,
  read: (model: Model) => Opt.some(model.editSheet),
  write: (model: Model, nextSheet: typeof model.editSheet) =>
    evo(model, { editSheet: () => nextSheet }),
  toParentMessage: (message: typeof Sheet.Message.Type) => Message.GotEditSheetMessage({ message }),
  foldOutMessage: (out): Update.Step<Model, Msg> =>
    out._tag === 'Closed'
      ? (writtenModel) => [
          // editingId is optional and may be absent from normalized state;
          // spread instead of evo, which cannot add missing keys.
          evo(writtenModel, {
            draft: () => emptyDraft(),
            draftTagIds: () => [],
            ...(writtenModel.editingId !== undefined ? { editingId: () => undefined } : {}),
          }),
          [],
        ]
      : (writtenModel) => [writtenModel, []],
})

/** Closing the upload dialog (Cancel button sends the child's requested-close
 *  message; Esc/backdrop emit `Closed`) drops queue items that are not stuck. */
export const releaseFinishedItems = (dialogModel: Model): Model => {
  for (const item of dialogModel.queue) {
    if (item.status !== 'failed') disposeItemAssets(item.id)
  }
  return evo(dialogModel, {
    queue: () => dialogModel.queue.filter((item) => item.status === 'failed'),
    uploadTagIds: () => [],
    uploadTakenAt: () => '',
    uploading: () => false,
  })
}

export const foldUploadDialog = Update.foldChild({
  update: Dialog.update,
  read: (model: Model) => Opt.some(model.uploadDialog),
  write: (model: Model, nextDialog: typeof model.uploadDialog) =>
    evo(model, { uploadDialog: () => nextDialog }),
  toParentMessage: (message: typeof Dialog.Message.Type) =>
    Message.GotUploadDialogMessage({ message }),
  foldOutMessage: (out): Update.Step<Model, Msg> =>
    out._tag === 'Closed'
      ? (writtenModel) => [
          // A close mid-batch keeps the queue: uploads keep chaining in the
          // background, and runNextOrFinish releases everything once the
          // last item settles (so reopening mid-batch still shows progress).
          writtenModel.uploading ? writtenModel : releaseFinishedItems(writtenModel),
          [],
        ]
      : (writtenModel) => [writtenModel, []],
})

/** Dismissing the confirm dialog without confirming forgets what was pending. */
export const foldConfirm = Update.foldChild({
  update: Dialog.update,
  read: (model: Model) => Opt.some(model.confirmDialog),
  write: (model: Model, nextDialog: typeof model.confirmDialog) =>
    evo(model, { confirmDialog: () => nextDialog }),
  toParentMessage: (message: typeof Dialog.Message.Type) => Message.GotConfirmMessage({ message }),
  foldOutMessage: (out): Update.Step<Model, Msg> =>
    out._tag === 'Closed'
      ? (writtenModel) => [evo(writtenModel, { pendingConfirm: () => undefined }), []]
      : (writtenModel) => [writtenModel, []],
})

/** Dropped files surface through the child's out-channel: each file's bytes
 *  land in `fileStore` and a queue item rides back to the parent. */
export const foldFileDrop = Update.foldChild({
  update: FileDrop.update,
  read: (model: Model) => Opt.some(model.fileDrop),
  write: (model: Model, nextDrop: typeof model.fileDrop) =>
    evo(model, { fileDrop: () => nextDrop }),
  toParentMessage: (message: typeof FileDrop.Message.Type) =>
    Message.GotFileDropMessage({ message }),
  foldOutMessage: (out: typeof FileDrop.OutMessage.Type): Update.Step<Model, Msg> => {
    if (out._tag !== 'ReceivedFiles') {
      // RejectedNonFiles: a drop without files carries nothing to do
      return (droppedModel) => [droppedModel, []]
    }
    // Enforce per-file size and global queue cap. Oversized files keep the
    // regular `${name}:${size}` key (real size included) so same-named files
    // can't collide and re-drops dedupe against the existing queue.
    const validated: Array<{ file: File; id: string }> = []
    const oversized: Array<{ name: string; size: number }> = []
    for (const file of out.files) {
      const id = `${file.name}:${file.size}`
      // Preview every dropped file — oversized rows included, so the
      // operator can see *which* file was refused. Client-side only (a drop
      // can't happen in the worker), so URL.createObjectURL always exists.
      if (!previewStore.has(id)) previewStore.set(id, URL.createObjectURL(file))
      if (file.size > UPLOAD_LIMITS.maxFileSize) {
        oversized.push({ name: file.name, size: file.size })
        continue
      }
      fileStore.set(id, file)
      validated.push({ file, id })
    }
    return (droppedModel) => {
      const existing = new Set(droppedModel.queue.map((item) => item.id))
      const allIds = validated.map((entry) => entry.id)
      const freshIds = allIds.filter((key) => !existing.has(key))

      const seen = new Set([...existing, ...allIds])
      const maxMb = String(UPLOAD_LIMITS.maxFileSize / (1024 * 1024))
      const oversizedItems = oversized
        .filter(({ name, size }) => !seen.has(`${name}:${String(size)}`))
        .map(({ name, size }) => ({
          id: `${name}:${String(size)}`,
          name,
          size,
          status: 'failed' as const,
          error: `file too large (max ${maxMb} MB)`,
        }))

      const availableSlots = Math.max(0, UPLOAD_LIMITS.maxFiles - droppedModel.queue.length)
      const withinCap = freshIds.slice(0, availableSlots)
      const overflowCount = freshIds.length - withinCap.length

      const fresh = withinCap.map(toQueueItem).concat(oversizedItems)

      let nextModel: Model = { ...droppedModel, queue: [...droppedModel.queue, ...fresh] }

      let mutableCommands: Array<Command.Command<Msg>> = []
      // Re-dropped files already in the queue are skipped silently by the
      // dedupe above — say so instead of looking like nothing happened.
      const duplicateCount = allIds.length - freshIds.length
      if (duplicateCount > 0) {
        const [tModel, tCmds] = showToast(
          nextModel,
          `${String(duplicateCount)} duplicate${duplicateCount === 1 ? '' : 's'} skipped`,
          'Error',
          'Already in the upload queue.',
        )
        nextModel = tModel
        mutableCommands = [...mutableCommands, ...tCmds]
      }
      if (oversized.length > 0) {
        const [tModel, tCmds] = showToast(
          nextModel,
          `${String(oversized.length)} file(s) too large`,
          'Error',
          `Max ${String(UPLOAD_LIMITS.maxFileSize / (1024 * 1024))} MB per file.`,
        )
        nextModel = tModel
        mutableCommands = [...mutableCommands, ...tCmds]
      }
      if (overflowCount > 0) {
        const [tModel, tCmds] = showToast(
          nextModel,
          `Only ${String(UPLOAD_LIMITS.maxFiles)} files allowed`,
          'Error',
          `${String(overflowCount)} file(s) skipped — remove some to add more.`,
        )
        nextModel = tModel
        mutableCommands = [...mutableCommands, ...tCmds]
      }
      return [nextModel, mutableCommands]
    }
  },
})

/** Toast dismissal/expiry is fully owned by the toast submodel. */
export const foldToast = Update.foldChild({
  update: AdminToast.update,
  read: (model: Model) => Opt.some(model.toast),
  write: (model: Model, nextToast: typeof model.toast) => evo(model, { toast: () => nextToast }),
  toParentMessage: (message: typeof AdminToast.Message.Type) =>
    Message.GotToastMessage({ message }),
  foldOutMessage: (): Update.Step<Model, Msg> => (writtenModel) => [writtenModel, []],
})

// ---------------------------------------------------------------------------
// tag combobox folds
//
// Combos emit `Selected({ value })` through their out-channel: the value is
// either a Tag id (toggle membership) or a `create:<label>` pseudo-item
// rendered by the filtered-items view (inline create). Internal combo
// messages (typing, open/close, highlight) bubble up wrapped and are folded
// straight back down.
// ---------------------------------------------------------------------------

/** The combobox bundle's model shape, named here because @foldkit/ui does
 *  not export a standalone model TYPE for the multi-select bundle. */
type TagComboModel = S.Schema.Type<typeof Multi.Model>

interface ComboFold {
  (model: Model, message: never): UpdateReturn
}

const makeComboFold = (
  which: 'draft' | 'upload',
  read: (model: Model) => Opt.Option<TagComboModel>,
  write: (model: Model, nextCombo: TagComboModel) => Model,
): ComboFold =>
  Update.foldChild({
    update: TagMultiCombo.update,
    read,
    write,
    toParentMessage: (message) =>
      which === 'draft'
        ? Message.GotDraftComboMessage({ message })
        : Message.GotUploadComboMessage({ message }),
    foldOutMessage: (out): Update.Step<Model, Msg> => {
      if (out._tag !== 'Selected') {
        return (comboModel) => [comboModel, []]
      }
      const value = out.value
      if (value.startsWith('create:')) {
        const label = value.slice('create:'.length)
        return (comboModel) => [comboModel, [CreateTagCmd({ source: which, label })]]
      }
      if (which === 'draft') {
        return (comboModel) => [
          evo(comboModel, { draftTagIds: () => toggleIn(comboModel.draftTagIds, value) }),
          [],
        ]
      }
      return (comboModel) => [
        evo(comboModel, { uploadTagIds: () => toggleIn(comboModel.uploadTagIds, value) }),
        [],
      ]
    },
  })

export const foldDraftCombo = makeComboFold(
  'draft',
  (model) => Opt.some(model.draftCombo),
  (model, nextCombo) => evo(model, { draftCombo: () => nextCombo }),
)

export const foldUploadCombo = makeComboFold(
  'upload',
  (model) => Opt.some(model.uploadCombo),
  (model, nextCombo) => evo(model, { uploadCombo: () => nextCombo }),
)
