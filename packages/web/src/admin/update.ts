/**
 * Admin update core: message → (model, commands) transition plus init.
 * Uploaded bytes live in `fileStore` keyed by queue-item id so the Model
 * stays serializable. RPC commands live in `commands.ts`; child submodel
 * folds in `children.ts`; shared helpers in `helpers.ts`.
 */

import { Multi } from '@foldkit/ui/combobox'
import { evo } from 'foldkit/struct'

import * as Dialog from '@/components/ui/dialog'
import * as FileDrop from '@/components/ui/file-drop'
import * as Sheet from '@/components/ui/sheet'

import {
  CreateTagCmd,
  DeletePhotoCmd,
  DeleteTagCmd,
  FetchMoreCmd,
  FetchPhotosCmd,
  FetchTagsCmd,
  SaveEditsCmd,
  SearchDebounceCmd,
  UploadItemCmd,
} from './commands'
import {
  foldConfirm,
  foldDraftCombo,
  foldFileDrop,
  foldSheet,
  foldToast,
  foldUploadCombo,
  foldUploadDialog,
} from './children'
import {
  byLabel,
  liftChildCommands,
  showToast,
  toggleIn,
  toQueueItem,
  withOptional,
  type UpdateReturn,
} from './helpers'
import { AdminToast, emptyDraft, fileStore, Message } from './model'
import type { Message as Msg, Model } from './model'

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export const init = (): readonly [Model, UpdateReturn[1]] => [
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

function step(current: Model, message: Msg, prior: UpdateReturn[1] = []): UpdateReturn {
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
        [
          FetchMoreCmd({
            q: model.search,
            tagSlug: model.activeTagSlug ?? '',
            cursor: model.nextCursor,
          }),
        ],
      ]
    },

    // ----- filter bar -----------------------------------------------------------
    SetSearch: ({ value }) => [evo(model, { search: () => value }), [SearchDebounceCmd({ value })]],
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
      const failedIds = model.queue
        .filter((item) => item.status === 'failed')
        .map((item) => item.id)
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
