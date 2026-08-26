/**
 * Shared Admin update utilities: model-write helpers and the toast-raising
 * helper used by both `update.ts` and `children.ts`.
 */

import * as Command from 'foldkit/command'
import { evo } from 'foldkit/struct'

import { AdminToast, Message } from './model'
import type { Message as Msg, Model } from './model'

export type Commands = ReadonlyArray<Command.Command<Msg>>
export type UpdateReturn = readonly [Model, Commands]

/** `evo` can only transform keys already present on the source — the stored
 *  state omits absent optional keys entirely, so assigning one through evo
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
  const [nextToast, toastCommands] = AdminToast.show(model.toast, {
    payload: detail === undefined ? { title } : { title, detail },
    variant,
  })
  return [
    evo(model, { toast: () => nextToast }),
    [
      ...extraCommands,
      ...toastCommands.map((command) =>
        Command.mapMessage(command, (message: typeof AdminToast.Message.Type) =>
          Message.GotToastMessage({ message }),
        ),
      ),
    ],
  ]
}

export function toggleIn(ids: ReadonlyArray<string>, id: string): Array<string> {
  return ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id]
}

export function toQueueItem(key: string): Model['queue'][number] {
  const splitAt = key.lastIndexOf(':')
  const name = key.slice(0, splitAt)
  const size = Number(key.slice(splitAt + 1))
  return { id: key, name, size: Number.isFinite(size) ? size : 0, status: 'pending' }
}

export const byLabel = (a: { readonly label: string }, b: { readonly label: string }): number =>
  a.label.localeCompare(b.label)
