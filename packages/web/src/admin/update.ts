/**
 * Admin update core: message → (model, commands) transition plus init.
 * Uploaded bytes live in `fileStore` keyed by queue-item id so the Model
 * stays serializable. RPC commands live in `commands.ts`; child submodel
 * folds in `children.ts`; shared helpers in `helpers.ts`.
 */

import { Multi } from '@foldkit/ui/combobox'
import { modifyFields } from 'foldkit/struct'
import * as Update from 'foldkit/update'

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
  PersistColsCmd,
  SaveEditsCmd,
  UploadItemCmd,
  readStoredCols,
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
  type Commands,
  type UpdateReturn,
} from './helpers'
import { AdminToast, emptyDraft, abortStore, Message } from './model'
import type { Message as Msg, Model } from './model'
import * as TagManager from './tag-manager'

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export const init = (): Update.Return<Model, Msg> => ({
  model: {
    status: 'loading',
    photos: [],
    tags: [],
    nextCursor: null,
    loadingMore: false,
    cols: readStoredCols(),
    selectedId: null,
    editSheet: Sheet.init({ id: 'admin-edit-sheet' }),
    draft: emptyDraft(),
    draftTagIds: [],
    draftCombo: Multi.init({ id: 'admin-draft-combo' }),
    saving: false,
    // filter bar (chips + inline create)
    tagManager: TagManager.init({ id: 'admin-tag-manager' }),

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
  commands: [FetchPhotosCmd({ tagSlug: '' }), FetchTagsCmd()],
})

// ---------------------------------------------------------------------------
// upload chaining
// ---------------------------------------------------------------------------

/** Flip one item back to `pending`, clearing any error text. Used by retry
 *  and by the cancel path (a late failure after Stop is not an error). */
const restorePending = (model: Model, itemId: string): Model =>
  modifyFields(model, {
    queue: () =>
      model.queue.map((item) =>
        item.id === itemId
          ? // `error` is optional; spread-clear it (modifyFields cannot add keys).
            { ...item, status: 'pending' as const, error: undefined }
          : item,
      ),
  })

/** The one way a run advances: mark the item `uploading` and issue its
 *  command. Every chain-start site goes through here so exactly one row is
 *  ever in-flight — CancelUploads finds it, and the row badge reflects it. */
const startItem = (model: Model, itemId: string): UpdateReturn => ({
  model: modifyFields(model, {
    queue: () =>
      model.queue.map((item) =>
        item.id === itemId ? modifyFields(item, { status: () => 'uploading' }) : item,
      ),
  }),
  commands: [
    UploadItemCmd({
      itemId,
      tagIds: [...model.uploadTagIds],
      takenAt: model.uploadTakenAt,
    }),
  ],
})

/** Snapshot the finished batch's counts BEFORE any queue cleanup, so the
 *  toast stays truthful no matter what gets released afterwards. A clean
 *  batch clears itself; a partial one keeps its rows for retry. */
const runNextOrFinish = (model: Model): UpdateReturn => {
  const pending = model.queue.find((item) => item.status === 'pending')
  if (pending !== undefined) return startItem(model, pending.id)
  const uploadedCount = model.queue.filter((item) => item.status === 'done').length
  const failedCount = model.queue.filter((item) => item.status === 'failed').length
  const settled = modifyFields(model, { uploading: () => false })
  // The dialog was closed mid-batch: the queue stayed alive so uploads could
  // chain; now that the last item settled, drop everything not stuck.
  const finished =
    failedCount === 0 || !settled.uploadDialog.isOpen ? releaseFinishedItems(settled) : settled
  const refresh = FetchPhotosCmd({ tagSlug: model.activeTagSlug ?? '' })
  return failedCount === 0
    ? showToast(finished, `Uploaded ${photoCountLabel(uploadedCount)}`, 'Success', undefined, [
        refresh,
      ])
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
  modifyFields(model, {
    queue: () =>
      model.queue.map((item) =>
        item.id === itemId
          ? errorMessage === undefined
            ? modifyFields(item, { status: () => status })
            : // `error` is optional; assign via spread — modifyFields cannot add keys.
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
    ? modifyFields(model, { selectedId: () => null })
    : model

/** Move the lightbox selection by `delta` positions within the loaded list,
 *  wrapping at the ends. No-op when nothing is selected. */
const stepSelection = (model: Model, delta: 1 | -1): Model => {
  const index = model.photos.findIndex((photo) => photo.id === model.selectedId)
  if (index === -1 || model.photos.length === 0) return model
  const nextIndex = (index + delta + model.photos.length) % model.photos.length
  const next = model.photos[nextIndex]
  return next === undefined ? model : modifyFields(model, { selectedId: () => next.id })
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

function step(current: Model, message: Msg, prior: Commands = []): UpdateReturn {
  const result = transition(current, message)
  const commands = [...prior, ...(result.commands ?? [])]
  return commands.length > 0 ? { model: result.model, commands } : { model: result.model }
}

/** Apply (or toggle off) the tag filter: refetch the first page through the
 *  slug and drop a lightbox selection the filtered list can no longer back.
 *  Shared by FilterByTag and the TagManager bar's ToggledFilter intent. */
const applyTagFilter = (model: Model, slug: string): UpdateReturn => {
  const current = model.activeTagSlug ?? ''
  const next = current === slug ? undefined : slug
  // `activeTagSlug` is optional; assign via spread (see `withOptional`).
  const nextModel = withOptional(model, { activeTagSlug: next })
  return {
    model: retainSelection(nextModel),
    commands: [FetchPhotosCmd({ tagSlug: next ?? '' })],
  }
}

const transition = (model: Model, message: Msg): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    // ----- data ---------------------------------------------------------------
    SucceededFetchPhotos: ({ photos, nextCursor }) => ({
      model: retainSelection(
        modifyFields(model, {
          photos: () => [...photos],
          nextCursor: () => nextCursor ?? null,
          loadingMore: () => false,
          status: () => 'ready',
          error: () => undefined,
        }),
      ),
    }),
    SucceededFetchMore: ({ photos, nextCursor }) => ({
      model: modifyFields(model, {
        photos: () => [...model.photos, ...photos],
        nextCursor: () => nextCursor ?? null,
        loadingMore: () => false,
      }),
    }),
    SucceededFetchTags: ({ tags }) => ({ model: modifyFields(model, { tags: () => tags ?? [] }) }),
    FailedRpc: ({ message: failure }) => {
      // `error` is optional and may be absent from normalized state; assign
      // via spread (see `withOptional`) instead of modifyFields.
      const errored = withOptional(modifyFields(model, { loadingMore: () => false }), {
        status: 'error',
        error: failure,
      })
      return showToast(errored, 'Something went wrong', 'Error', failure)
    },
    LoadMore: () => {
      if (model.nextCursor === null || model.loadingMore) return { model }
      return {
        model: modifyFields(model, { loadingMore: () => true }),
        commands: [
          FetchMoreCmd({
            tagSlug: model.activeTagSlug ?? '',
            cursor: model.nextCursor,
          }),
        ],
      }
    },

    // ----- filter bar -----------------------------------------------------------
    RetryFetch: () => ({
      model,
      commands: [FetchPhotosCmd({ tagSlug: model.activeTagSlug ?? '' })],
    }),
    FilterByTag: ({ slug }) => applyTagFilter(model, slug),

    // ----- grid density ------------------------------------------------------------
    SelectedCols: ({ cols }) => ({
      model: modifyFields(model, { cols: () => cols }),
      commands: [PersistColsCmd({ cols })],
    }),
    CompletedPersistCols: () => ({ model }),

    // ----- lightbox ---------------------------------------------------------------
    ClickedPhoto: ({ id }) => ({ model: modifyFields(model, { selectedId: () => id }) }),
    CloseLightbox: () => ({ model: modifyFields(model, { selectedId: () => null }) }),
    NextPhoto: () => ({ model: stepSelection(model, 1) }),
    PrevPhoto: () => ({ model: stepSelection(model, -1) }),

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
      const prepared = modifyFields(started, {
        draft: () => draft,
        draftTagIds: () => (photo.tags ?? []).map((tag) => tag.id),
      })
      const sheetOpened = Sheet.open(prepared.editSheet)
      return {
        model: modifyFields(prepared, { editSheet: () => sheetOpened.model }),
        commands: liftChildCommands(sheetOpened.commands ?? [], (message) =>
          Message.GotEditSheetMessage({ message }),
        ),
      }
    },
    SetDraftField: ({ field, value }) => ({
      model: modifyFields(model, {
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
    }),
    SaveEdits: () => {
      if (model.editingId === undefined) return { model }
      return {
        model: modifyFields(model, { saving: () => true }),
        commands: [
          SaveEditsCmd({ id: model.editingId, draft: model.draft, tagIds: [...model.draftTagIds] }),
        ],
      }
    },
    SavedEdits: ({ photos }) => {
      const sheetClosed = Sheet.close(model.editSheet)
      const saved = retainSelection(
        modifyFields(model, {
          photos: () => [...photos],
          nextCursor: () => null,
          loadingMore: () => false,
          editSheet: () => sheetClosed.model,
          editingId: () => undefined,
          saving: () => false,
        }),
      )
      return showToast(
        saved,
        'Saved',
        'Success',
        undefined,
        liftChildCommands(sheetClosed.commands ?? [], (message) =>
          Message.GotEditSheetMessage({ message }),
        ),
      )
    },
    // ----- create tag inline ------------------------------------------------------
    CreateTagRequested: ({ source, label }) => ({
      model,
      commands: [CreateTagCmd({ source, label })],
    }),
    SucceededCreateTag: ({ source, tag }) => {
      const withTag = modifyFields(model, { tags: () => [...model.tags, tag].sort(byLabel) })
      if (source === 'draft') {
        return {
          model: modifyFields(withTag, {
            draftTagIds: () => toggleIn(withTag.draftTagIds, tag.id),
          }),
        }
      }
      if (source === 'upload') {
        return {
          model: modifyFields(withTag, {
            uploadTagIds: () => toggleIn(withTag.uploadTagIds, tag.id),
          }),
        }
      }
      return showToast(withTag, `Created tag “${tag.label}”`, 'Success')
    },
    RemoveDraftTag: ({ id }) => ({
      model: modifyFields(model, { draftTagIds: () => toggleIn(model.draftTagIds, id) }),
    }),
    RemoveUploadTag: ({ id }) => ({
      model: modifyFields(model, { uploadTagIds: () => toggleIn(model.uploadTagIds, id) }),
    }),

    // ----- upload dialog ------------------------------------------------------------
    OpenUpload: () => {
      const dialogOpened = Dialog.open(model.uploadDialog)
      return {
        model: modifyFields(model, { uploadDialog: () => dialogOpened.model }),
        commands: liftChildCommands(dialogOpened.commands ?? [], (message) =>
          Message.GotUploadDialogMessage({ message }),
        ),
      }
    },
    ClearFinishedItems: () => {
      // Only 'done' rows go — pending/uploading items must survive (their
      // bytes would leak in fileStore otherwise), failures stay for retry.
      for (const item of model.queue) {
        if (item.status === 'done') disposeItemAssets(item.id)
      }
      return {
        model: modifyFields(model, {
          queue: () => model.queue.filter((item) => item.status !== 'done'),
        }),
      }
    },
    RemoveQueueItem: ({ id }) => {
      disposeItemAssets(id)
      return {
        model: modifyFields(model, { queue: () => model.queue.filter((item) => item.id !== id) }),
      }
    },
    SetUploadTakenAt: ({ value }) => ({
      model: modifyFields(model, { uploadTakenAt: () => value }),
    }),
    StartUploads: () => {
      const pending = model.queue.find((item) => item.status === 'pending')
      if (pending === undefined) return { model }
      return startItem(
        modifyFields(model, { uploading: () => true, batchTotal: () => model.queue.length }),
        pending.id,
      )
    },
    CancelUploads: () => {
      // Abort the in-flight request; its FailedUploadItem arrives later and,
      // seeing `uploading` already false, quietly re-queues the item instead
      // of recording a failure or chaining on. Pending rows stay queued.
      const inFlight = model.queue.find((item) => item.status === 'uploading')
      if (inFlight !== undefined) abortStore.get(inFlight.id)?.abort()
      return { model: modifyFields(model, { uploading: () => false }) }
    },
    RetryUpload: ({ id }) => {
      const retried = restorePending(model, id)
      // A batch already in flight picks the item up on its next chain step;
      // an idle batch starts a fresh run here.
      if (model.uploading) return { model: retried }
      return startItem(
        modifyFields(retried, { uploading: () => true, batchTotal: () => retried.queue.length }),
        id,
      )
    },
    RetryAllFailed: () => {
      const failedIds = model.queue
        .filter((item) => item.status === 'failed')
        .map((item) => item.id)
      if (failedIds.length === 0) return { model }
      const retried = modifyFields(model, {
        queue: () =>
          model.queue.map((item) =>
            item.status === 'failed'
              ? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- clearing optional error
                ({ ...item, status: 'pending' as const, error: undefined } as typeof item)
              : item,
          ),
      })
      if (model.uploading) return { model: retried }
      const first = failedIds[0]
      if (first === undefined) return { model: retried }
      return startItem(
        modifyFields(retried, { uploading: () => true, batchTotal: () => retried.queue.length }),
        first,
      )
    },
    SucceededUploadItem: ({ itemId }) => {
      const marked = markItem(model, itemId, 'done')
      // A settle racing a just-issued Stop: record it, but don't revive the
      // stopped run by chaining on.
      if (!model.uploading) return { model: marked }
      return runNextOrFinish(marked)
    },
    FailedUploadItem: ({ itemId, message }) => {
      // Post-Stop arrival (the aborted fetch's error): not a failure — put
      // the item back in line and leave the run stopped.
      if (!model.uploading) return { model: restorePending(model, itemId) }
      return runNextOrFinish(markItem(model, itemId, 'failed', message))
    },

    // ----- destructive confirmation ---------------------------------------------------
    RequestDeletePhoto: ({ id, label }) => openConfirm(model, { kind: 'photo', id, label }),
    RequestDeleteTag: ({ id, label }) => openConfirm(model, { kind: 'tag', id, label }),
    ConfirmPending: () => {
      const pending = model.pendingConfirm
      if (pending === undefined) return { model }
      const dialogClosed = Dialog.close(model.confirmDialog)
      const cleared = modifyFields(model, {
        confirmDialog: () => dialogClosed.model,
        pendingConfirm: () => undefined,
      })
      const command =
        pending.kind === 'photo'
          ? DeletePhotoCmd({ id: pending.id })
          : DeleteTagCmd({
              id: pending.id,
              // If the dying tag IS the active filter, fetch unfiltered;
              // otherwise keep filtering by whatever is still applied.
              activeTagSlug:
                model.activeTagSlug !== undefined &&
                model.tags.find((tag) => tag.id === pending.id)?.slug === model.activeTagSlug
                  ? undefined
                  : model.activeTagSlug,
            })
      return {
        model: cleared,
        commands: [
          command,
          ...liftChildCommands(dialogClosed.commands ?? [], (message) =>
            Message.GotConfirmMessage({ message }),
          ),
        ],
      }
    },
    DeletedPhoto: ({ photos }) => {
      // Deleting from the edit sheet must also dismiss it (and drop the edit
      // state) — otherwise it lingers over a photo that no longer exists.
      const sheetClosed = Sheet.close(model.editSheet)
      const refreshed = retainSelection(
        modifyFields(model, {
          photos: () => [...photos],
          nextCursor: () => null,
          loadingMore: () => false,
          editSheet: () => sheetClosed.model,
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
        liftChildCommands(sheetClosed.commands ?? [], (message) =>
          Message.GotEditSheetMessage({ message }),
        ),
      )
    },
    DeletedTag: ({ tags, photos }) => {
      // If the deleted tag was the active filter, drop the filter — the
      // refetch already came back unfiltered (ConfirmPending cleared the
      // slug it passed to DeleteTagCmd).
      const filterSurvives =
        model.activeTagSlug === undefined || tags.some((tag) => tag.slug === model.activeTagSlug)
      const settled = retainSelection(
        modifyFields(model, {
          tags: () => tags ?? [],
          photos: () => [...photos],
          nextCursor: () => null,
          loadingMore: () => false,
        }),
      )
      return showToast(
        filterSurvives ? settled : withOptional(settled, { activeTagSlug: undefined }),
        'Tag deleted',
        'Success',
      )
    },

    // ----- child message folds ----------------------------------------------------------
    GotEditSheetMessage: ({ message }) => foldSheet(model, message),
    GotUploadDialogMessage: ({ message }) => foldUploadDialog(model, message),
    GotConfirmMessage: ({ message }) => foldConfirm(model, message),
    GotFileDropMessage: ({ message }) => foldFileDrop(model, message),
    GotToastMessage: ({ message }) => foldToast(model, message),

    // Tag manager bar: keep the child's input state in sync, then act on
    // its intents — filter toggle and delete mirror existing handlers;
    // create reuses CreateTagCmd via CreateTagRequested.
    GotTagManagerMessage: ({ message }) => {
      const tagManagerUpdate = TagManager.update(model.tagManager, message)
      const synced = modifyFields(model, { tagManager: () => tagManagerUpdate.model })
      return TagManager.Message.match<UpdateReturn>(message, {
        SetInput: () => ({ model: synced }),
        SubmitCreate: () => {
          const label = model.tagManager.inputValue.trim()
          if (label === '') return { model }
          return transition(synced, Message.CreateTagRequested({ source: 'manager', label }))
        },
        ToggledFilter: ({ slug }) => applyTagFilter(synced, slug),
        RequestedDelete: ({ id, label }) => openConfirm(synced, { kind: 'tag', id, label }),
      })
    },

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
  const dialogOpened = Dialog.open(armed.confirmDialog)
  return {
    model: modifyFields(armed, { confirmDialog: () => dialogOpened.model }),
    commands: liftChildCommands(dialogOpened.commands ?? [], (message) =>
      Message.GotConfirmMessage({ message }),
    ),
  }
}

export function update(model: Model, message: Msg): UpdateReturn {
  return step(model, message)
}
