/**
 * Admin Model + Message (the TEA core). See CONTEXT.md — this surface is the
 * Admin: one operator browsing Photos, uploading originals, editing metadata,
 * and managing Tags.
 */

import { Schema as S } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { UrlRequest } from 'foldkit/navigation'
import { Url } from 'foldkit/url'
import {
  PhotoId,
  PhotoPresentation,
  PhotoWithTags,
  RenditionFormat,
  Settings,
  Tag,
  TagId,
  WatermarkPosition,
} from '@photo/shared'

import { Multi } from '@foldkit/ui/combobox'
import * as Dialog from '@/components/ui/dialog'
import * as Sheet from '@/components/ui/sheet'
import * as FileDrop from '@/components/ui/file-drop'
import * as Segment from '@/components/ui/segment'
import * as Swatch from '@/components/ui/swatch'
import * as Toast from '@/components/ui/toast'

import { AppRoute } from './route'
import { SectionEdit, SettingsDraft } from './settings-draft'
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

/** The photo, one tag, or the whole ticked selection awaiting destructive
 *  confirmation. `bulk` carries a count because there is no single label to
 *  name forty photographs by, and it is a soft delete like the single one. */
export const PendingConfirm = S.Union([
  S.Struct({ kind: S.Literal('photo'), id: S.String, label: S.String }),
  S.Struct({ kind: S.Literal('tag'), id: S.String, label: S.String }),
  S.Struct({ kind: S.Literal('bulk'), count: S.Number }),
])
export type PendingConfirm = typeof PendingConfirm.Type

/** The fields of one page of the Library table, declared once so the
 *  `ListLibraryRows` success, the Model's own reads and every Message that
 *  carries a refreshed page are the same shape: the rows, the cursor that would
 *  follow them, and the filtered total behind them. A message union's variants
 *  are field records rather than Structs, so the Messages spread this. */
export const libraryPageFields = {
  photos: S.Array(PhotoWithTags),
  nextCursor: S.NullOr(S.String),
  /** Rows in the whole filtered set, not on this page — the Pager's `OF 412`. */
  total: S.Number,
}
export const LibraryPage = S.Struct(libraryPageFields)
export type LibraryPage = typeof LibraryPage.Type

/** Photos on one page of the Library table. The design draws seven and labels
 *  the Pager `1–7 OF 412` in two separate frames, so the page size is the
 *  canvas's number and this is the one place it is written down. */
export const LIBRARY_PAGE_SIZE = 7

/** The Mat the Bulk Bar's `Add border` puts on every ticked Photo. The design
 *  draws one ghost button and no picker, so a bulk action that asked would be
 *  scope the design does not have; the Editor's own defaults and the design's
 *  `4%` slider are the one Mat, and the toast names it so the operator is never
 *  guessing what just happened to forty photographs. */
export const BULK_BORDER_MAT = { enabled: true, style: 'even', colour: 'paper', width: 4 } as const

export const UPLOAD_LIMITS = {
  maxFiles: 50,
  maxFileSize: 20 * 1024 * 1024,
} as const

/** Column counts offered by the admin grid toggle (see `views/grid.ts`). */
export const GridCols = S.Literals([2, 3, 4, 5, 6])
export type GridCols = typeof GridCols.Type

/** The Mat's three colours, from the Swatch atom — the same three the Editor's
 *  Border panel picks between (CONTEXT.md, Mat). */
export const MatColour = S.Literals(Swatch.matColours)
export type MatColour = typeof MatColour.Type

// ---------------------------------------------------------------------------
// shell state — what the sidebar and the Page Head read
// ---------------------------------------------------------------------------

/** The Access facts behind the Admin. There is no signed-out state: Access
 *  gates the route before the app runs (ADR 0007), so `status` distinguishes
 *  "not asked yet" from "the gate refused" rather than a user who is not
 *  signed in. `email` and `teamDomain` are null only where the gate stood
 *  down, which is what hides an address and a sign-out link that would go
 *  nowhere. */
export const Session = S.Struct({
  status: S.Literals(['loading', 'verified', 'expired']),
  email: S.NullOr(S.String),
  teamDomain: S.NullOr(S.String),
})
export type Session = typeof Session.Type

/** The sidebar's counts, as `GetCounts` reports them. Declared as fields once
 *  so the Model's Struct and the Message that fills it cannot disagree. */
const countsFields = {
  total: S.Number,
  trashed: S.Number,
  byStatus: S.Struct({ draft: S.Number, published: S.Number, failed: S.Number }),
  byTag: S.Array(S.Struct({ id: TagId, label: S.String, count: S.Number })),
}
export const Counts = S.Struct(countsFields)
export type Counts = typeof Counts.Type

/** The sidebar meter's aggregate, from `GetStorageUsage`. `photos` rides in
 *  the same payload and is drawn by #37's Storage block; the sidebar reads the
 *  byte fraction and leaves the count to the block that prints it beside the
 *  byte total. One payload, one Model field, so the frame count the block
 *  reports and the fraction the meter draws cannot come from two reads. */
const storageFields = {
  photos: S.Number,
  bytes: S.Number,
  capBytes: S.Number,
}
export const Storage = S.Struct(storageFields)
export type Storage = typeof Storage.Type

/** What `/admin/atoms` remembers. Namespaced so the sheet's own state — a page
 *  number, which specimen rows are ticked, which toggles are on — is never
 *  mistaken for the Admin's. */
export const AtomsState = S.Struct({
  page: S.Number,
  /** Indexes into the specimen rows of the current page. */
  selectedRowIndexes: S.Array(S.Number),
  switches: S.Record(S.String, S.Boolean),
  inputs: S.Record(S.String, S.String),
  matColour: MatColour,
})
export type AtomsState = typeof AtomsState.Type

/** The Editor's own state. The shell draws a sidebar and a Page Head on every
 *  other route; the Editor is full-bleed, dark and has neither (CONTEXT.md,
 *  Theme scope), so its state is one block rather than a dozen fields spread
 *  through the shell's.
 *
 *  The two Stage Bar Segments are *not* here: a stateful atom keeps its
 *  selection in the shared `segmentGroups` record, so the Editor contributes
 *  two groups to it rather than two fields (see `editor.ts`). */
export const EditorTab = S.Literals(['edit', 'details'])
export type EditorTab = typeof EditorTab.Type

export const EditorState = S.Struct({
  /** Which Inspector tab is open. `EDIT` is the design's default; `DETAILS`
   *  is the record. `HISTORY` is deferred (decision 8) and no third value
   *  exists here, so nothing can select a tab that is not drawn. */
  tab: EditorTab,
  /** The Presentation as it was loaded — the value `Discard` reverts to and the
   *  one `Update` is measured against. Absent until the read answers. */
  snapshot: S.optional(PhotoPresentation),
  /** The Presentation as edited. The Stage draws *this*, not the snapshot, so
   *  an unsaved change is visible before it is saved. A copy of the snapshot
   *  rather than a set of touched fields, so `Discard` needs no bookkeeping
   *  beyond "put the snapshot back". */
  draft: S.optional(PhotoPresentation),
  saving: S.Boolean,
  /** The route the Editor was opened from, so `← Library` returns to the list
   *  the operator was reading rather than to `/admin` whatever it was. */
  returnRoute: AppRoute,
  /** `← Library`, `Escape` and the browser's own leave all ask through this.
   *  Open only while the Editor is dirty; closing it is "keep editing". */
  leaveDialog: Dialog.Model,
  /** The URL the leave guard is holding on to. Written when the guard opens,
   *  read once the operator says go, and never interpreted before that. */
  leaveUrl: S.String,
})
export type EditorState = typeof EditorState.Type

/** In-flight upload abort handles, keyed by queue-item id — the Model stays
 *  serializable. Registered by `UploadItemCmd`; aborted by `CancelUploads`. */
export const abortStore = new Map<string, AbortController>()

/** Object-URL previews keyed by queue-item id (`${name}:${size}`), so rows
 *  can show what they are instead of a filename. Populated client-side when
 *  files are dropped; disposed alongside their bytes via `disposeItemAssets`. */
export const previewStore = new Map<string, string>()

export const Model = S.Struct({
  /** The route the URL names. Every page the Admin shows is a function of it,
   *  and it is the whole of the URL's meaning in the Model. */
  route: AppRoute,
  status: S.Literals(['loading', 'ready', 'error']),
  error: S.optional(S.String),
  photos: S.Array(PhotoWithTags),
  tags: S.Array(Tag),
  nextCursor: S.NullOr(S.String),
  loadingMore: S.Boolean,

  // the shell: the session, the sidebar's two aggregates, the Page Head's search
  session: Session,
  counts: Counts,
  storage: Storage,
  /** The Page Head search's text. Submitted into the list by
   *  `SubmittedSearch`; #26 moves it into the URL. */
  searchQuery: S.String,

  // tag filter, as Tag ids. A set, not one slug: the sidebar's tag filter is
  // multi-select, and a second pick narrows the list rather than replacing the
  // first. Empty means every Photo.
  activeTagIds: S.Array(S.String),

  // tag manager bar (chips + inline create)
  tagManager: TagManager.Model,

  // the sidebar's per-tag actions: create a Tag, delete this one
  tagActions: Dialog.Model,
  /** The Tag whose actions are open, if any. */
  tagActionsId: S.optional(S.String),
  /** The label typed into the create field. */
  tagActionLabel: S.String,

  // grid density: number of square-tile columns (persisted to localStorage)
  cols: GridCols,

  // the Desk atoms sheet: one Segment group per single-select it draws
  segmentGroups: Segment.Groups,
  atoms: AtomsState,

  // the Photo route: the Photo the URL names, and how its fetch is going
  photo: S.optional(PhotoWithTags),
  photoStatus: S.Literals(['loading', 'ready', 'error']),

  // the Editor route: one block, because the Editor is a document of its own
  // rather than a page inside the shell (see `views/editor.ts`)
  editor: EditorState,

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

  // the Settings page: the singleton as the API read it, and the working copy
  // the form edits. `settingsDraft` is what every control draws and writes, and
  // the row beside it is what "unsaved" is measured against — which is why
  // there is no `dirty` field: it is the two disagreeing, not a flag to forget
  // to set.
  settings: S.optional(Settings),
  settingsStatus: S.Literals(['loading', 'ready', 'error']),
  settingsDraft: SettingsDraft,
  settingsSaving: S.Boolean,
  /** The CSV index is being built and downloaded. */
  settingsIndexing: S.Boolean,

  // ----- the Library table -----------------------------------------------------
  /** The ticked Photos. A `Set<PhotoId>` in the design's terms, an array here:
   *  the Model is compared structurally on every render, and an array is the
   *  one shape two equal sets can be written the same way. It is the only copy
   *  — there is no second list to fall out of step with it. */
  selected: S.Array(S.String),
  /** Zero-based page the table is showing. */
  libraryPage: S.Number,
  /** The cursor that opens each page, index-aligned with `libraryPage`. Page 0
   *  is the empty string: the first page has no cursor. A keyset cursor only
   *  goes forwards, so going back means re-reading a cursor already held. */
  libraryCursors: S.Array(S.String),
  /** Rows in the whole filtered set. The Pager's `OF 412`; the tri-state head
   *  checkbox is deliberately *not* measured against this — it is over the
   *  current page. */
  libraryTotal: S.Number,
  /** The Photo whose `⋯` menu is open, and the menu itself. */
  rowMenuId: S.optional(S.String),
  rowMenu: Dialog.Model,
  /** The Bulk Bar's `Add tag` picker: the Dialog, and the Tags ticked in it. */
  addTagDialog: Dialog.Model,
  addTagIds: S.Array(S.String),
})
export type Model = typeof Model.Type

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export const Message = defineMessageUnion({
  // data
  SucceededFetchPhotos: libraryPageFields,
  SucceededFetchTags: { tags: S.Array(Tag) },
  SucceededFetchPhoto: { id: PhotoId, photo: PhotoWithTags },
  FailedFetchPhoto: { id: PhotoId, message: S.String },
  FailedRpc: { message: S.String },
  LoadMore: {},
  SucceededFetchMore: {
    photos: S.Array(PhotoWithTags),
    nextCursor: S.NullOr(S.String),
  },

  // the shell
  SucceededGetSession: { email: S.NullOr(S.String), teamDomain: S.NullOr(S.String) },
  /** The gate refused, or could not be reached. Either way the session is not
   *  proven, and the app's only answer is the sign-in affordance. */
  FailedGetSession: {},
  SucceededGetCounts: countsFields,
  FailedGetCounts: {},
  SucceededGetStorage: storageFields,
  FailedGetStorage: {},

  // filter bar
  /** Add or remove one Tag from the multi-select filter. */
  ToggledTagFilter: { id: S.String },
  RetryFetch: {},

  // the Page Head's search
  SetSearchQuery: { value: S.String },
  SubmittedSearch: {},

  // the sidebar's per-tag actions
  OpenedTagActions: { id: S.String },
  SetTagActionLabel: { value: S.String },
  SubmitTagCreate: {},
  GotTagActionsMessage: { message: Dialog.Message },

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

  // create tag inline (from either combo, the tag manager bar, or the
  // sidebar's per-row actions)
  CreateTagRequested: {
    source: S.Literals(['draft', 'upload', 'manager', 'sidebar']),
    label: S.String,
  },

  // remove a picked tag from the edit-sheet / upload-dialog chip row
  RemoveDraftTag: { id: S.String },
  RemoveUploadTag: { id: S.String },

  SucceededCreateTag: {
    source: S.Literals(['draft', 'upload', 'manager', 'sidebar']),
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

  // Desk atom submodels
  GotSegmentMessage: { groupId: S.String, message: Segment.Message },

  // the atoms sheet
  SteppedAtomPage: { page: S.Number },
  ToggledAtomSelection: {},
  ToggledAtomRow: { index: S.Number },
  ToggledAtomSwitch: { id: S.String, isChecked: S.Boolean },
  SetAtomInput: { id: S.String, value: S.String },
  PickedAtomMat: { colour: MatColour },

  // toasts
  GotToastMessage: { message: AdminToast.Message },

  // the Settings page
  SucceededGetSettings: { settings: Settings },
  /** The singleton could not be read. The page says so rather than drawing
   *  controls over the column defaults and inviting a save that would overwrite
   *  a row nobody managed to read. */
  FailedGetSettings: {},
  RetryFetchSettings: {},
  /** A number the operator typed or stepped. */
  SetSettingsNumber: {
    field: S.Literals(['defaultPreviewLongEdge', 'defaultPreviewQuality', 'defaultFullQuality']),
    value: S.Number,
  },
  /** A free-text column. */
  SetSettingsText: { field: S.Literals(['copyright', 'motto', 'aboutCopy']), value: S.String },
  /** One of the two EXIF policies. The watermark's own switch is its own
   *  message, because it is a different kind of fact about a Rendition. */
  SetMetadataPolicy: {
    field: S.Literals(['defaultKeepExif', 'defaultRemoveGps']),
    isChecked: S.Boolean,
  },
  SetPreviewFormat: { value: RenditionFormat },
  SetWatermarkEnabled: { isChecked: S.Boolean },
  SetWatermarkColour: { colour: MatColour },
  SetWatermarkPosition: { value: WatermarkPosition },
  /** Retention is display-only — nothing purges on a timer — so this is one
   *  boolean and the page offers no other value. */
  SetRetention: { forever: S.Boolean },
  /** The nav repeater, as the one edit union `applySectionEdit` reduces. */
  EditedSection: { edit: SectionEdit },
  SaveSettings: {},
  SavedSettings: { settings: Settings },
  DiscardSettings: {},
  ExportCsvIndex: {},
  ExportedCsvIndex: { photos: S.Number },
  FailedExportCsvIndex: { message: S.String },

  // ----- the Library table -----------------------------------------------------
  /** Row click and the row's own box are the same gesture, so they are the same
   *  message. */
  ToggledRowSelection: { id: S.String },
  /** The head's tri-state box. Off, some, or all *on this page* — a header box
   *  on a paged table means the rows being held, and a selection that reached
   *  past the page would tick rows the operator cannot see. */
  ToggledPageSelection: {},
  ClearedSelection: {},
  SteppedLibraryPage: { delta: S.Literals([-1, 1]) },
  OpenedRowMenu: { id: S.String },
  GotRowMenuMessage: { message: Dialog.Message },
  /** The `⋯` menu's publish toggle. A soft delete is the other row action and
   *  goes through the shared confirm instead. */
  SetRowStatus: { id: S.String, status: S.Literals(['draft', 'published']) },
  SucceededSetRowStatus: {
    status: S.Literals(['draft', 'published']),
    ...libraryPageFields,
  },
  /** The `⋯` menu's destructive action. A soft delete like the Bulk Bar's, and
   *  through the same confirm Dialog. */
  RequestedRowTrash: { id: S.String, title: S.String },
  OpenedAddTag: {},
  GotAddTagDialogMessage: { message: Dialog.Message },
  ToggledAddTag: { id: S.String },
  ConfirmAddTag: {},
  SucceededAddTag: { count: S.Number, ...libraryPageFields },
  AddBorderToSelection: {},
  SucceededAddBorder: { count: S.Number, ...libraryPageFields },
  /** The Bulk Bar's `Delete`. A soft delete: it moves the selection to the
   *  Trash, and the Trash is where the irreversible act lives. */
  RequestBulkTrash: { count: S.Number },
  SucceededBulkTrash: { count: S.Number, ...libraryPageFields },
  /** The row's pencil. The Editor is the Photo route, so the row navigates
   *  rather than opening the legacy edit Sheet. */
  OpenedPhoto: { id: PhotoId },

  // routing — the runtime's own variants. `ClickedLink` is a clicked plain
  // anchor, `ChangedUrl` a popstate or a navigation the runtime performed.
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  CompletedNavigate: {},
  CompletedLoad: {},
  RetryFetchPhoto: {},

  // the Editor route
  SwitchedEditorTab: { tab: EditorTab },
  SucceededFetchPresentation: { id: PhotoId, presentation: PhotoPresentation },
  FailedFetchPresentation: { id: PhotoId, message: S.String },
  /** The Mat's own on/off. It is the Editor's one control today because the
   *  Mat is the one thing the Stage draws out of the stored Presentation;
   *  #32 adds its colour, style and width beside this toggle. */
  ToggledEditorMat: { enabled: S.Boolean },
  /** Send the draft as one Presentation — the crop, the level, the mat and the
   *  export overrides ride in a single call because the Presentation is one
   *  fact (CONTEXT.md). */
  SubmitEditorUpdate: {},
  /** The stored truth the save answered with, which becomes the new snapshot
   *  and the new draft in one step, so the indicator clears off the server's
   *  answer rather than off the request. */
  UpdatedEditor: { id: PhotoId, presentation: PhotoPresentation },
  /** Put the snapshot back. No RPC: the loaded value is the truth the Editor
   *  started from, so reverting is a copy, not a write. */
  DiscardEditor: {},
  /** `← Library`, `Escape`, a clicked link and a popstate all leave through
   *  this, which navigates at once when the Editor is clean and asks first
   *  when it is not. The URL is optional because `Escape` has none of its own:
   *  it goes to the route the Editor was opened from. */
  RequestLeaveEditor: { url: S.optional(S.String) },
  /** The operator answered the leave guard: go. */
  ConfirmedLeaveEditor: {},
  GotEditorLeaveMessage: { message: Dialog.Message },
})

export type Message = typeof Message.Type
/** Short alias used across the admin modules. */
export type Msg = Message

/** Uploaded bytes are not part of the serializable Model; they live here,
 *  keyed by queue-item id (`${name}:${size}`), until their upload completes. */
export const fileStore = new Map<string, File>()
