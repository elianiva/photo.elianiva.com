/**
 * Admin Model + Message (the TEA core). See CONTEXT.md — this surface is the
 * Admin: one operator browsing Photos, uploading originals, editing metadata,
 * and managing Tags.
 */

import { Schema as S } from 'effect'
import { File as FileSchema } from 'foldkit/file'
import { defineMessageUnion } from 'foldkit/message'
import { UrlRequest } from 'foldkit/navigation'
import { Url } from 'foldkit/url'
import {
  PhotoId,
  PhotoPresentation,
  PhotoRatio,
  PhotoWithTags,
  RenditionFormat,
  Settings,
  Tag,
  WatermarkPosition,
} from '@photo/shared'

import { Multi } from '@foldkit/ui/combobox'
import { Frame } from '@/lib/pipeline/schema'
import * as Dialog from '@/components/ui/dialog'
import * as FileDrop from '@/components/ui/file-drop'
import * as Segment from '@/components/ui/segment'
import * as Swatch from '@/components/ui/swatch'
import * as Toast from '@/components/ui/toast'

import {
  AppRoute,
  LibraryRatioFilter,
  LibrarySortFilter,
  LibraryStatusFilter,
  LibraryView,
  libraryViewOf,
} from './route'
import type { LibraryFilters } from './route'
import { SettingsDraft } from './settings-draft'

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

export const QueueStatus = S.Literals(['pending', 'uploading', 'processing', 'done', 'failed'])
export type QueueStatus = typeof QueueStatus.Type

export const QueueItem = S.Struct({
  /** Stable key: `${name}:${size}`. */
  id: S.String,
  name: S.String,
  size: S.Number,
  status: QueueStatus,
  /** Bytes confirmed uploaded so far — the bar and the `13.2 of 21.3 MB`
   *  readout. Zero before the run and for a file the client itself refused. */
  loaded: S.Number,
  /** The frame measured from the file's own pixels, so the detail line can
   *  name it while the bar fills. Absent until the run decodes the bytes. */
  width: S.optional(S.Number),
  height: S.optional(S.Number),
  /** The snapped Ratio, or the measured proportion when none snapped — the
   *  `3:2` in the uploading line and the `1:1` in a ratio rejection. */
  ratio: S.optional(S.String),
  /** The rendition summary `E6` fills in for the `processing` state
   *  (`AVIF · 2400, 1600, 800 px`). */
  renditionLabel: S.optional(S.String),
  error: S.optional(S.String),
})
export type QueueItem = typeof QueueItem.Type

/** One photo, or the whole ticked selection, awaiting destructive
 *  confirmation. `bulk` carries a count because there is no single label to
 *  name forty photographs by, and it is a soft delete like the single one. */
export const PendingConfirm = S.Union([
  S.Struct({ kind: S.Literal('photo'), id: S.String, label: S.String }),
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
  maxFileSize: 80 * 1024 * 1024,
} as const

/** What the file pickers offer. Uploads are JPEG only (chain decision 6). The
 *  server enforces it with `isJpegUpload` / `hasJpegMagic` in `@photo/shared`;
 *  this is the picker hint, kept in one place so the empty state's pickers, the
 *  Library's drop zone and the upload dialog cannot drift. */
export const UPLOAD_ACCEPT = ['image/jpeg'] as const

/** The one constraints line every drop zone prints — the dialog's strip, the
 *  Library's strip and the atoms sheet's specimen. One format, one cap, read
 *  off the same two facts, so a change to either cannot leave a stale copy
 *  behind on one of the three. */
export const UPLOAD_CONSTRAINTS = `JPEG · UP TO ${String(UPLOAD_LIMITS.maxFileSize / (1024 * 1024))} MB`

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
 *  gates the route before the app runs (ADR 0003), so `status` distinguishes
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
}
export const Counts = S.Struct(countsFields)
export type Counts = typeof Counts.Type

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

/** The `DETAILS` tab's editable values: the Photo's own stored fields, as the
 *  record the tab edits. They are not a Presentation — a title is not a crop —
 *  and they go through `UpdatePhoto`, which is why they are their own pair of
 *  snapshot/draft rather than more fields on the Presentation. The Ratio
 *  override is `EditorState.ratio`, beside the draft rather than in here.
 *
 *  `location` is `metadata.location`, lifted to a string because the blob's key
 *  is optional and a cleared field is an empty string here, never `undefined`. */
export const PhotoDetails = S.Struct({
  title: S.String,
  slug: S.String,
  location: S.String,
  takenAt: S.String,
})
export type PhotoDetails = typeof PhotoDetails.Type

/** A pan in flight. The pointer's origin and the frame's own box, in client
 *  coordinates, plus the crop the drag started from — a drag is measured
 *  against its origin rather than accumulated, so a pointer that wanders back
 *  returns the pan to where it began instead of drifting. */
export const EditorCropDrag = S.Struct({
  x: S.Number,
  y: S.Number,
  width: S.Number,
  height: S.Number,
  startX: S.Number,
  startY: S.Number,
})
export type EditorCropDrag = typeof EditorCropDrag.Type

/** The Download panel's choices. `original` is the stored JPEG, untouched; the
 *  other three are produced in the browser from it (nothing is sent to the
 *  server). View state: none of it is saved with the Photo. */
export const DownloadFormat = S.Literals(['original', 'jpeg', 'webp', 'png'])
export type DownloadFormat = typeof DownloadFormat.Type

export const DownloadFrame = Frame
export type DownloadFrame = typeof DownloadFrame.Type

export const DownloadState = S.Struct({
  format: DownloadFormat,
  /** Output width in pixels, border included; `0` is the original's own. */
  width: S.Number,
  quality: S.Number,
  frame: DownloadFrame,
  /** Border as a percentage of the frame. */
  borderPercent: S.Number,
  working: S.Boolean,
})
export type DownloadState = typeof DownloadState.Type

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
  /** The Ratio the operator picked, and only while it differs from the Photo's
   *  stored one. Ratio is a Photo column rather than a Presentation field, so
   *  it is an override beside the draft instead of a field inside it: `Discard`
   *  is clearing the field, and a pick that lands back on the stored Ratio is
   *  no change at all. */
  ratio: S.optional(PhotoRatio),
  /** The `DETAILS` record as it was loaded, the pair `Discard` reverts to and
   *  the save is measured against. Absent until the Photo read answers. */
  detailsSnapshot: S.optional(PhotoDetails),
  /** The `DETAILS` record as edited. The panel draws these; the save sends
   *  them when they differ from the snapshot. */
  detailsDraft: S.optional(PhotoDetails),
  /** The Blurhash of the composition the draft draws, re-encoded client-side
   *  on every committed crop/border change. Seeded from the Photo's stored hash
   *  on load and sent with the save when it moved (CONTEXT.md, Blurhash).
   *  `undefined` before the first encode answers. */
  blurhash: S.optional(S.String),
  /** The pan in flight, or absent. View state, never saved. */
  cropDrag: S.optional(EditorCropDrag),
  download: DownloadState,
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
  /** The Page Head search's text. A keystroke moves it; `SubmittedSearch`
   *  commits it into the URL's `q`, which is what the fetch reads. */
  searchQuery: S.String,
  /** The committed search, read from the URL's `q`. A half-typed query is not
   *  a filter, so a status click sends this rather than what is in the box. */
  appliedQuery: S.String,
  /** The Library filter's single-selects, read off the URL. Status is one of
   *  the design's five segments; ratio is `any` or one of the six; sort is the
   *  two orderings. The view is route state (`libraryViewOf`). */
  statusFilter: LibraryStatusFilter,
  ratioFilter: LibraryRatioFilter,
  sortFilter: LibrarySortFilter,

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

  // upload dialog
  uploadDialog: Dialog.Model,
  fileDrop: FileDrop.Model,
  queue: S.Array(QueueItem),
  /** Files targeted by the current run — snapshot, see `batchTotalField`. */
  batchTotal: S.Number,
  uploadTagIds: S.Array(S.String),
  uploadCombo: Multi.Model,
  uploadTakenAt: S.String,
  /** `Use export defaults`: seed a new Photo's export columns from the
   *  Settings singleton rather than the schema defaults. */
  uploadUseExportDefaults: S.Boolean,
  /** `Publish when ready`: create the Photo `published` rather than `draft`.
   *  Off is the dialog's default, so an upload lands in Drafts. */
  uploadPublishWhenReady: S.Boolean,
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

  // the shell
  SucceededGetSession: { email: S.NullOr(S.String), teamDomain: S.NullOr(S.String) },
  /** The gate refused, or could not be reached. Either way the session is not
   *  proven, and the app's only answer is the sign-in affordance. */
  FailedGetSession: {},
  SucceededGetCounts: countsFields,
  FailedGetCounts: {},

  // filter bar
  /** One of the status filter's five segments. `scheduled` is not a stored
   *  Status; the filter selects nothing for it (see `route.ts`). */
  SelectedStatusFilter: { value: LibraryStatusFilter },
  /** One of the six Ratios, or `any` to clear it. */
  SelectedRatioFilter: { value: LibraryRatioFilter },
  /** `newest` or `oldest` — the SORT select and the Table Head's arrow are the
   *  same fact in two places. */
  SelectedSortFilter: { value: LibrarySortFilter },
  /** Flip the sort between newest and oldest, from the Table Head's `TAKEN`. */
  ToggledSort: {},
  /** Clear every filter at once — Status, Ratio and the committed search. The
   *  filtered-empty state offers this, because a filter that matched nothing has
   *  as many ways back as it has fields. */
  ClearedLibraryFilters: {},
  RetryFetch: {},
  /** A cold load (or a Back press) whose page number has no cursor in the
   *  Model: the command walks the keyset from the first page to the one the
   *  URL names, and answers with the chain so Previous keeps working. */
  SucceededFetchLibraryPage: {
    page: S.Number,
    cursors: S.Array(S.String),
    ...libraryPageFields,
  },

  // the Page Head's search
  SetSearchQuery: { value: S.String },
  SubmittedSearch: {},

  // grid density and view
  SelectedCols: { cols: GridCols },
  /** The Library's view mode. The URL is the state, so this only prints it:
   *  the arm writes the route and replaces the URL, and `ChangedUrl` reads it
   *  back through the same table. */
  SelectedView: { view: LibraryView },
  CompletedPersistCols: {},

  // create a Tag inline, from the upload Dialog's combo
  CreateTagRequested: {
    label: S.String,
  },

  // remove a picked tag from the upload dialog's chip row
  RemoveUploadTag: { id: S.String },

  SucceededCreateTag: {
    tag: Tag,
  },

  // upload dialog
  OpenUpload: {},
  GotUploadDialogMessage: { message: Dialog.Message },
  GotFileDropMessage: { message: FileDrop.Message },
  /** A `change` event from the empty state's pickers. An Array and not a
   *  NonEmptyArray: cancelling the picker fires `change` with zero files. */
  ImportedFiles: { files: S.Array(FileSchema) },
  RemoveQueueItem: { id: S.String },
  RetryUpload: { id: S.String },
  RetryAllFailed: {},
  SetUploadTakenAt: { value: S.String },
  /** `Use export defaults`. The Settings singleton behind it is fetched when
   *  the dialog opens, so the toggle is a real read of a real row. */
  SetUploadUseExportDefaults: { isChecked: S.Boolean },
  SetUploadPublishWhenReady: { isChecked: S.Boolean },
  StartUploads: {},
  /** Stops the run: tears down the in-flight request (the subscription's scope
   *  close aborts it), halts the chain, leaves not-yet-uploaded items queued
   *  as `pending`. */
  CancelUploads: {},
  /** The frame decoded from the file's own pixels, before the bytes go up. */
  UploadItemFacts: { itemId: S.String, width: S.Number, height: S.Number, ratio: S.String },
  /** One `XMLHttpRequest.upload.onprogress` tick. */
  UploadProgress: { itemId: S.String, loaded: S.Number },
  /** `renditionsPending` is `E6`'s signal: true holds the row at `processing`
   *  (`AVIF · 2400, 1600, 800 px`) until the renditions land. */
  SucceededUploadItem: { itemId: S.String, renditionsPending: S.Boolean },
  FailedUploadItem: { itemId: S.String, message: S.String },
  GotUploadComboMessage: { message: S.Unknown },

  // destructive confirmation
  RequestDeletePhoto: { id: S.String, label: S.String },
  ConfirmPending: {},
  DeletedPhoto: { id: S.String, ...libraryPageFields },
  GotConfirmMessage: { message: Dialog.Message },

  // Desk atom submodels
  GotSegmentMessage: { groupId: S.String, message: Segment.Message },
  /** A pick from the Crop section's Ratio `Segment`. Its own variant rather than
   *  a `GotSegmentMessage`, because the Ratio is authored data instead of a
   *  Stage Bar view mode: it is not stored in `segmentGroups` at all, and its
   *  selection is read back off the draft on every render. */
  GotCropRatioMessage: { message: Segment.Message },

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
  /** The Export panel's six overrides. One variant each so a value's type is
   *  the schema's and the row that writes it is unambiguous; every one lands
   *  on `EditorState.draft` and rides the Top Bar's `Update`. */
  /** The Download panel. Browser-side only: `StartedDownload` runs the pipeline
   *  over the stored original and saves the result; nothing is uploaded. */
  SetDownloadFormat: { value: DownloadFormat },
  SetDownloadWidth: { value: S.Number },
  SetDownloadQuality: { value: S.Number },
  SetDownloadFrame: { value: DownloadFrame },
  SetDownloadBorder: { value: S.Number },
  StartedDownload: {},
  SucceededDownload: {},
  FailedDownload: { message: S.String },
  /** The client re-encoded the composition's Blurhash. `signature` names the
   *  composition it was encoded from, so a result for a draft the operator has
   *  already moved off is dropped rather than shown or saved. */
  ReencodedEditorBlurhash: { id: PhotoId, signature: S.String, blurhash: S.String },
  /** The `DETAILS` tab's controls, one message each so a value's type is the
   *  schema's and the row that writes it is unambiguous. Every one goes through
   *  `UpdatePhoto`; the Status group is the one control that does not
   *  (`SucceededSetEditorStatus`). */
  SetEditorTitle: { value: S.String },
  SetEditorPlace: { value: S.String },
  SetEditorTakenAt: { value: S.String },
  SetEditorSlug: { value: S.String },
  /** The `DETAILS` tab's Ratio Select. It writes the same `EditorState.ratio`
   *  override the Crop section's Segment does. */
  SetEditorRatio: { ratio: PhotoRatio },
  /** The Status group's write, through `SetPhotoStatus` rather than
   *  `UpdatePhoto` because the Status is a lifecycle move, not a field. It is
   *  immediate: `HISTORY` records nothing, so a status change here is not
   *  reversible from the Editor. */
  SucceededSetEditorStatus: { id: PhotoId, photo: PhotoWithTags },
  FailedSetEditorStatus: {},
  /** One straighten step. `-1` turns the frame counter-clockwise, `1` with it. */
  SteppedEditorLevel: { direction: S.Literals([-1, 1]) },
  /** The mirror beside the two straighten buttons. */
  ToggledEditorFlip: {},
  /** A pan started on the photograph: the pointer's client position and the
   *  frame box it started in. */
  StartedEditorCropDrag: { x: S.Number, y: S.Number, width: S.Number, height: S.Number },
  DraggedEditorCrop: { x: S.Number, y: S.Number },
  EndedEditorCropDrag: {},
  /** A wheel notch over the photograph. The sign of `deltaY` is the direction;
   *  the magnitude is the browser's, so one notch is one step. */
  ZoomedEditorCrop: { deltaY: S.Number },
  /** Send the draft: the Presentation and, when either moved, the Photo's own
   *  columns — the Ratio override and the `DETAILS` record — in one act even
   *  when it is two calls. */
  SubmitEditorUpdate: {},
  /** The stored truth the save answered with, which becomes the new snapshot
   *  and the new draft in one step, so the indicator clears off the server's
   *  answer rather than off the request. `photo` is present only when the save
   *  wrote one of the Photo's own columns. */
  UpdatedEditor: {
    id: PhotoId,
    presentation: PhotoPresentation,
    photo: S.optional(PhotoWithTags),
  },
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

/** The Library filter as the Model holds it, in the shape the URL and the
 *  commands speak. The route carries the same value in its query; this is the
 *  Model's half, and `sameLibraryFilters` is what keeps the two in step. */
export const libraryFiltersOfModel = (model: Model): LibraryFilters => ({
  status: model.statusFilter,
  ratio: model.ratioFilter,
  sort: model.sortFilter,
  q: model.appliedQuery,
  page: model.libraryPage,
  view: libraryViewOf(model.route),
})
