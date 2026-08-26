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
  releaseFinishedItems,
} from './children'
import {
  byLabel,
  disposeItemAssets,
  liftChildCommands,
  photoCountLabel,
  showToast,
  toggleIn,
  withOptional,
  type UpdateReturn,
} from './helpers'
import { AdminToast, emptyDraft, abortStore, Message } from './model'
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
    selectedId: null,
    editSheet: Sheet.init({ id: 'admin-edit-sheet' }),
    draft: emptyDraft(),
    draftTagIds: [],
    draftCombo: Multi.init({ id: 'admin-draft-combo' }),
    saving: false,
    uploadDialog: Dialog.init({ id: 'admin-upload-dialog' }),
    fileDrop: FileDrop.init({ id: 'admin-file-drop' }),
    queue: [],
    batchTotal: 0,
    uploadTagIds: [],
    uploadCombo: Multi.init({ id: 'admin-upload-combo' }),
    uploadTakenAt: '',
    uploading: false,
    confirmDialog: Dialog.init({ id: 'admin-confirm-dialog' }),
    toast: AdminToast.init({ id: 'admin-toasts' }),
  },
  [FetchPhotosCmd({ tagSlug: '' }), FetchTagsCmd()],
]

// ---------------------------------------------------------------------------
// upload chaining
// ---------------------------------------------------------------------------

/** Flip one item back to `pending`, clearing any error text. Used by retry
 *  and by the cancel path (a late failure after Stop is not an error). */
const restorePending = (model: Model, itemId: string): Model =>
  evo(model, {
    queue: () =>
      model.queue.map((item) =>
        item.id === itemId
          ? // `error` is optional; spread-clear it (evo cannot add keys).
            { ...item, status: 'pending' as const, error: undefined }
          : item,
      ),
  })

/** The one way a run advances: mark the item `uploading` and issue its
 *  command. Every chain-start site goes through here so exactly one row is
 *  ever in-flight — CancelUploads finds it, and the row badge reflects it. */
const startItem = (model: Model, itemId: string): UpdateReturn => [
  evo(model, {
    queue: () =>
      model.queue.map((item) =>
        item.id === itemId ? evo(item, { status: () => 'uploading' }) : item,
      ),
  }),
  [
    UploadItemCmd({
      itemId,
      tagIds: [...model.uploadTagIds],
      takenAt: model.uploadTakenAt,
    }),
  ],
]

/** Snapshot the finished batch's counts BEFORE any queue cleanup, so the
 *  toast stays truthful no matter what gets released afterwards. A clean
 *  batch clears itself; a partial one keeps its rows for retry. */
const runNextOrFinish = (model: Model): UpdateReturn => {
  const pending = model.queue.find((item) => item.status === 'pending')
  if (pending !== undefined) return startItem(model, pending.id)
  const uploadedCount = model.queue.filter((item) => item.status === 'done').length
  const failedCount = model.queue.filter((item) => item.status === 'failed').length
  const settled = evo(model, { uploading: () => false })
  // The dialog was closed mid-batch: the queue stayed alive so uploads could
  // chain; now that the last item settled, drop everything not stuck.
  const finished =
    failedCount === 0 || !settled.uploadDialog.isOpen ? releaseFinishedItems(settled) : settled
  const refresh = FetchPhotosCmd({ tagSlug: model.activeTagSlug ?? '' })
  return failedCount === 0
    ? showToast(
        finished,
        `Uploaded ${photoCountLabel(uploadedCount)}`,
        'Success',
        undefined,
        [refresh],
      )
    : showToast(
        finished,
        `${String(uploadedCount)} uploaded, ${String(failedCount)} failed`,
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
// lightbox selection helpers
// ---------------------------------------------------------------------------

/** Drop the lightbox selection when its photo is no longer in the list
 *  (deleted, or filtered out by the active tag). */
const retainSelection = (model: Model): Model =>
  model.selectedId !== null && !model.photos.some((photo) => photo.id === model.selectedId)
    ? evo(model, { selectedId: () => null })
    : model

/** Move the lightbox selection by `delta` positions within the loaded list,
 *  wrapping at the ends. No-op when nothing is selected. */
const stepSelection = (model: Model, delta: 1 | -1): Model => {
  const index = model.photos.findIndex((photo) => photo.id === model.selectedId)
  if (index === -1 || model.photos.length === 0) return model
  const nextIndex = (index + delta + model.photos.length) % model.photos.length
  const next = model.photos[nextIndex]
  return next === undefined ? model : evo(model, { selectedId: () => next.id })
}

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
      retainSelection(
        evo(model, {
        photos: () => [...photos],
        nextCursor: () => nextCursor ?? null,
        loadingMore: () => false,
        status: () => 'ready',
        error: () => undefined,
      }),
      ),
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
            tagSlug: model.activeTagSlug ?? '',
            cursor: model.nextCursor,
          }),
        ],
      ]
    },

    // ----- filter bar -----------------------------------------------------------
    RetryFetch: () => [model, [FetchPhotosCmd({ tagSlug: model.activeTagSlug ?? '' })]],
    FilterByTag: ({ slug }) => {
      const current = model.activeTagSlug ?? ''
      const next = current === slug ? undefined : slug
      // `activeTagSlug` is optional; assign via spread (see `withOptional`).
      const nextModel = withOptional(model, { activeTagSlug: next })
      return [retainSelection(nextModel), [FetchPhotosCmd({ tagSlug: next ?? '' })]]
    },

    // ----- lightbox ---------------------------------------------------------------
    ClickedPhoto: ({ id }) => [evo(model, { selectedId: () => id }), []],
    CloseLightbox: () => [evo(model, { selectedId: () => null }), []],
    NextPhoto: () => [stepSelection(model, 1), []],
    PrevPhoto: () => [stepSelection(model, -1), []],

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
    SaveEdits: () => {
      if (model.editingId === undefined) return [model, []]
      return [
        evo(model, { saving: () => true }),
        [SaveEditsCmd({ id: model.editingId, draft: model.draft, tagIds: [...model.draftTagIds] })],
      ]
    },
    SavedEdits: ({ photos }) => {
      const [closedSheet, closeCommands] = Sheet.close(model.editSheet)
      const saved = retainSelection(
        evo(model, {
        photos: () => [...photos],
        nextCursor: () => null,
        loadingMore: () => false,
        editSheet: () => closedSheet,
        editingId: () => undefined,
        saving: () => false,
      }),
      )
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
    ClearFinishedItems: () => {
      // Only 'done' rows go — pending/uploading items must survive (their
      // bytes would leak in fileStore otherwise), failures stay for retry.
      for (const item of model.queue) {
        if (item.status === 'done') disposeItemAssets(item.id)
      }
      return [evo(model, { queue: () => model.queue.filter((item) => item.status !== 'done') }), []]
    },
    RemoveQueueItem: ({ id }) => {
      disposeItemAssets(id)
      return [evo(model, { queue: () => model.queue.filter((item) => item.id !== id) }), []]
    },
    SetUploadTakenAt: ({ value }) => [evo(model, { uploadTakenAt: () => value }), []],
    StartUploads: () => {
      const pending = model.queue.find((item) => item.status === 'pending')
      if (pending === undefined) return [model, []]
      return startItem(
        evo(model, { uploading: () => true, batchTotal: () => model.queue.length }),
        pending.id,
      )
    },
    CancelUploads: () => {
      // Abort the in-flight request; its FailedUploadItem arrives later and,
      // seeing `uploading` already false, quietly re-queues the item instead
      // of recording a failure or chaining on. Pending rows stay queued.
      const inFlight = model.queue.find((item) => item.status === 'uploading')
      if (inFlight !== undefined) abortStore.get(inFlight.id)?.abort()
      return [evo(model, { uploading: () => false }), []]
    },
    RetryUpload: ({ id }) => {
      const retried = restorePending(model, id)
      // A batch already in flight picks the item up on its next chain step;
      // an idle batch starts a fresh run here.
      if (model.uploading) return [retried, []]
      return startItem(
        evo(retried, { uploading: () => true, batchTotal: () => retried.queue.length }),
        id,
      )
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
      return startItem(
        evo(retried, { uploading: () => true, batchTotal: () => retried.queue.length }),
        first,
      )
    },
    SucceededUploadItem: ({ itemId }) => {
      const marked = markItem(model, itemId, 'done')
      // A settle racing a just-issued Stop: record it, but don't revive the
      // stopped run by chaining on.
      if (!model.uploading) return [marked, []]
      return runNextOrFinish(marked)
    },
    FailedUploadItem: ({ itemId, message }) => {
      // Post-Stop arrival (the aborted fetch's error): not a failure — put
      // the item back in line and leave the run stopped.
      if (!model.uploading) return [restorePending(model, itemId), []]
      return runNextOrFinish(markItem(model, itemId, 'failed', message))
    },

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
      const refreshed = retainSelection(
        evo(model, {
        photos: () => [...photos],
        nextCursor: () => null,
        loadingMore: () => false,
        editSheet: () => closedSheet,
        draft: () => emptyDraft(),
        draftTagIds: () => [],
        ...(model.editingId !== undefined ? { editingId: () => undefined } : {}),
      }),
      )
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
        retainSelection(
          evo(model, {
          tags: () => tags ?? [],
          photos: () => [...photos],
          nextCursor: () => null,
          loadingMore: () => false,
        }),
        ),
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
