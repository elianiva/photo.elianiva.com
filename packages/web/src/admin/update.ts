/**
 * Admin app core: commands (the RPC seam, ADR 0006), init, and update.
 * Uploaded bytes live in `fileStore` keyed by queue-item id so the Model
 * stays serializable.
 */

import { Effect, Option as Opt, Schema as S } from 'effect'
import * as Command from 'foldkit/command'
import { evo } from 'foldkit/struct'
import * as Update from 'foldkit/update'
import { Multi } from '@foldkit/ui/combobox'
import type { PhotoWithTags, Tag } from '@photo/shared'

import { RpcFailure, rpcAdmin, rpcPublic } from '@/lib/rpc'
import * as Dialog from '@/components/ui/dialog'
import * as FileDrop from '@/components/ui/file-drop'
import * as Sheet from '@/components/ui/sheet'

import {
  AdminToast,
  DraftFields,
  Message,
  TagMultiCombo,
  UPLOAD_LIMITS,
  emptyDraft,
  fileStore,
} from './model'
import type { Message as Msg, Model } from './model'

type Commands = ReadonlyArray<Command.Command<Msg>>
type UpdateReturn = readonly [Model, Commands]

interface PhotoPage {
  readonly items: ReadonlyArray<PhotoWithTags>
  readonly nextCursor: string | null
}

// ---------------------------------------------------------------------------
// child folds
// ---------------------------------------------------------------------------

/** A user-driven close (Esc, backdrop, close button) surfaces as the child's
 *  `Closed` out-message; reset the edit state around it. */
const foldSheet = Update.foldChild({
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
const releaseFinishedItems = (dialogModel: Model): Model => {
  for (const item of dialogModel.queue) {
    if (item.status !== 'failed') fileStore.delete(item.id)
  }
  return evo(dialogModel, {
    queue: () => dialogModel.queue.filter((item) => item.status === 'failed'),
    uploadTagIds: () => [],
    uploadTakenAt: () => '',
    uploading: () => false,
  })
}
const foldUploadDialog = Update.foldChild({
  update: Dialog.update,
  read: (model: Model) => Opt.some(model.uploadDialog),
  write: (model: Model, nextDialog: typeof model.uploadDialog) =>
    evo(model, { uploadDialog: () => nextDialog }),
  toParentMessage: (message: typeof Dialog.Message.Type) =>
    Message.GotUploadDialogMessage({ message }),
  foldOutMessage: (out): Update.Step<Model, Msg> =>
    out._tag === 'Closed'
      ? (writtenModel) => [releaseFinishedItems(writtenModel), []]
      : (writtenModel) => [writtenModel, []],
})

/** Dismissing the confirm dialog without confirming forgets what was pending. */
const foldConfirm = Update.foldChild({
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
const foldFileDrop = Update.foldChild({
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
    // Enforce per-file size and global queue cap
    const validated: Array<{ file: File; id: string }> = []
    const oversized: Array<string> = []
    for (const file of out.files) {
      if (file.size > UPLOAD_LIMITS.maxFileSize) {
        oversized.push(file.name)
        continue
      }
      const id = `${file.name}:${file.size}`
      fileStore.set(id, file)
      validated.push({ file, id })
    }
    return (droppedModel) => {
      const existing = new Set(droppedModel.queue.map((item) => item.id))
      const allIds = validated.map((entry) => entry.id)
      const freshIds = allIds.filter((key) => !existing.has(key))

      const oversizedItems = oversized.map((name) => ({
        id: `${name}:oversized`,
        name,
        size: 0,
        status: 'failed' as const,
        error: `file too large (max ${String(UPLOAD_LIMITS.maxFileSize / (1024 * 1024))} MB)`,
      }))

      const availableSlots = Math.max(0, UPLOAD_LIMITS.maxFiles - droppedModel.queue.length)
      const withinCap = freshIds.slice(0, availableSlots)
      const overflowCount = freshIds.length - withinCap.length

      const fresh = withinCap.map(toQueueItem).concat(oversizedItems)

      let nextModel: Model = { ...droppedModel, queue: [...droppedModel.queue, ...fresh] }

      let mutableCommands: Array<Command.Command<Msg>> = []
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
const foldToast = Update.foldChild({
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

const foldDraftCombo = makeComboFold(
  'draft',
  (model) => Opt.some(model.draftCombo),
  (model, nextCombo) => evo(model, { draftCombo: () => nextCombo }),
)

const foldUploadCombo = makeComboFold(
  'upload',
  (model) => Opt.some(model.uploadCombo),
  (model, nextCombo) => evo(model, { uploadCombo: () => nextCombo }),
)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for external callers; internal path now inlines the store
function enqueueFile(file: File): string {
  const id = `${file.name}:${file.size}`
  fileStore.set(id, file)
  return id
}

/** Narrow on purpose: widening this to the whole Message union would leak
 *  every variant into each command's success channel. */
const failWith = (error: RpcFailure) => Message.FailedRpc({ message: error.message })

/** Re-keys child (dialog/sheet) commands so they dispatch back into the
 *  matching Got*Message fold instead of leaking the child's vocabulary. */
const liftChildCommands = <M>(
  commands: ReadonlyArray<Command.Command<M>>,
  wrap: (message: M) => Msg,
): Commands => commands.map((command) => Command.mapMessage(command, wrap))

/** `evo` can only transform keys already present on the source — the stored
 *  state omits absent optional keys entirely, so assigning one through evo
 *  alone is a silent no-op. Use this for writes to optional fields. */
const withOptional = (model: Model, fields: Partial<Model>): Model => ({
  ...model,
  ...fields,
})

const showToast = (
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

function toggleIn(ids: ReadonlyArray<string>, id: string): Array<string> {
  return ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id]
}

function toQueueItem(key: string): Model['queue'][number] {
  const splitAt = key.lastIndexOf(':')
  const name = key.slice(0, splitAt)
  const size = Number(key.slice(splitAt + 1))
  return { id: key, name, size: Number.isFinite(size) ? size : 0, status: 'pending' }
}

const byLabel = (a: { readonly label: string }, b: { readonly label: string }): number =>
  a.label.localeCompare(b.label)

// ---------------------------------------------------------------------------
// commands — the RPC seam (ADR 0006)
// ---------------------------------------------------------------------------

export const FetchPhotosCmd = Command.define('FetchPhotos', {
  args: { q: S.String, tagSlug: S.String },
  messages: [Message.SucceededFetchPhotos, Message.FailedRpc],
  execute: ({ q, tagSlug }) =>
    Effect.map(
      rpcPublic<PhotoPage>(
        'ListPhotos',
        q === '' && tagSlug === ''
          ? { limit: 60 }
          : { q: q || undefined, tagSlug: tagSlug || undefined, limit: 60 },
      ),
      (page) => Message.SucceededFetchPhotos({ photos: [...page.items], nextCursor: page.nextCursor }),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

export const FetchMoreCmd = Command.define('FetchMore', {
  args: { q: S.String, tagSlug: S.String, cursor: S.String },
  messages: [Message.SucceededFetchMore, Message.FailedRpc],
  execute: ({ q, tagSlug, cursor }) =>
    Effect.map(
      rpcPublic<PhotoPage>('ListPhotos', {
        q: q || undefined,
        tagSlug: tagSlug || undefined,
        limit: 60,
        cursor,
      }),
      (page) => Message.SucceededFetchMore({ photos: [...page.items], nextCursor: page.nextCursor }),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

export const SearchDebounceCmd = Command.define('SearchDebounce', {
  args: { value: S.String },
  messages: [Message.DebouncedSearch],
  execute: ({ value }) =>
    Effect.gen(function* () {
      yield* Effect.sleep('300 millis')
      return Message.DebouncedSearch({ value })
    }),
})

export const FetchTagsCmd = Command.define('FetchTags', {
  messages: [Message.SucceededFetchTags, Message.FailedRpc],
  execute: Effect.map(rpcPublic<ReadonlyArray<Tag>>('ListTags', {}), (tags) =>
    Message.SucceededFetchTags({ tags: [...tags] }),
  ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

export const SaveEditsCmd = Command.define('SaveEdits', {
  args: { id: S.String, draft: DraftFields, tagIds: S.Array(S.String) },
  messages: [Message.SavedEdits, Message.FailedRpc],
  execute: ({ id, draft, tagIds }) =>
    Effect.gen(function* () {
      const metadata: Record<string, string> = {}
      for (const field of ['caption', 'location', 'camera', 'lens'] as const) {
        if (draft[field] !== '') metadata[field] = draft[field]
      }
      yield* rpcAdmin('UpdatePhoto', {
        id,
        title: draft.title,
        slug: draft.slug,
        ...(draft.takenAt !== '' && { takenAt: draft.takenAt }),
        ...(Object.keys(metadata).length > 0 && { metadata }),
        tagIds: [...tagIds],
      })
      // refetch first page so ordering (takenAt DESC) stays truthful
      const page = yield* rpcPublic<PhotoPage>('ListPhotos', { limit: 60 })
      return Message.SavedEdits({ photos: [...page.items] })
    }).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

export const DeletePhotoCmd = Command.define('DeletePhoto', {
  args: { id: S.String },
  messages: [Message.DeletedPhoto, Message.FailedRpc],
  execute: ({ id }) =>
    Effect.map(
      Effect.andThen(
        rpcAdmin('DeletePhoto', { id }),
        rpcPublic<PhotoPage>('ListPhotos', { limit: 60 }),
      ),
      (page) => Message.DeletedPhoto({ id, photos: [...page.items] }),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

export const DeleteTagCmd = Command.define('DeleteTag', {
  args: { id: S.String },
  messages: [Message.DeletedTag, Message.FailedRpc],
  execute: ({ id }) =>
    Effect.map(
      Effect.andThen(
        rpcAdmin('DeleteTag', { id }),
        // Refetch both sides: cards would otherwise keep showing the deleted
        // tag until the next full reload.
        Effect.all({
          tags: rpcPublic<ReadonlyArray<Tag>>('ListTags', {}),
          page: rpcPublic<PhotoPage>('ListPhotos', { limit: 60 }),
        }),
      ),
      ({ tags, page }) => Message.DeletedTag({ tags: [...tags], photos: [...page.items] }),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

export const CreateTagCmd = Command.define('CreateTag', {
  args: { source: S.Literals(['draft', 'upload']), label: S.String },
  messages: [Message.SucceededCreateTag, Message.FailedRpc],
  execute: ({ source, label }) =>
    Effect.map(rpcAdmin<Tag>('CreateTag', { slug: label, label }), (tag) =>
      Message.SucceededCreateTag({ source, tag }),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

/** One queue item per command run; `update` chains the next pending item.
 *  Batch-wide tag/takenAt choices ride along as args so the execute closure
 *  needs no access to the Model. */
export const UploadItemCmd = Command.define('UploadItem', {
  args: { itemId: S.String, tagIds: S.Array(S.String), takenAt: S.String },
  messages: [Message.SucceededUploadItem, Message.FailedUploadItem],
  execute: ({ itemId, tagIds, takenAt }) =>
    Effect.gen(function* () {
      const file = fileStore.get(itemId)
      if (file === undefined) {
        return Message.FailedUploadItem({ itemId, message: 'uploaded bytes are gone' })
      }
      const form = new FormData()
      form.set('file', file)
      form.set('title', file.name.replace(/\.[^/.]+$/, ''))
      form.set('tagIds', JSON.stringify([...tagIds]))
      if (takenAt !== '') form.set('takenAt', takenAt)
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch('/api/upload', { method: 'POST', body: form, credentials: 'same-origin', signal }),
        catch: () => new Error('upload request failed'),
      })
      if (!response.ok) {
        const body = yield* Effect.promise(() => response.text())
        let message = `upload failed (${String(response.status)})`
        try {
          const parsed: { message?: unknown } = JSON.parse(body)
          if (typeof parsed.message === 'string') message = parsed.message
        } catch (parseError) {
          // non-JSON error body — the status-based message stands
          void parseError
        }
        return Message.FailedUploadItem({ itemId, message })
      }
      return Message.SucceededUploadItem({ itemId })
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(Message.FailedUploadItem({ itemId, message: 'upload failed' })),
      ),
    ),
})

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export const init = (): readonly [Model, Commands] => [
  {
    status: 'loading',
    photos: [],
    tags: [],
    nextCursor: null,
    loadingMore: false,
    search: '',
    editSheet: Sheet.init({ id: 'admin-edit-sheet' }),
    draft: emptyDraft(),
    draftTagIds: [],
    draftCombo: Multi.init({ id: 'admin-draft-combo' }),
    saving: false,
    uploadDialog: Dialog.init({ id: 'admin-upload-dialog' }),
    fileDrop: FileDrop.init({ id: 'admin-file-drop' }),
    queue: [],
    uploadTagIds: [],
    uploadCombo: Multi.init({ id: 'admin-upload-combo' }),
    uploadTakenAt: '',
    uploading: false,
    confirmDialog: Dialog.init({ id: 'admin-confirm-dialog' }),
    toast: AdminToast.init({ id: 'admin-toasts' }),
  },
  [FetchPhotosCmd({ q: '', tagSlug: '' }), FetchTagsCmd()],
]

// ---------------------------------------------------------------------------
// upload chaining
// ---------------------------------------------------------------------------

/** Kick the next pending item, or finalize the batch when none remain. */
const runNextOrFinish = (model: Model): UpdateReturn => {
  const pending = model.queue.find((item) => item.status === 'pending')
  if (pending !== undefined) {
    return [
      model,
      [
        UploadItemCmd({
          itemId: pending.id,
          tagIds: [...model.uploadTagIds],
          takenAt: model.uploadTakenAt,
        }),
      ],
    ]
  }
  const failedCount = model.queue.filter((item) => item.status === 'failed').length
  const doneModel = evo(model, { uploading: () => false })
  const refresh = FetchPhotosCmd({ q: model.search, tagSlug: model.activeTagSlug ?? '' })
  return failedCount === 0
    ? showToast(
        doneModel,
        `Uploaded ${String(model.queue.length)} photo(s)`,
        'Success',
        undefined,
        [refresh],
      )
    : showToast(
        doneModel,
        `${String(model.queue.length - failedCount)} uploaded, ${String(failedCount)} failed`,
        'Error',
        'Retry failed items from the upload dialog.',
        [refresh],
      )
}

const markItem = (
  model: Model,
  itemId: string,
  status: 'done' | 'failed',
  errorMessage?: string,
): Model =>
  evo(model, {
    queue: () =>
      model.queue.map((item) =>
        item.id === itemId
          ? errorMessage === undefined
            ? evo(item, { status: () => status })
            : // `error` is optional; assign via spread — evo cannot add keys.
              { ...item, status, error: errorMessage }
          : item,
      ),
  })

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

function step(current: Model, message: Msg, prior: Commands = []): UpdateReturn {
  const [nextModel, commands] = transition(current, message)
  return [nextModel, [...prior, ...commands]]
}

const transition = (model: Model, message: Msg): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    // ----- data ---------------------------------------------------------------
    SucceededFetchPhotos: ({ photos, nextCursor }) => [
      evo(model, {
        photos: () => [...photos],
        nextCursor: () => nextCursor ?? null,
        loadingMore: () => false,
        status: () => 'ready',
        error: () => undefined,
      }),
      [],
    ],
    SucceededFetchMore: ({ photos, nextCursor }) => [
      evo(model, {
        photos: () => [...model.photos, ...photos],
        nextCursor: () => nextCursor ?? null,
        loadingMore: () => false,
      }),
      [],
    ],
    SucceededFetchTags: ({ tags }) => [evo(model, { tags: () => tags ?? [] }), []],
    FailedRpc: ({ message: failure }) => {
      // `error` is optional and may be absent from normalized state; assign
      // via spread (see `withOptional`) instead of evo.
      const errored = withOptional(evo(model, { loadingMore: () => false }), {
        status: 'error',
        error: failure,
      })
      return showToast(errored, 'Something went wrong', 'Error', failure)
    },
    LoadMore: () => {
      if (model.nextCursor === null || model.loadingMore) return [model, []]
      return [
        evo(model, { loadingMore: () => true }),
        [FetchMoreCmd({ q: model.search, tagSlug: model.activeTagSlug ?? '', cursor: model.nextCursor })],
      ]
    },

    // ----- filter bar -----------------------------------------------------------
    SetSearch: ({ value }) => [
      evo(model, { search: () => value }),
      [SearchDebounceCmd({ value })],
    ],
    DebouncedSearch: ({ value }) => {
      if (value !== model.search) return [model, []]
      return [model, [FetchPhotosCmd({ q: value, tagSlug: model.activeTagSlug ?? '' })]]
    },
    SubmitSearch: () => [
      model,
      [FetchPhotosCmd({ q: model.search, tagSlug: model.activeTagSlug ?? '' })],
    ],
    FilterByTag: ({ slug }) => {
      const current = model.activeTagSlug ?? ''
      const next = current === slug ? undefined : slug
      // `activeTagSlug` is optional; assign via spread (see `withOptional`).
      const nextModel = withOptional(model, { activeTagSlug: next })
      return [nextModel, [FetchPhotosCmd({ q: nextModel.search, tagSlug: next ?? '' })]]
    },

    // ----- edit sheet -----------------------------------------------------------
    OpenEdit: ({ photo }) => {
      const meta = photo.metadata ?? {}
      const draft = {
        title: photo.title,
        slug: photo.slug,
        takenAt: photo.takenAt ?? '',
        caption: typeof meta.caption === 'string' ? meta.caption : '',
        location: typeof meta.location === 'string' ? meta.location : '',
        camera: typeof meta.camera === 'string' ? meta.camera : '',
        lens: typeof meta.lens === 'string' ? meta.lens : '',
      }
      // `editingId` is an optional field that schema-normalized state omits
      // entirely; Struct.evolve only transforms existing keys, so assign it
      // with a spread (see `withOptional`).
      const started = withOptional(model, { editingId: photo.id })
      const prepared = evo(started, {
        draft: () => draft,
        draftTagIds: () => (photo.tags ?? []).map((tag) => tag.id),
      })
      const [nextSheet, sheetCommands] = Sheet.open(prepared.editSheet)
      return [
        evo(prepared, { editSheet: () => nextSheet }),
        liftChildCommands(sheetCommands, (message) => Message.GotEditSheetMessage({ message })),
      ]
    },
    SetDraftField: ({ field, value }) => [
      evo(model, {
        draft: () => {
          const current = model.draft
          switch (field) {
            case 'title':
              return { ...current, title: value }
            case 'slug':
              return { ...current, slug: value }
            case 'takenAt':
              return { ...current, takenAt: value }
            case 'caption':
              return { ...current, caption: value }
            case 'location':
              return { ...current, location: value }
            case 'camera':
              return { ...current, camera: value }
            case 'lens':
              return { ...current, lens: value }
          }
        },
      }),
      [],
    ],
    ToggleDraftTag: ({ tagId }) => [
      evo(model, { draftTagIds: () => toggleIn(model.draftTagIds, tagId) }),
      [],
    ],
    SaveEdits: () => {
      if (model.editingId === undefined) return [model, []]
      return [
        evo(model, { saving: () => true }),
        [SaveEditsCmd({ id: model.editingId, draft: model.draft, tagIds: [...model.draftTagIds] })],
      ]
    },
    SavedEdits: ({ photos }) => {
      const [closedSheet, closeCommands] = Sheet.close(model.editSheet)
      const saved = evo(model, {
        photos: () => [...photos],
        nextCursor: () => null,
        loadingMore: () => false,
        editSheet: () => closedSheet,
        editingId: () => undefined,
        saving: () => false,
      })
      return showToast(
        saved,
        'Saved',
        'Success',
        undefined,
        liftChildCommands(closeCommands, (message) => Message.GotEditSheetMessage({ message })),
      )
    },
    // ----- create tag inline ------------------------------------------------------
    CreateTagRequested: ({ source, label }) => [model, [CreateTagCmd({ source, label })]],
    SucceededCreateTag: ({ source, tag }) => {
      const withTag = evo(model, { tags: () => [...model.tags, tag].sort(byLabel) })
      return source === 'draft'
        ? [evo(withTag, { draftTagIds: () => toggleIn(withTag.draftTagIds, tag.id) }), []]
        : [evo(withTag, { uploadTagIds: () => toggleIn(withTag.uploadTagIds, tag.id) }), []]
    },

    // ----- upload dialog ------------------------------------------------------------
    OpenUpload: () => {
      const [nextDialog, dialogCommands] = Dialog.open(model.uploadDialog)
      return [
        evo(model, { uploadDialog: () => nextDialog }),
        liftChildCommands(dialogCommands, (message) => Message.GotUploadDialogMessage({ message })),
      ]
    },
    FilesReceived: ({ keys }) => {
      const existing = new Set(model.queue.map((item) => item.id))
      const fresh = keys.filter((key) => !existing.has(key)).map(toQueueItem)
      return [evo(model, { queue: () => [...model.queue, ...fresh] }), []]
    },
    RemoveQueueItem: ({ id }) => {
      fileStore.delete(id)
      return [evo(model, { queue: () => model.queue.filter((item) => item.id !== id) }), []]
    },
    ClearFinishedItems: () => [
      evo(model, { queue: () => model.queue.filter((item) => item.status === 'failed') }),
      [],
    ],
    SetUploadTakenAt: ({ value }) => [evo(model, { uploadTakenAt: () => value }), []],
    StartUploads: () => {
      const pending = model.queue.find((item) => item.status === 'pending')
      if (pending === undefined) return [model, []]
      return [
        evo(model, { uploading: () => true }),
        [
          UploadItemCmd({
            itemId: pending.id,
            tagIds: [...model.uploadTagIds],
            takenAt: model.uploadTakenAt,
          }),
        ],
      ]
    },
    RetryUpload: ({ id }) => {
      const retried = evo(model, {
        queue: () =>
          model.queue.map((item) =>
            item.id === id
              ? // `error` is optional; spread-clear it (evo cannot add keys).
                { ...item, status: 'pending' as const, error: undefined }
              : item,
          ),
      })
      // A batch already in flight picks the item up on its next chain step;
      // an idle batch starts a fresh chain here.
      if (model.uploading) return [retried, []]
      return [
        evo(retried, { uploading: () => true }),
        [
          UploadItemCmd({
            itemId: id,
            tagIds: [...retried.uploadTagIds],
            takenAt: retried.uploadTakenAt,
          }),
        ],
      ]
    },
    RetryAllFailed: () => {
      const failedIds = model.queue.filter((item) => item.status === 'failed').map((item) => item.id)
      if (failedIds.length === 0) return [model, []]
      const retried = evo(model, {
        queue: () =>
          model.queue.map((item) =>
            item.status === 'failed'
              ? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- clearing optional error
                ({ ...item, status: 'pending' as const, error: undefined } as typeof item)
              : item,
          ),
      })
      if (model.uploading) return [retried, []]
      const first = failedIds[0]
      if (first === undefined) return [retried, []]
      return [
        evo(retried, { uploading: () => true }),
        [
          UploadItemCmd({
            itemId: first,
            tagIds: [...retried.uploadTagIds],
            takenAt: retried.uploadTakenAt,
          }),
        ],
      ]
    },
    RunUpload: () => [model, []],
    SucceededUploadItem: ({ itemId }) => runNextOrFinish(markItem(model, itemId, 'done')),
    FailedUploadItem: ({ itemId, message }) =>
      runNextOrFinish(markItem(model, itemId, 'failed', message)),
    ToggleUploadTag: ({ tagId }) => [
      evo(model, { uploadTagIds: () => toggleIn(model.uploadTagIds, tagId) }),
      [],
    ],

    // ----- destructive confirmation ---------------------------------------------------
    RequestDeletePhoto: ({ id, label }) => openConfirm(model, { kind: 'photo', id, label }),
    RequestDeleteTag: ({ id, label }) => openConfirm(model, { kind: 'tag', id, label }),
    ConfirmPending: () => {
      const pending = model.pendingConfirm
      if (pending === undefined) return [model, []]
      const [closedDialog, closeCommands] = Dialog.close(model.confirmDialog)
      const cleared = evo(model, {
        confirmDialog: () => closedDialog,
        pendingConfirm: () => undefined,
      })
      const command =
        pending.kind === 'photo'
          ? DeletePhotoCmd({ id: pending.id })
          : DeleteTagCmd({ id: pending.id })
      return [
        cleared,
        [
          command,
          ...liftChildCommands(closeCommands, (message) => Message.GotConfirmMessage({ message })),
        ],
      ]
    },
    DeletedPhoto: ({ photos }) => {
      // Deleting from the edit sheet must also dismiss it (and drop the edit
      // state) — otherwise it lingers over a photo that no longer exists.
      const [closedSheet, closeCommands] = Sheet.close(model.editSheet)
      const refreshed = evo(model, {
        photos: () => [...photos],
        nextCursor: () => null,
        loadingMore: () => false,
        editSheet: () => closedSheet,
        draft: () => emptyDraft(),
        draftTagIds: () => [],
        ...(model.editingId !== undefined ? { editingId: () => undefined } : {}),
      })
      return showToast(
        refreshed,
        'Deleted',
        'Success',
        undefined,
        liftChildCommands(closeCommands, (message) => Message.GotEditSheetMessage({ message })),
      )
    },
    DeletedTag: ({ tags, photos }) =>
      showToast(
        evo(model, {
          tags: () => tags ?? [],
          photos: () => [...photos],
          nextCursor: () => null,
          loadingMore: () => false,
        }),
        'Tag deleted',
        'Success',
      ),

    // ----- child message folds ----------------------------------------------------------
    GotEditSheetMessage: ({ message }) => foldSheet(model, message),
    GotUploadDialogMessage: ({ message }) => foldUploadDialog(model, message),
    GotConfirmMessage: ({ message }) => foldConfirm(model, message),
    GotFileDropMessage: ({ message }) => foldFileDrop(model, message),
    GotToastMessage: ({ message }) => foldToast(model, message),

    // SAFETY: the carrier is S.Unknown because the multi-combobox child
    // message schema is not part of @foldkit/ui's public surface; these
    // messages were produced by this module's own toParentMessage wrapper.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    GotDraftComboMessage: ({ message }) => foldDraftCombo(model, message as never),
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    GotUploadComboMessage: ({ message }) => foldUploadCombo(model, message as never),
  })

const openConfirm = (model: Model, pending: NonNullable<Model['pendingConfirm']>): UpdateReturn => {
  // `pendingConfirm` is optional; assign via spread (see `withOptional`).
  const armed = withOptional(model, { pendingConfirm: pending })
  const [nextDialog, dialogCommands] = Dialog.open(armed.confirmDialog)
  return [
    evo(armed, { confirmDialog: () => nextDialog }),
    liftChildCommands(dialogCommands, (message) => Message.GotConfirmMessage({ message })),
  ]
}

export function update(model: Model, message: Msg): UpdateReturn {
  return step(model, message)
}
