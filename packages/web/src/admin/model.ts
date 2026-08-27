/**
 * Admin Model + Message (the TEA core). See CONTEXT.md — this surface is the
 * Admin: one operator browsing Photos, uploading originals, editing metadata,
 * and managing Tags.
 */

import { Schema as S } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { PhotoWithTags, Tag } from '@photo/shared'

import { Multi } from '@foldkit/ui/combobox'
import * as Dialog from '@/components/ui/dialog'
import * as Sheet from '@/components/ui/sheet'
import * as FileDrop from '@/components/ui/file-drop'
import * as Toast from '@/components/ui/toast'

import * as TagManager from './tag-manager'

// ---------------------------------------------------------------------------
// Submodel bundles
// ---------------------------------------------------------------------------

/** Multi-select tag picker: values are Tag ids; a `create:<label>`
 *  pseudo-item appears when the typed text matches no existing label. */
/** Explicit annotation: the inferred bundle type is not portable. The
 *  Model schema comes from the same namespace (`Multi.Model`). */
export const TagMultiCombo: Multi.Bundle<string> = Multi.create()

/** Toast payload: what the operator sees in the corner stack. */
export const AdminToast = Toast.make(
  S.Struct({
    title: S.String,
    detail: S.optional(S.String),
  }),
)

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const QueueStatus = S.Literals(['pending', 'uploading', 'done', 'failed'])
export type QueueStatus = typeof QueueStatus.Type

export const QueueItem = S.Struct({
  /** Stable key: `${name}:${size}`. */
  id: S.String,
  name: S.String,
  size: S.Number,
  status: QueueStatus,
  error: S.optional(S.String),
})
export type QueueItem = typeof QueueItem.Type

export const DraftFields = S.Struct({
  title: S.String,
  slug: S.String,
  takenAt: S.String,
  caption: S.String,
  location: S.String,
  camera: S.String,
  lens: S.String,
})
export type DraftFields = typeof DraftFields.Type

export const emptyDraft = (): DraftFields => ({
  title: '',
  slug: '',
  takenAt: '',
  caption: '',
  location: '',
  camera: '',
  lens: '',
})

/** The photo or tag awaiting destructive confirmation. */
export const PendingConfirm = S.Union([
  S.Struct({ kind: S.Literal('photo'), id: S.String, label: S.String }),
  S.Struct({ kind: S.Literal('tag'), id: S.String, label: S.String }),
])
export type PendingConfirm = typeof PendingConfirm.Type

export const UPLOAD_LIMITS = {
  maxFiles: 50,
  maxFileSize: 20 * 1024 * 1024,
} as const

/** Column counts offered by the admin grid toggle (see `views/grid.ts`). */
export const GridCols = S.Literals([2, 3, 4, 5, 6])
export type GridCols = typeof GridCols.Type

/** In-flight upload abort handles, keyed by queue-item id — the Model stays
 *  serializable. Registered by `UploadItemCmd`; aborted by `CancelUploads`. */
export const abortStore = new Map<string, AbortController>()

/** Object-URL previews keyed by queue-item id (`${name}:${size}`), so rows
 *  can show what they are instead of a filename. Populated client-side when
 *  files are dropped; disposed alongside their bytes via `disposeItemAssets`. */
export const previewStore = new Map<string, string>()

export const Model = S.Struct({
  status: S.Literals(['loading', 'ready', 'error']),
  error: S.optional(S.String),
  photos: S.Array(PhotoWithTags),
  tags: S.Array(Tag),
  nextCursor: S.NullOr(S.String),
  loadingMore: S.Boolean,

  // filter bar
  activeTagSlug: S.optional(S.String),

  // tag manager bar (chips + inline create)
  tagManager: TagManager.Model,

  // grid density: number of square-tile columns (persisted to localStorage)
  cols: GridCols,

  // lightbox: photo currently shown full-size; null while browsing the grid
  selectedId: S.NullOr(S.String),

  // edit sheet
  editSheet: Sheet.Model,
  editingId: S.optional(S.String),
  draft: DraftFields,
  draftTagIds: S.Array(S.String),
  draftCombo: Multi.Model,
  saving: S.Boolean,

  // upload dialog
  uploadDialog: Dialog.Model,
  fileDrop: FileDrop.Model,
  queue: S.Array(QueueItem),
  /** Files targeted by the current run — snapshot, see `batchTotalField`. */
  batchTotal: S.Number,
  uploadTagIds: S.Array(S.String),
  uploadCombo: Multi.Model,
  uploadTakenAt: S.String,
  uploading: S.Boolean,

  // destructive confirmation
  confirmDialog: Dialog.Model,
  pendingConfirm: S.optional(PendingConfirm),

  // toasts
  toast: AdminToast.Model,
})
export type Model = typeof Model.Type

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export const Message = defineMessageUnion({
  // data
  SucceededFetchPhotos: {
    photos: S.Array(PhotoWithTags),
    nextCursor: S.NullOr(S.String),
  },
  SucceededFetchTags: { tags: S.Array(Tag) },
  FailedRpc: { message: S.String },
  LoadMore: {},
  SucceededFetchMore: {
    photos: S.Array(PhotoWithTags),
    nextCursor: S.NullOr(S.String),
  },

  // filter bar
  FilterByTag: { slug: S.String },
  RetryFetch: {},

  // grid density
  SelectedCols: { cols: GridCols },
  CompletedPersistCols: {},

  // lightbox
  ClickedPhoto: { id: S.String },
  CloseLightbox: {},
  NextPhoto: {},
  PrevPhoto: {},

  // edit sheet
  OpenEdit: { photo: PhotoWithTags },
  SetDraftField: {
    field: S.Literals(['title', 'slug', 'takenAt', 'caption', 'location', 'camera', 'lens']),
    value: S.String,
  },
  SaveEdits: {},
  SavedEdits: { photos: S.Array(PhotoWithTags) },
  GotEditSheetMessage: { message: Sheet.Message },
  GotDraftComboMessage: { message: S.Unknown },

  // create tag inline (from either combo or the tag manager bar)
  CreateTagRequested: {
    source: S.Literals(['draft', 'upload', 'manager']),
    label: S.String,
  },

  // remove a picked tag from the edit-sheet / upload-dialog chip row
  RemoveDraftTag: { id: S.String },
  RemoveUploadTag: { id: S.String },

  SucceededCreateTag: {
    source: S.Literals(['draft', 'upload', 'manager']),
    tag: Tag,
  },

  // upload dialog
  OpenUpload: {},
  GotUploadDialogMessage: { message: Dialog.Message },
  GotFileDropMessage: { message: FileDrop.Message },
  RemoveQueueItem: { id: S.String },
  RetryUpload: { id: S.String },
  RetryAllFailed: {},
  SetUploadTakenAt: { value: S.String },
  StartUploads: {},
  /** Stops the run: aborts the in-flight request, halts the chain, leaves
   *  not-yet-uploaded items queued as `pending`. */
  CancelUploads: {},
  SucceededUploadItem: { itemId: S.String },
  FailedUploadItem: { itemId: S.String, message: S.String },
  ClearFinishedItems: {},
  GotUploadComboMessage: { message: S.Unknown },

  // destructive confirmation
  RequestDeletePhoto: { id: S.String, label: S.String },
  RequestDeleteTag: { id: S.String, label: S.String },
  ConfirmPending: {},
  DeletedPhoto: { id: S.String, photos: S.Array(PhotoWithTags) },
  DeletedTag: { tags: S.Array(Tag), photos: S.Array(PhotoWithTags) },
  GotConfirmMessage: { message: Dialog.Message },

  // tag manager bar
  GotTagManagerMessage: { message: TagManager.Message },

  // toasts
  GotToastMessage: { message: AdminToast.Message },
})

export type Message = typeof Message.Type
/** Short alias used across the admin modules. */
export type Msg = Message

/** Uploaded bytes are not part of the serializable Model; they live here,
 *  keyed by queue-item id (`${name}:${size}`), until their upload completes. */
export const fileStore = new Map<string, File>()
