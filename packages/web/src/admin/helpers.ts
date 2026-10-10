/**
 * Shared Admin update utilities: model-write helpers and the toast-raising
 * helper used by both `update.ts` and `children.ts`.
 */

import * as Command from 'foldkit/command'
import { modifyFields } from 'foldkit/struct'
import * as Update from 'foldkit/update'

import { AdminToast, Message, fileStore, previewStore } from './model'
import { cancelPrepare } from './upload-prepare'
import type { Message as Msg, Model } from './model'

export type Commands = ReadonlyArray<Command.Command<Msg>>
export type UpdateReturn = Update.Return<Model, Msg>

/** `modifyFields` can only transform keys already present on the source — the stored
 *  state omits absent optional keys entirely, so assigning one through modifyFields
 *  alone is a silent no-op. Use this for writes to optional fields. */
export const withOptional = (model: Model, fields: Partial<Model>): Model => ({
  ...model,
  ...fields,
})

/** Re-keys child (dialog/sheet) commands so they dispatch back into the
 *  matching Got*Message fold instead of leaking the child's vocabulary. */
export const liftChildCommands = <M>(
  commands: ReadonlyArray<Command.Command<M>>,
  wrap: (message: M) => Msg,
): Commands => commands.map((command) => Command.mapMessage(command, wrap))

export const showToast = (
  model: Model,
  title: string,
  variant: 'Success' | 'Error',
  detail?: string,
  extraCommands: Commands = [],
): UpdateReturn => {
  const toastShown = AdminToast.show(model.toast, {
    payload: detail === undefined ? { title } : { title, detail },
    variant,
  })
  const commands: Commands = [
    ...extraCommands,
    ...(toastShown.commands ?? []).map((command) =>
      Command.mapMessage(command, (message: typeof AdminToast.Message.Type) =>
        Message.GotToastMessage({ message }),
      ),
    ),
  ]
  const nextModel = modifyFields(model, { toast: () => toastShown.model })
  return commands.length > 0 ? { model: nextModel, commands } : { model: nextModel }
}

export function toggleIn(ids: ReadonlyArray<string>, id: string): Array<string> {
  return ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id]
}

export function toQueueItem(key: string): Model['queue'][number] {
  const splitAt = key.lastIndexOf(':')
  const name = key.slice(0, splitAt)
  const size = Number(key.slice(splitAt + 1))
  return { id: key, name, size: Number.isFinite(size) ? size : 0, status: 'pending', loaded: 0 }
}

export const byLabel = (a: { readonly label: string }, b: { readonly label: string }): number =>
  a.label.localeCompare(b.label)

/** The ticked Photos in the Library's own row order rather than the order they
 *  were clicked in, so a bulk operation reads the way the table reads. A Photo
 *  ticked on an earlier page is not in the list any more, so it follows, in
 *  selection order. */
export const selectedIds = (model: Model): ReadonlyArray<string> => {
  const ticked = new Set(model.selected)
  const onPage = model.photos.filter((photo) => ticked.has(photo.id)).map((photo) => photo.id)
  const offPage = model.selected.filter((id) => !model.photos.some((photo) => photo.id === id))
  return [...onPage, ...offPage]
}

export const photoCountLabel = (count: number): string =>
  `${String(count)} photo${count === 1 ? '' : 's'}`

/** Drop a queue item's upload bytes and its object-URL preview. Idempotent;
 *  only ever reached client-side (both stores are populated on drop). */
export const disposeItemAssets = (id: string): void => {
  cancelPrepare(id)
  fileStore.delete(id)
  const preview = previewStore.get(id)
  if (preview !== undefined) {
    URL.revokeObjectURL(preview)
    previewStore.delete(id)
  }
}
