/**
 * Admin update core: message → (model, commands) transition plus init.
 * Uploaded bytes live in `fileStore` keyed by queue-item id so the Model
 * stays serializable. RPC commands live in `commands.ts`; child submodel
 * folds in `children.ts`; shared helpers in `helpers.ts`; the URL's route
 * table in `route.ts`.
 */

import { Option } from 'effect'
import { Multi } from '@foldkit/ui/combobox'
import { modifyFields } from 'foldkit/struct'
import { storedCols } from './prefs'
import { storedAdminTheme } from '@/lib/theme'
import { Runtime } from 'foldkit'
import { Transition } from 'foldkit/route'
import { UrlRequest } from 'foldkit/navigation'
import { toString as urlToString } from 'foldkit/url'
import type { Url } from 'foldkit/url'

import * as Dialog from '@/components/ui/dialog'
import * as FileDrop from '@/components/ui/file-drop'
import * as Segment from '@/components/ui/segment'

import {
  AddBorderCmd,
  BackCmd,
  BulkAddTagsCmd,
  BulkSetStatusCmd,
  BulkTrashCmd,
  CreateTagCmd,
  DeletePhotoCmd,
  ExportCsvIndexCmd,
  FetchCountsCmd,
  FetchLibraryPageCmd,
  FetchPhotoCmd,
  FetchPhotosCmd,
  FetchPresentationCmd,
  FetchSessionCmd,
  FetchSettingsCmd,
  FetchTagsCmd,
  LoadCmd,
  NavigateCmd,
  PersistColsCmd,
  PersistThemeCmd,
  ReplaceUrlCmd,
  SaveSettingsCmd,
  DownloadPhotoCmd,
  SetEditorStatusCmd,
  SetRowStatusCmd,
  UpdateEditorCmd,
  listArgsOf,
} from './commands'
import {
  foldAddTag,
  foldConfirm,
  foldEditorLeave,
  foldFileDrop,
  foldRowMenu,
  foldSegmentGroup,
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
  selectedIds,
  showToast,
  toggleIn,
  withOptional,
  type Commands,
  type UpdateReturn,
} from './helpers'
import {
  AdminToast,
  BULK_BORDER_MAT,
  EMPTY_BULK_DETAILS,
  libraryFiltersOfModel,
  Message,
} from './model'
import type { DownloadState, LibraryPage, Message as Msg, Model } from './model'
import { originalUrl } from '@/lib/image'
import {
  appRouteToUrl,
  defaultLibraryFilters,
  isAdminPath,
  libraryFiltersOf,
  libraryRoute,
  libraryUrl,
  libraryViewOf,
  sameLibraryFilterSet,
  sameLibraryFilters,
  urlToAppRoute,
} from './route'
import type { AppRoute, LibraryFilters } from './route'
import {
  EDITOR_STATUS_SEGMENT,
  blurhashSignature,
  bulkDetailsPatch,
  detailsOfPhoto,
  editorReturnUrl,
  initEditorSegments,
  initEditorState,
  isDetailsDirty,
  isEditorDirty,
  isPhotoRatio,
  isPhotoStatus,
  isPresentationDirty,
  metadataWithDetails,
  withCropDragEnd,
  withCropDragStart,
  withEditorDetails,
  withEditorFlip,
  withEditorLevel,
  withEditorMat,
  withEditorPan,
  withEditorRatio,
  withEditorStatusSelected,
  withEditorZoom,
} from './editor'
import {
  emptySettingsDraft,
  settingsInputOf,
  settingsUnsaved,
  toSettingsDraft,
  type SettingsDraft,
} from './settings-draft'
import { initAtomsState, initSheetSegments, specimenRowIndexes } from './atoms-sheet'

// ---------------------------------------------------------------------------
// routing
// ---------------------------------------------------------------------------

/** The runtime's routing config. Declared beside the Messages it produces so
 *  the two cannot drift. */
export const onUrlRequest = (request: UrlRequest): Message => Message.ClickedLink({ request })
export const onUrlChange = (url: Url): Message => Message.ChangedUrl({ url })

export type AdminTransition = Transition.Transition<AppRoute>

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

const initialModel = (route: AppRoute): Model => {
  const filters = libraryFiltersOf(route)
  return {
    route,
    status: 'loading',
    photos: [],
    tags: [],
    nextCursor: null,
    loadingMore: false,
    session: { status: 'loading', email: null, teamDomain: null },
    counts: { total: 0, trashed: 0, byStatus: { draft: 0, published: 0, failed: 0 } },
    searchQuery: filters.q,
    // The committed search, which is the URL's `q` as of the last load.
    appliedQuery: filters.q,
    statusFilter: filters.status,
    ratioFilter: filters.ratio,
    sortFilter: filters.sort,
    cols: storedCols(),
    theme: storedAdminTheme(),
    navOpen: false,
    segmentGroups: { ...initSheetSegments(), ...initEditorSegments() },
    atoms: initAtomsState(),
    photoStatus: 'loading',
    editor: initEditorState(),

    uploadDialog: Dialog.init({ id: 'admin-upload-dialog' }),
    fileDrop: FileDrop.init({ id: 'admin-file-drop' }),
    queue: [],
    batchTotal: 0,
    uploadTagIds: [],
    uploadCombo: Multi.init({ id: 'admin-upload-combo' }),
    uploadTakenAt: '',
    uploadUseExportDefaults: true,
    uploadPublishWhenReady: false,
    uploading: false,
    confirmDialog: Dialog.init({ id: 'admin-confirm-dialog' }),
    toast: AdminToast.init({ id: 'admin-toasts' }),
    settings: undefined,
    settingsStatus: 'loading',
    settingsDraft: emptySettingsDraft,
    settingsSaving: false,
    settingsIndexing: false,

    selected: [],
    libraryPage: filters.page,
    libraryCursors: [''],
    libraryTotal: 0,
    rowMenu: Dialog.init({ id: 'admin-row-menu' }),
    addTagDialog: Dialog.init({ id: 'admin-add-tag-dialog' }),
    addTagIds: [],
    removeTagIds: [],
    bulkDetails: EMPTY_BULK_DETAILS,
  }
}

/** Every route-driven command, in one place, so the two paths that resolve a
 *  URL into a route cannot disagree: `init` calls this with the cold-load
 *  transition and `ChangedUrl` with the navigation one. A fetch returned from
 *  `ChangedUrl` alone never fires on a direct visit or a reload. */
const applyRoute = (model: Model, transition: AdminTransition): UpdateReturn => {
  // Every navigation re-reads the session and the sidebar's counts, cold load
  // included. Neither is cached across a route change: a session can expire
  // between two pages, and a count is a fact about the moment it was read, not
  // about the moment the Admin booted. The Tag list rides here rather than on
  // entering the Library because the shell needs it on every route — the
  // Library's Bulk Bar and the Editor read it, and a route that listed none
  // would offer `Add tag` an empty set of choices.
  const shellCommands: Commands = [FetchSessionCmd(), FetchCountsCmd(), FetchTagsCmd()]
  const nextRoute = transition.nextRoute
  // The Settings page is a form over a row, and a form over a row is only
  // truthful if the row behind it is current. Fetched on entering, never
  // cached across a navigation, exactly like the Library's first page.
  const settingsCommands: Commands = Transition.isEntering(transition, 'Settings')
    ? [FetchSettingsCmd()]
    : []
  // Entering the Photo route, and staying within it for a different id, both
  // mean one Photo to read.
  const photoId = Option.match(Transition.entered(transition, 'Photo'), {
    onNone: () => Option.none(),
    onSome: ({ id }) => Option.some(id),
  }).pipe(
    Option.orElse(() =>
      Option.match(Transition.stayed(transition, 'Photo'), {
        onNone: () => Option.none(),
        onSome: ({ previousRoute, nextRoute }) =>
          previousRoute.id === nextRoute.id ? Option.none() : Option.some(nextRoute.id),
      }),
    ),
  )
  const photoCommands: Commands = Option.match(photoId, {
    onNone: () => [],
    // The Editor needs the Photo and its stored Presentation: one is the
    // record the Top Bar prints, the other is the snapshot `Discard` reverts
    // to and the only thing the Stage draws out of.
    onSome: (id) => [FetchPhotoCmd({ id }), FetchPresentationCmd({ id })],
  })
  // A Photo loading is route state, not message state: the route change is
  // what puts it there, whichever of the two paths got us here. The Editor's
  // own state is reset with it, so arriving at another Photo cannot inherit the
  // previous one's draft or a half-answered read.
  const withPhoto = Option.isSome(photoId)
    ? withOptional(model, {
        photo: undefined,
        photoStatus: 'loading',
        editor: {
          ...model.editor,
          snapshot: undefined,
          draft: undefined,
          ratio: undefined,
          detailsSnapshot: undefined,
          detailsDraft: undefined,
          blurhash: undefined,
          cropDrag: undefined,
          saving: false,
          leaveUrl: '',
        },
      })
    : model
  // The Library is loaded from the route's own filter, on every genuine route
  // change: a cold load, a click and a Back/Forward press all arrive here. A
  // filter change that only moved the URL is caught in `ChangedUrl` and never
  // reaches this, so this is the one place a page read is issued from a route.
  //
  // The table's paging and selection are claims about the rows being looked at.
  // A filter change replaces those rows, so the selection goes with them and
  // the page number starts over; a page move keeps both, which is why the
  // cursors only reset when the filter set itself changed.
  let next = withPhoto
  const libraryCommands: Array<Commands[number]> = []
  if (nextRoute._tag === 'Library') {
    const filters = libraryFiltersOf(nextRoute)
    const previous = Option.getOrUndefined(Transition.stayed(transition, 'Library'))?.previousRoute
    const previousFilters = previous === undefined ? undefined : libraryFiltersOf(previous)
    const filterSetChanged =
      previousFilters === undefined || !sameLibraryFilterSet(filters, previousFilters)
    // A Back press to the page the Model already holds needs no re-read; a page
    // the Model has never seen does.
    const pageChanged = previousFilters !== undefined && previousFilters.page !== filters.page
    next = withLibraryFilters(withPhoto, filters, filterSetChanged)
    if (filterSetChanged) {
      next = modifyFields(next, { selected: () => [], libraryCursors: () => [''] })
    }
    if (filterSetChanged || pageChanged) {
      if (filters.status === 'scheduled') {
        // The segment selects drafts flagged for a publication nothing records:
        // there is no query to send, and the honest answer is no rows.
        next = modifyFields(next, {
          photos: () => [],
          nextCursor: () => null,
          libraryTotal: () => 0,
          loadingMore: () => false,
          status: () => 'ready',
          error: () => undefined,
        })
      } else {
        libraryCommands.push(...libraryLoadCommand(next, filters))
      }
    }
  }
  const commands = [...shellCommands, ...libraryCommands, ...settingsCommands, ...photoCommands]
  return commands.length > 0 ? { model: next, commands } : { model: next }
}

/** The filter as the Model holds it, for a route that carries it. `resetCursors`
 *  is true when the filter set changed: the old cursors are positions under a
 *  query that no longer applies. */
const withLibraryFilters = (model: Model, filters: LibraryFilters, resetCursors: boolean): Model =>
  modifyFields(model, {
    statusFilter: () => filters.status,
    ratioFilter: () => filters.ratio,
    sortFilter: () => filters.sort,
    appliedQuery: () => filters.q,
    searchQuery: () => filters.q,
    libraryPage: () => filters.page,
    ...(resetCursors ? { libraryCursors: () => [''] } : {}),
  })

/** The read a Library route needs. The page the URL names is fetched with a
 *  cursor the Model already holds when it can be — an in-session page step and
 *  a Back press to a visited page both have one — and by walking the keyset
 *  when it cannot, which is a cold load that deep-linked into a page. */
const libraryLoadCommand = (model: Model, filters: LibraryFilters): Commands => {
  const args = listArgsOf(filters)
  const cursor = model.libraryCursors[filters.page]
  if (cursor === undefined) return [FetchLibraryPageCmd({ ...args, page: filters.page })]
  // The first page has no cursor to name, and naming an empty one would put a
  // key in the request that means nothing.
  return cursor === '' ? [FetchPhotosCmd(args)] : [FetchPhotosCmd({ ...args, cursor })]
}

export const init: Runtime.RoutingApplicationInit<Model, Message> = (url: Url) => {
  const route = urlToAppRoute(url)
  return applyRoute(initialModel(route), Transition.coldLoad(route))
}

// ---------------------------------------------------------------------------
const withDownload = (model: Model, patch: Partial<DownloadState>): Model =>
  modifyFields(model, {
    editor: () => ({ ...model.editor, download: { ...model.editor.download, ...patch } }),
  })

// upload chaining
// ---------------------------------------------------------------------------

/** Flip one item back to `pending`, clearing any error and progress text. Used
 *  by retry and by the cancel path (a stopped run has no bytes in flight). */
const restorePending = (model: Model, itemId: string): Model =>
  modifyFields(model, {
    queue: () =>
      model.queue.map((item) =>
        item.id === itemId
          ? // `error` is optional; spread-clear it (modifyFields cannot add keys).
            { ...item, status: 'pending' as const, loaded: 0, error: undefined }
          : item,
      ),
  })

/** The one way a run advances: mark the item `uploading`. The upload itself is
 *  a subscription keyed on exactly that state, so this writes the state and
 *  nothing else — the runtime tears the previous stream down and opens the
 *  next. Every chain-start site goes through here so exactly one row is ever
 *  in-flight, and a retry starts its bar at zero. */
const startItem = (model: Model, itemId: string): UpdateReturn => ({
  model: modifyFields(model, {
    queue: () =>
      model.queue.map((item) =>
        item.id === itemId
          ? modifyFields(item, { status: () => 'uploading', loaded: () => 0 })
          : item,
      ),
  }),
})

/** Snapshot the finished batch's counts BEFORE any queue cleanup, so the
 *  toast stays truthful no matter what gets released afterwards. A clean
 *  batch clears itself; a partial one keeps its rows for retry. */
const runNextOrFinish = (model: Model): UpdateReturn => {
  const pending = model.queue.find((item) => item.status === 'pending')
  if (pending !== undefined) return startItem(model, pending.id)
  const uploadedCount = model.queue.filter(
    (item) => item.status === 'done' || item.status === 'processing',
  ).length
  const failedCount = model.queue.filter((item) => item.status === 'failed').length
  const settled = modifyFields(model, { uploading: () => false })
  // The dialog was closed mid-batch: the queue stayed alive so uploads could
  // chain; now that the last item settled, drop everything not stuck.
  const finished =
    failedCount === 0 || !settled.uploadDialog.isOpen ? releaseFinishedItems(settled) : settled
  // The list and the sidebar's counts both moved: an upload changes a Photo's
  // Status, so re-read both rather than let the count outlive the write.
  const refresh: Commands = [FetchPhotosCmd({ q: settled.searchQuery }), FetchCountsCmd()]
  return failedCount === 0
    ? showToast(finished, `Uploaded ${photoCountLabel(uploadedCount)}`, 'Success', undefined, [
        ...refresh,
      ])
    : showToast(
        finished,
        `${String(uploadedCount)} uploaded, ${String(failedCount)} failed`,
        'Error',
        'Retry failed items from the upload dialog.',
        [...refresh],
      )
}

const markItem = (
  model: Model,
  itemId: string,
  status: 'done' | 'processing' | 'failed',
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
// the Library table
// ---------------------------------------------------------------------------

/** Where the table is reading, as the args every refresh-after-a-write takes.
 *  Read from the Model at dispatch, so a command can never refetch page one by
 *  accident while the operator is looking at page three, nor drop a filter the
 *  operator put on. */
const currentPage = (model: Model) => ({
  ...listArgsOf(libraryFiltersOfModel(model)),
  cursor: model.libraryCursors[model.libraryPage] ?? '',
})

/** A selection is a claim about the rows being looked at. A filter change
 *  replaces those rows, so a selection of forty that silently followed a new
 *  query would be forty Photographs the operator never chose. */
const clearSelection = (model: Model): Model => modifyFields(model, { selected: () => [] })

/** The tail every write in the table shares: the refreshed page goes in, the
 *  sidebar's counts are re-read, and the operator is told what happened. The
 *  write may have changed the page's own membership — a Status filter or a Tag
 *  filter both move rows — so the rows are read back rather than patched. */
const settled = (model: Model, page: LibraryPage, title: string, detail?: string): UpdateReturn => {
  const refreshed = modifyFields(model, {
    status: () => 'ready' as const,
    error: () => undefined,
    photos: () => [...page.photos],
    nextCursor: () => page.nextCursor,
    libraryTotal: () => page.total,
    loadingMore: () => false,
  })
  return showToast(refreshed, title, 'Success', detail, [FetchCountsCmd()])
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

/** Folds the mobile drawer shut over whatever update just produced. */
const closingNav = (update: () => UpdateReturn): UpdateReturn => {
  const result = update()
  return {
    ...result,
    model: modifyFields(result.model, { navOpen: () => false }),
  }
}

/** Opens the Upload dialog over whatever update just produced, so a caller
 *  that queued files can hand the result straight back without repeating the
 *  dialog fold. */
const withUploadDialogOpen = (result: UpdateReturn): UpdateReturn => {
  const dialogOpened = Dialog.open(result.model.uploadDialog)
  const model = modifyFields(result.model, { uploadDialog: () => dialogOpened.model })
  // `Use export defaults` reads the Settings singleton, so opening the dialog
  // makes sure the row is there to read. A row already read is not re-read on
  // every open — the read is a convenience for one toggle, not a page load.
  const settingsCommands: Commands = model.settings === undefined ? [FetchSettingsCmd()] : []
  const commands: Commands = [
    ...(result.commands ?? []),
    ...settingsCommands,
    ...liftChildCommands(dialogOpened.commands ?? [], (message) =>
      Message.GotUploadDialogMessage({ message }),
    ),
  ]
  return commands.length > 0 ? { model, commands } : { model }
}

function step(current: Model, message: Msg, prior: Commands = []): UpdateReturn {
  const result = transition(current, message)
  const commands = [...prior, ...(result.commands ?? [])]
  return commands.length > 0 ? { model: result.model, commands } : { model: result.model }
}

/** The one shape every Library filter change takes: the Model holds the new
 *  filter, the address bar is replaced (never pushed — a filter is not a
 *  destination the back button should walk through), and the rows are re-read
 *  unless the change is only a view. `refetchRows` is false for the list/grid
 *  toggle, whose rows are exactly the rows already on screen. */
const libraryFilterChange = (
  model: Model,
  filters: LibraryFilters,
  refetchRows: boolean,
): UpdateReturn => {
  const emptied =
    filters.status === 'scheduled'
      ? modifyFields(clearSelection(model), {
          photos: () => [],
          nextCursor: () => null,
          libraryTotal: () => 0,
          loadingMore: () => false,
          status: () => 'ready',
          error: () => undefined,
        })
      : clearSelection(model)
  const next = modifyFields(emptied, {
    statusFilter: () => filters.status,
    ratioFilter: () => filters.ratio,
    sortFilter: () => filters.sort,
    appliedQuery: () => filters.q,
    libraryPage: () => 0,
    libraryCursors: () => [''],
  })
  const commands: Array<Commands[number]> = [ReplaceUrlCmd({ url: libraryUrl(filters) })]
  // On the Library the rows are re-read here; on any other route the URL move
  // is the whole of it, and the navigation's own load (via `ChangedUrl`) reads
  // them.
  const onLibrary = model.route._tag === 'Library'
  if (refetchRows && onLibrary && filters.status !== 'scheduled') {
    commands.unshift(FetchPhotosCmd(listArgsOf(filters)))
  }
  return { model: next, commands }
}

const transition = (model: Model, message: Msg): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    // ----- data ---------------------------------------------------------------
    SucceededFetchPhotos: ({ photos, nextCursor, total }) => ({
      model: modifyFields(model, {
        photos: () => [...photos],
        nextCursor: () => nextCursor ?? null,
        libraryTotal: () => total,
        loadingMore: () => false,
        status: () => 'ready',
        error: () => undefined,
      }),
    }),
    SucceededFetchLibraryPage: ({ page, cursors, photos, nextCursor, total }) => ({
      model: modifyFields(model, {
        libraryPage: () => page,
        libraryCursors: () => [...cursors],
        photos: () => [...photos],
        nextCursor: () => nextCursor ?? null,
        libraryTotal: () => total,
        loadingMore: () => false,
        status: () => 'ready',
        error: () => undefined,
      }),
    }),
    SucceededFetchTags: ({ tags }) => ({ model: modifyFields(model, { tags: () => tags ?? [] }) }),
    SucceededFetchPhoto: ({ id, photo }) => {
      // A response for a Photo the URL no longer names is stale: the route
      // moved on while the request was in flight.
      if (model.route._tag !== 'Photo' || model.route.id !== id) return { model }
      // The `DETAILS` pair comes from the Photo, not from the Presentation
      // read: a title is a field on the row, and the panel edits the row.
      const details = detailsOfPhoto(photo)
      return {
        model: withOptional(model, {
          photo,
          photoStatus: 'ready',
          // The Status group's selection is the Photo's own fact, so a cold
          // load cannot draw the group's default beside a published chip.
          segmentGroups: withEditorStatusSelected(model.segmentGroups, photo.status ?? 'draft'),
          editor: {
            ...model.editor,
            detailsSnapshot: details,
            detailsDraft: { ...details },
            // The stored hash is the composition the operator last saved; the
            // re-encoder replaces it the moment the draft moves off it.
            blurhash: photo.blurhash ?? undefined,
          },
        }),
      }
    },
    FailedFetchPhoto: ({ id }) => {
      if (model.route._tag !== 'Photo' || model.route.id !== id) return { model }
      return { model: withOptional(model, { photo: undefined, photoStatus: 'error' }) }
    },
    RetryFetchPhoto: () => {
      if (model.route._tag !== 'Photo') return { model }
      return {
        model: withOptional(model, { photo: undefined, photoStatus: 'loading' }),
        // Both reads, because either one failing leaves the Editor without
        // what it draws: the Photo is the record, the Presentation is the
        // snapshot, and the Stage has nothing to show without both.
        commands: [
          FetchPhotoCmd({ id: model.route.id }),
          FetchPresentationCmd({ id: model.route.id }),
        ],
      }
    },
    FailedRpc: ({ message: failure }) => {
      // `error` is optional and may be absent from normalized state; assign
      // via spread (see `withOptional`) instead of modifyFields. A failed save
      // releases `saving` too, or the Top Bar's `Update` stays disabled behind
      // the toast with nothing in flight.
      const unstuck = modifyFields(model, {
        loadingMore: () => false,
        editor: () => ({ ...model.editor, saving: false }),
      })
      const errored = withOptional(unstuck, { status: 'error', error: failure })
      return showToast(errored, 'Something went wrong', 'Error', failure)
    },

    // ----- the shell ------------------------------------------------------------
    // A rejected `GetSession` is not a toast: the Admin has no signed-out state
    // to fall back to, so an unproven session replaces the whole shell with the
    // sign-in affordance (see `views/session.ts`).
    SucceededGetSession: ({ email, teamDomain }) => ({
      model: modifyFields(model, { session: () => ({ status: 'verified', email, teamDomain }) }),
    }),
    FailedGetSession: () => ({
      model: modifyFields(model, {
        session: () => ({ status: 'expired', email: null, teamDomain: null }),
      }),
    }),
    SucceededGetCounts: (counts) => ({
      model: modifyFields(model, { counts: () => counts }),
    }),
    // A count that could not be read keeps the last one rather than dropping to
    // zero: a zero would read as "you have no photos", which is a claim this
    // failure cannot make.
    FailedGetCounts: () => ({ model }),
    // ----- filter bar -----------------------------------------------------------
    RetryFetch: () => {
      const filters = libraryFiltersOfModel(model)
      return filters.status === 'scheduled'
        ? { model }
        : { model, commands: libraryLoadCommand(model, filters) }
    },
    SelectedStatusFilter: ({ value }) =>
      libraryFilterChange(model, { ...libraryFiltersOfModel(model), status: value, page: 0 }, true),
    SelectedRatioFilter: ({ value }) =>
      libraryFilterChange(model, { ...libraryFiltersOfModel(model), ratio: value, page: 0 }, true),
    SelectedSortFilter: ({ value }) =>
      libraryFilterChange(model, { ...libraryFiltersOfModel(model), sort: value, page: 0 }, true),
    // The Table Head's `TAKEN` and the SORT select are one fact in two places.
    ToggledSort: () =>
      libraryFilterChange(
        model,
        {
          ...libraryFiltersOfModel(model),
          sort: model.sortFilter === 'newest' ? 'oldest' : 'newest',
          page: 0,
        },
        true,
      ),
    // Every filter back to its opening value in one move. The view is kept:
    // whether the Library is read as a table or as tiles is how the operator is
    // looking at it, not which rows it holds.
    ClearedLibraryFilters: () =>
      libraryFilterChange(
        model,
        { ...defaultLibraryFilters, view: libraryViewOf(model.route) },
        true,
      ),
    // A view is not a query: the rows are the rows already on screen, so this
    // replaces the URL and moves nothing else. The rest of the filter rides in
    // the new route, so switching to the grid on a filtered Library keeps it.
    SelectedView: ({ view }) => {
      const nextRoute = libraryRoute({ ...libraryFiltersOfModel(model), view })
      return {
        model: modifyFields(model, { route: () => nextRoute }),
        commands: [ReplaceUrlCmd({ url: appRouteToUrl(nextRoute) })],
      }
    },

    // ----- the Page Head's search -----------------------------------------------
    SetSearchQuery: ({ value }) => ({ model: modifyFields(model, { searchQuery: () => value }) }),
    SubmittedSearch: () =>
      libraryFilterChange(
        model,
        { ...libraryFiltersOfModel(model), q: model.searchQuery.trim(), page: 0 },
        true,
      ),

    // ----- grid density -----------------------------------------------------------
    SelectedCols: ({ cols }) => ({
      model: modifyFields(model, { cols: () => cols }),
      commands: [PersistColsCmd({ cols })],
    }),
    CompletedPersistCols: () => ({ model }),

    // ----- the Desk's theme ------------------------------------------------------
    ToggledTheme: () => {
      const theme = model.theme === 'dark' ? 'light' : 'dark'
      return {
        model: modifyFields(model, { theme: () => theme }),
        commands: [PersistThemeCmd({ theme })],
      }
    },
    CompletedPersistTheme: () => ({ model }),

    // ----- the mobile drawer ---------------------------------------------------
    ToggledNav: () => ({ model: modifyFields(model, { navOpen: () => !model.navOpen }) }),
    ClosedNav: () => ({ model: modifyFields(model, { navOpen: () => false }) }),

    // ----- the atoms sheet -------------------------------------------------------
    // Every handler here moves one of the sheet's own pieces of state. Nothing
    // reaches the network: the sheet is a specimen, and the atoms behind it are
    // the ones the product pages will drive.
    SteppedAtomPage: ({ page }) => ({
      // A selection made on one page must not silently apply to the next.
      model: modifyFields(model, {
        atoms: () => ({ ...model.atoms, page, selectedRowIndexes: [] }),
      }),
    }),
    ToggledAtomSelection: () => {
      const indexes = specimenRowIndexes(model.atoms.page)
      const allSelected =
        indexes.length > 0 &&
        indexes.every((index) => model.atoms.selectedRowIndexes.includes(index))
      return {
        model: modifyFields(model, {
          atoms: () => ({
            ...model.atoms,
            selectedRowIndexes: allSelected ? [] : indexes,
          }),
        }),
      }
    },
    ToggledAtomRow: ({ index }) => {
      const selected = model.atoms.selectedRowIndexes
      return {
        model: modifyFields(model, {
          atoms: () => ({
            ...model.atoms,
            selectedRowIndexes: selected.includes(index)
              ? selected.filter((picked) => picked !== index)
              : [...selected, index],
          }),
        }),
      }
    },
    ToggledAtomSwitch: ({ id, isChecked }) => ({
      model: modifyFields(model, {
        atoms: () => ({
          ...model.atoms,
          switches: { ...model.atoms.switches, [id]: isChecked },
        }),
      }),
    }),
    SetAtomInput: ({ id, value }) => ({
      model: modifyFields(model, {
        atoms: () => ({ ...model.atoms, inputs: { ...model.atoms.inputs, [id]: value } }),
      }),
    }),
    PickedAtomMat: ({ colour }) => ({
      model: modifyFields(model, { atoms: () => ({ ...model.atoms, matColour: colour }) }),
    }),

    // ----- create tag inline ------------------------------------------------------
    CreateTagRequested: ({ label }) => ({
      model,
      commands: [CreateTagCmd({ label })],
    }),
    SucceededCreateTag: ({ tag }) => {
      const withTag = modifyFields(model, { tags: () => [...model.tags, tag].sort(byLabel) })
      // The Tag now rides every picker that offers one, so it is ticked in the
      // dialog that asked for it — the one convention, wherever the pick came
      // from.
      return {
        model: modifyFields(withTag, {
          uploadTagIds: () => toggleIn(withTag.uploadTagIds, tag.id),
        }),
        commands: [FetchCountsCmd()],
      }
    },
    RemoveUploadTag: ({ id }) => ({
      model: modifyFields(model, { uploadTagIds: () => toggleIn(model.uploadTagIds, id) }),
    }),

    // ----- upload dialog ------------------------------------------------------------
    OpenUpload: () => withUploadDialogOpen({ model }),
    // A cancelled picker fires `change` with no files; there is nothing to queue.
    ImportedFiles: ({ files }) => {
      const [first, ...rest] = files
      return first === undefined
        ? { model }
        : withUploadDialogOpen(
            foldFileDrop(model, FileDrop.Message.DroppedFiles({ files: [first, ...rest] })),
          )
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
    SetUploadUseExportDefaults: ({ isChecked }) => ({
      model: modifyFields(model, { uploadUseExportDefaults: () => isChecked }),
    }),
    SetUploadPublishWhenReady: ({ isChecked }) => ({
      model: modifyFields(model, { uploadPublishWhenReady: () => isChecked }),
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
      // The in-flight item goes back to `pending`: that is the Model change
      // that tears the upload subscription down, and the scope's release
      // aborts the request. Pending rows stay queued.
      const inFlight = model.queue.find((item) => item.status === 'uploading')
      const stopped = inFlight === undefined ? model : restorePending(model, inFlight.id)
      return { model: modifyFields(stopped, { uploading: () => false }) }
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
              ? // `error` is optional; spread-clear it (modifyFields cannot add keys) and reset the bar.
                { ...item, status: 'pending' as const, loaded: 0, error: undefined }
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
    // The frame the client measured, so the detail line can name it while the
    // bytes are still going up.
    UploadItemFacts: ({ itemId, width, height, ratio }) => ({
      model: modifyFields(model, {
        queue: () =>
          model.queue.map((item) =>
            item.id === itemId ? { ...item, width, height, ratio } : item,
          ),
      }),
    }),
    ReadUploadExif: ({ itemId, facts, problem }) => ({
      model: modifyFields(model, {
        queue: () =>
          model.queue.map((item) =>
            item.id === itemId ? { ...item, exifFacts: facts, exifProblem: problem } : item,
          ),
      }),
    }),
    UploadProgress: ({ itemId, loaded }) => ({
      model: modifyFields(model, {
        queue: () => model.queue.map((item) => (item.id === itemId ? { ...item, loaded } : item)),
      }),
    }),
    SucceededUploadItem: ({ itemId, renditionsPending }) => {
      // `processing` is settled as far as the chain is concerned: the bytes are
      // stored and `E6` produces renditions in the background, so the next item
      // may start. The row stays visible in its processing state.
      const marked = markItem(model, itemId, renditionsPending ? 'processing' : 'done')
      // A settle racing a just-issued Stop: record it, but don't revive the
      // stopped run by chaining on.
      if (!model.uploading) return { model: marked }
      return runNextOrFinish(marked)
    },
    FailedUploadItem: ({ itemId, message }) => {
      // Post-Stop arrival (the aborted request's error): not a failure — put
      // the item back in line and leave the run stopped.
      if (!model.uploading) return { model: restorePending(model, itemId) }
      return runNextOrFinish(markItem(model, itemId, 'failed', message))
    },

    // ----- destructive confirmation ---------------------------------------------------
    RequestDeletePhoto: ({ id, label }) => openConfirm(model, { kind: 'photo', id, label }),
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
          ? DeletePhotoCmd({ id: pending.id, page: currentPage(model) })
          : BulkTrashCmd({ ids: selectedIds(model), page: currentPage(model) })
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
    DeletedPhoto: ({ photos, nextCursor, total }) => {
      // A Photo left every list, so the Library total and its Status both just
      // moved.
      const refreshed = modifyFields(model, {
        photos: () => [...photos],
        nextCursor: () => nextCursor ?? null,
        libraryTotal: () => total,
        loadingMore: () => false,
      })
      return showToast(refreshed, 'Deleted', 'Success', undefined, [FetchCountsCmd()])
    },

    // ----- the Editor route ---------------------------------------------------------
    // Everything above reads the Photo; everything here is the Editor's own
    // state, and the leave guard is shared with the routing arms at the bottom
    // because a `← Library` click and a Back press are the same act.
    SwitchedEditorTab: ({ tab }) => ({
      model: modifyFields(model, { editor: () => ({ ...model.editor, tab }) }),
    }),
    SucceededFetchPresentation: ({ id, presentation }) => {
      // A response for a Photo the URL no longer names is stale, the same as
      // the Photo's own read.
      if (model.route._tag !== 'Photo' || model.route.id !== id) return { model }
      return {
        model: withOptional(model, {
          // The draft starts as a copy of the snapshot rather than the same
          // value: nothing writes a Presentation in place, but two independent
          // objects mean a future in-place edit cannot quietly move the thing
          // `Discard` reverts to.
          editor: { ...model.editor, snapshot: presentation, draft: { ...presentation } },
        }),
      }
    },
    FailedFetchPresentation: ({ id }) => {
      if (model.route._tag !== 'Photo' || model.route.id !== id) return { model }
      // One status for the whole Editor: a Photo with no Presentation has no
      // mat, no crop and no save, so there is nothing the page could show and
      // nothing it could be asked.
      return {
        model: withOptional(model, {
          editor: {
            ...model.editor,
            snapshot: undefined,
            draft: undefined,
            ratio: undefined,
            blurhash: undefined,
            cropDrag: undefined,
            saving: false,
          },
          photoStatus: 'error',
        }),
      }
    },
    ToggledEditorMat: ({ enabled }) => ({
      model: modifyFields(model, { editor: () => withEditorMat(model.editor, enabled) }),
    }),
    // The Download panel: browser-side export of the stored original.
    SetDownloadFormat: ({ value }) => ({ model: withDownload(model, { format: value }) }),
    SetDownloadWidth: ({ value }) => ({ model: withDownload(model, { width: value }) }),
    SetDownloadQuality: ({ value }) => ({ model: withDownload(model, { quality: value }) }),
    SetDownloadFrame: ({ value }) => ({ model: withDownload(model, { frame: value }) }),
    SetDownloadBorder: ({ value }) => ({ model: withDownload(model, { borderPercent: value }) }),
    StartedDownload: () => {
      const photo = model.photo
      if (photo === undefined || model.editor.download.working) return { model }
      const d = model.editor.download
      return {
        model: withDownload(model, { working: true }),
        commands: [
          DownloadPhotoCmd({
            url: originalUrl(photo),
            name: photo.slug,
            format: d.format,
            width: d.width,
            quality: d.quality,
            frame: d.frame,
            borderPercent: d.borderPercent,
          }),
        ],
      }
    },
    SucceededDownload: () => ({ model: withDownload(model, { working: false }) }),
    FailedDownload: ({ message }) =>
      showToast(withDownload(model, { working: false }), 'Download failed', 'Error', message),
    // The composition was re-encoded. A result whose signature no longer
    // matches the draft is one the operator has already moved off — dropping
    // it keeps the readout from flickering back to a stale crop.
    ReencodedEditorBlurhash: ({ id, signature, blurhash }) => {
      if (model.route._tag !== 'Photo' || model.route.id !== id) return { model }
      if (blurhashSignature(model.photo, model.editor) !== signature) return { model }
      return {
        model: modifyFields(model, { editor: () => ({ ...model.editor, blurhash }) }),
      }
    },
    // The `DETAILS` tab's controls, one message each so a value's type is the
    // schema's. The four Fields write their own field on the record draft and
    // none of them touches the network — `SubmitEditorUpdate` is the one save.
    // The Ratio Select writes the same override the Crop section's Segment
    // does, so the two controls cannot disagree.
    SetEditorTitle: ({ value }) => ({
      model: modifyFields(model, {
        editor: () => withEditorDetails(model.editor, { title: value }),
      }),
    }),
    SetEditorPlace: ({ value }) => ({
      model: modifyFields(model, {
        editor: () => withEditorDetails(model.editor, { location: value }),
      }),
    }),
    SetEditorTakenAt: ({ value }) => ({
      model: modifyFields(model, {
        editor: () => withEditorDetails(model.editor, { takenAt: value }),
      }),
    }),
    SetEditorCamera: ({ value }) => ({
      model: modifyFields(model, {
        editor: () => withEditorDetails(model.editor, { camera: value }),
      }),
    }),
    SetEditorLens: ({ value }) => ({
      model: modifyFields(model, {
        editor: () => withEditorDetails(model.editor, { lens: value }),
      }),
    }),
    SetEditorFocalLength: ({ value }) => ({
      model: modifyFields(model, {
        editor: () => withEditorDetails(model.editor, { focalLength: value }),
      }),
    }),
    SetEditorAperture: ({ value }) => ({
      model: modifyFields(model, {
        editor: () => withEditorDetails(model.editor, { aperture: value }),
      }),
    }),
    SetEditorShutter: ({ value }) => ({
      model: modifyFields(model, {
        editor: () => withEditorDetails(model.editor, { shutter: value }),
      }),
    }),
    SetEditorIso: ({ value }) => ({
      model: modifyFields(model, {
        editor: () => withEditorDetails(model.editor, { iso: value }),
      }),
    }),
    SetEditorSlug: ({ value }) => ({
      model: modifyFields(model, {
        editor: () => withEditorDetails(model.editor, { slug: value }),
      }),
    }),
    SetEditorRatio: ({ ratio }) => ({
      model: modifyFields(model, {
        editor: () => withEditorRatio(model.editor, model.photo, ratio),
      }),
    }),
    // The Status group. The pick is the Segment child's own state, folded by
    // `GotSegmentMessage`; what the parent does with it is a lifecycle write
    // (`SetPhotoStatus`, not `UpdatePhoto`), and the group is put back on the
    // stored value when the write answers.
    SucceededSetEditorStatus: ({ id, photo }) => {
      if (model.route._tag !== 'Photo' || model.route.id !== id) return { model }
      const synced = modifyFields(withOptional(model, { photo }), {
        segmentGroups: () => withEditorStatusSelected(model.segmentGroups, photo.status ?? 'draft'),
      })
      // A Status moved, so the sidebar's counts moved: re-read rather than
      // patch, exactly as the Library's row menu does.
      return { model: synced, commands: [FetchCountsCmd()] }
    },
    FailedSetEditorStatus: () =>
      showToast(
        modifyFields(model, {
          segmentGroups: () =>
            withEditorStatusSelected(model.segmentGroups, model.photo?.status ?? 'draft'),
        }),
        'Could not change the status',
        'Error',
      ),
    SteppedEditorLevel: ({ direction }) => ({
      model: modifyFields(model, { editor: () => withEditorLevel(model.editor, direction) }),
    }),
    ToggledEditorFlip: () => ({
      model: modifyFields(model, { editor: () => withEditorFlip(model.editor) }),
    }),
    StartedEditorCropDrag: ({ x, y, width, height }) => ({
      model: modifyFields(model, {
        editor: () => withCropDragStart(model.editor, { x, y, width, height }),
      }),
    }),
    DraggedEditorCrop: ({ x, y }) => ({
      model: modifyFields(model, { editor: () => withEditorPan(model.editor, x, y) }),
    }),
    EndedEditorCropDrag: () => ({
      model: modifyFields(model, { editor: () => withCropDragEnd(model.editor) }),
    }),
    ZoomedEditorCrop: ({ deltaY }) => ({
      model: modifyFields(model, { editor: () => withEditorZoom(model.editor, deltaY) }),
    }),
    SubmitEditorUpdate: () => {
      if (model.route._tag !== 'Photo') return { model }
      const { draft, ratio, detailsDraft, saving } = model.editor
      if (draft === undefined || detailsDraft === undefined || saving) return { model }
      if (!isEditorDirty(model.editor)) return { model }
      const detailsDirty = isDetailsDirty(model.editor)
      // The Blurhash is a Photo column, not a Presentation field, so it rides
      // the `UpdatePhoto` call beside the Ratio. Sent only when the client's
      // re-encode of the composition differs from what the row already holds,
      // so a save that did not touch the pixels writes nothing.
      const storedBlurhash = model.photo?.blurhash ?? undefined
      const blurhash =
        model.editor.blurhash !== undefined && model.editor.blurhash !== storedBlurhash
          ? model.editor.blurhash
          : undefined
      return {
        model: modifyFields(model, { editor: () => ({ ...model.editor, saving: true }) }),
        commands: [
          UpdateEditorCmd({
            id: model.route.id,
            presentation: draft,
            // Spread rather than `ratio: undefined`: a Command instance matches
            // by structural args equality in a scene test, and an absent key
            // and a present-but-undefined one are not the same object.
            ...(ratio === undefined ? {} : { ratio }),
            ...(blurhash === undefined ? {} : { blurhash }),
            savePresentation: isPresentationDirty(model.editor),
            // The record's own fields when they moved, with the metadata blob
            // the panel does not edit carried because `UpdatePhoto` replaces
            // the whole thing.
            ...(detailsDirty
              ? {
                  details: detailsDraft,
                  metadata: metadataWithDetails(model.photo?.metadata, detailsDraft),
                }
              : {}),
          }),
        ],
      }
    },
    UpdatedEditor: ({ id, presentation, photo }) => {
      if (model.route._tag !== 'Photo' || model.route.id !== id) return { model }
      // The snapshots become what the database holds, not what was sent, so a
      // value the service changed comes back as what it stored rather than as
      // still-dirty. The Ratio override is spent either way: a save that wrote
      // one stored it, and a save that did not had none to spend. `photo` is
      // absent for a Presentation-only save, which leaves the record's own
      // snapshot alone. No toast: the unsaved dot going out and `Update` going
      // quiet are the design's own confirmation.
      const details = photo === undefined ? undefined : detailsOfPhoto(photo)
      const withPhoto = photo === undefined ? model : withOptional(model, { photo })
      return {
        model: modifyFields(withPhoto, {
          editor: () => ({
            ...model.editor,
            snapshot: presentation,
            draft: { ...presentation },
            ratio: undefined,
            // The row now holds the hash the save carried; keep it as the
            // draft's own so the readout never regresses to the pre-save value.
            ...(photo === undefined ? {} : { blurhash: photo.blurhash ?? undefined }),
            ...(details === undefined
              ? {}
              : { detailsSnapshot: details, detailsDraft: { ...details } }),
            cropDrag: undefined,
            saving: false,
          }),
        }),
      }
    },
    DiscardEditor: () => {
      const reverted = discardEditorDraft(model)
      return reverted === undefined ? { model } : { model: reverted }
    },
    RequestLeaveEditor: ({ url }) => {
      const target = url ?? editorReturnUrl(model.editor.returnRoute)
      return model.route._tag === 'Photo' && isEditorDirty(model.editor)
        ? withLeaveGuard(model, target)
        : { model, commands: [NavigateCmd({ url: target })] }
    },
    ConfirmedLeaveEditor: () => {
      const closed = Dialog.close(model.editor.leaveDialog)
      // `Discard and leave` is the guard's own `DiscardEditor`: the draft has to
      // go before the `Navigate` goes out, or the URL it lands on comes back as
      // a `ChangedUrl` that still reads as a dirty Editor — and `ChangedUrl`
      // undoes the step and raises this same guard again, which is what left
      // the operator on the page they had just agreed to leave.
      const discarded = discardEditorDraft(model)
      const base = discarded ?? model
      return {
        model: modifyFields(base, {
          editor: () => ({ ...base.editor, leaveDialog: closed.model, leaveUrl: '' }),
        }),
        commands: [
          NavigateCmd({ url: model.editor.leaveUrl }),
          ...liftChildCommands(closed.commands ?? [], (message) =>
            Message.GotEditorLeaveMessage({ message }),
          ),
        ],
      }
    },
    // ----- the Settings page ------------------------------------------------------
    // One helper for every control: the draft is one value, so a write is a
    // spread of one field over it, and the field's own type is the Message's.
    SucceededGetSettings: ({ settings }) => {
      // A re-read landing mid-edit must not throw the edit away. The row moves
      // under the draft, the draft keeps what the operator typed, and the save
      // still sends the draft — so the operator's edit wins and the read after
      // the save is what confirms it.
      const keepDraft = settingsUnsaved(model.settingsDraft, model.settings)
      return {
        model: modifyFields(withOptional(model, { settings }), {
          settingsStatus: () => 'ready',
          settingsDraft: () => (keepDraft ? model.settingsDraft : toSettingsDraft(settings)),
        }),
      }
    },
    FailedGetSettings: () => ({
      model: modifyFields(model, { settingsStatus: () => 'error' }),
    }),
    RetryFetchSettings: () => ({
      model: modifyFields(model, { settingsStatus: () => 'loading' }),
      commands: [FetchSettingsCmd()],
    }),
    SetSettingsNumber: ({ field, value }) => ({ model: setDraftField(model, field, value) }),
    SetMetadataPolicy: ({ field, isChecked }) => ({
      model: setDraftField(model, field, isChecked),
    }),
    SetPreviewFormat: ({ value }) => ({
      model: setDraftField(model, 'defaultPreviewFormat', value),
    }),
    SetWatermarkEnabled: ({ isChecked }) => ({
      model: setDraftField(model, 'watermarkEnabled', isChecked),
    }),
    SetWatermarkColour: ({ colour }) => ({
      model: setDraftField(model, 'watermarkColour', colour),
    }),
    SetWatermarkPosition: ({ value }) => ({
      model: setDraftField(model, 'watermarkPosition', value),
    }),
    SetRetention: ({ forever }) => ({ model: setDraftField(model, 'retainForever', forever) }),
    // A save with nothing to save is not a save: it would stamp a new
    // `updatedAt` and make the header claim a write the operator did not make.
    SaveSettings: () => {
      if (!settingsUnsaved(model.settingsDraft, model.settings)) return { model }
      return {
        model: modifyFields(model, { settingsSaving: () => true }),
        commands: [SaveSettingsCmd({ input: settingsInputOf(model.settingsDraft) })],
      }
    },
    // The stored row, not the draft that produced it: a save that the server
    // narrowed answers with what it kept, and that is what the form now holds.
    SavedSettings: ({ settings }) => {
      const saved = modifyFields(withOptional(model, { settings }), {
        settingsStatus: () => 'ready',
        settingsDraft: () => toSettingsDraft(settings),
        settingsSaving: () => false,
      })
      return showToast(saved, 'Settings saved', 'Success', undefined, [])
    },
    DiscardSettings: () => ({
      model: modifyFields(model, {
        settingsDraft: () =>
          model.settings === undefined ? emptySettingsDraft : toSettingsDraft(model.settings),
      }),
    }),
    ExportCsvIndex: () => {
      if (model.settingsIndexing) return { model }
      return {
        model: modifyFields(model, { settingsIndexing: () => true }),
        commands: [ExportCsvIndexCmd()],
      }
    },
    ExportedCsvIndex: ({ photos }) =>
      showToast(
        modifyFields(model, { settingsIndexing: () => false }),
        `Exported ${photoCountLabel(photos)}`,
        'Success',
        'photo-index.csv',
      ),
    FailedExportCsvIndex: ({ message: failure }) => {
      const failed = modifyFields(model, { settingsIndexing: () => false })
      return showToast(failed, 'Could not export the index', 'Error', failure)
    },

    // ----- the Library table ---------------------------------------------------------
    ToggledRowSelection: ({ id }) => ({
      model: modifyFields(model, { selected: () => toggleIn(model.selected, id) }),
    }),
    ToggledPageSelection: () => {
      const ids: ReadonlyArray<string> = model.photos.map((photo) => photo.id)
      // Off, some, all — over the page, because that is the set of rows a
      // header checkbox on a paged table is talking about. Ticking it twice is
      // unticking the page, which is what a checkbox means.
      const allTicked = ids.length > 0 && ids.every((id) => model.selected.includes(id))
      return {
        model: modifyFields(model, {
          selected: () =>
            allTicked
              ? model.selected.filter((id) => !ids.includes(id))
              : [...model.selected, ...ids.filter((id) => !model.selected.includes(id))],
        }),
      }
    },
    ClearedSelection: () => ({ model: clearSelection(model) }),
    SteppedLibraryPage: ({ delta }) => {
      const target = model.libraryPage + delta
      // The first page has no cursor to go back to, and the last page is the
      // one whose response carried no `nextCursor`. A step past either end is
      // a no-op rather than a fetch that answers with nothing.
      if (target < 0 || (delta > 0 && model.nextCursor === null)) return { model }
      // Going forwards reads the cursor the page on screen handed over; going
      // back reads the one already held for that page. Both are positions in
      // the same ordering, so neither is invented.
      const cursor = delta > 0 ? (model.nextCursor ?? '') : (model.libraryCursors[target] ?? '')
      const cursors =
        delta > 0
          ? [...model.libraryCursors.slice(0, target), cursor]
          : model.libraryCursors.slice(0, target + 1)
      // The page number is part of the URL, but the position is the cursor: a
      // reload has no cursor chain, so it walks the keyset to this number.
      const filters = { ...libraryFiltersOfModel(model), page: target }
      return {
        model: modifyFields(model, {
          libraryPage: () => target,
          libraryCursors: () => cursors,
          status: () => 'loading',
        }),
        commands: [
          FetchPhotosCmd({ ...listArgsOf(filters), cursor }),
          ReplaceUrlCmd({ url: libraryUrl(filters) }),
        ],
      }
    },

    OpenedRowMenu: ({ id }) => {
      const opened = Dialog.open(model.rowMenu)
      return {
        model: modifyFields(withOptional(model, { rowMenuId: id }), {
          rowMenu: () => opened.model,
        }),
        commands: liftChildCommands(opened.commands ?? [], (message) =>
          Message.GotRowMenuMessage({ message }),
        ),
      }
    },
    SetRowStatus: ({ id, status }) => {
      // The menu has done its job; it closes rather than sitting behind the
      // row it was opened on.
      const closed = Dialog.close(model.rowMenu)
      const dismissed = modifyFields(withOptional(model, { rowMenuId: undefined }), {
        rowMenu: () => closed.model,
      })
      return {
        model: dismissed,
        commands: [
          SetRowStatusCmd({ id, status, page: currentPage(dismissed) }),
          ...liftChildCommands(closed.commands ?? [], (message) =>
            Message.GotRowMenuMessage({ message }),
          ),
        ],
      }
    },
    SucceededSetRowStatus: ({ status, ...page }) =>
      settled(
        model,
        page,
        status === 'published' ? 'Published' : 'Unpublished',
        status === 'published'
          ? 'A visitor can see it on the public site.'
          : 'A visitor can no longer see it.',
      ),
    /** The row menu's `Move to Trash`. The menu closes before the confirm
     *  opens: the confirm is the same Dialog every other destructive action
     *  uses, and two stacked dialogs are two ways to cancel one thing. */
    RequestedRowTrash: ({ id, title }) => {
      const closed = Dialog.close(model.rowMenu)
      const dismissed = modifyFields(withOptional(model, { rowMenuId: undefined }), {
        rowMenu: () => closed.model,
      })
      const confirmed = openConfirm(dismissed, { kind: 'photo', id, label: title })
      return {
        model: confirmed.model,
        commands: [
          ...liftChildCommands(closed.commands ?? [], (message) =>
            Message.GotRowMenuMessage({ message }),
          ),
          ...(confirmed.commands ?? []),
        ],
      }
    },
    OpenedPhoto: ({ id }) => ({
      model,
      commands: [NavigateCmd({ url: appRouteToUrl({ _tag: 'Photo', id }) })],
    }),

    OpenedAddTag: () => {
      const opened = Dialog.open(model.addTagDialog)
      return {
        model: modifyFields(model, {
          addTagDialog: () => opened.model,
          addTagIds: () => [],
          removeTagIds: () => [],
          bulkDetails: () => EMPTY_BULK_DETAILS,
        }),
        commands: liftChildCommands(opened.commands ?? [], (message) =>
          Message.GotAddTagDialogMessage({ message }),
        ),
      }
    },
    // A Tag is added or removed, never both, so ticking it in one list unticks
    // it in the other.
    ToggledAddTag: ({ id }) => ({
      model: modifyFields(model, {
        addTagIds: () => toggleIn(model.addTagIds, id),
        removeTagIds: () => model.removeTagIds.filter((tag) => tag !== id),
      }),
    }),
    ToggledRemoveTag: ({ id }) => ({
      model: modifyFields(model, {
        removeTagIds: () => toggleIn(model.removeTagIds, id),
        addTagIds: () => model.addTagIds.filter((tag) => tag !== id),
      }),
    }),
    SetBulkDetail: ({ field, value }) => ({
      model: modifyFields(model, { bulkDetails: () => ({ ...model.bulkDetails, [field]: value }) }),
    }),
    ConfirmAddTag: () => {
      const tagIds = [...model.addTagIds]
      const removeTagIds = [...model.removeTagIds]
      const { patch, invalid } = bulkDetailsPatch(model.bulkDetails)
      const hasDetails = Object.keys(patch).length > 0
      const ids = selectedIds(model)
      if (invalid || ids.length === 0) return { model }
      if (tagIds.length === 0 && removeTagIds.length === 0 && !hasDetails) return { model }
      const closed = Dialog.close(model.addTagDialog)
      const prepared = modifyFields(model, { addTagDialog: () => closed.model })
      return {
        model: prepared,
        commands: [
          BulkAddTagsCmd({
            ids,
            tagIds,
            // Spread rather than `undefined`: see `SubmitEditorUpdate`.
            ...(removeTagIds.length === 0 ? {} : { removeTagIds }),
            ...(hasDetails ? { details: patch } : {}),
            page: currentPage(prepared),
          }),
          ...liftChildCommands(closed.commands ?? [], (message) =>
            Message.GotAddTagDialogMessage({ message }),
          ),
        ],
      }
    },
    // The picked Tags are still on the Model here — the pick is cleared by the
    // write's outcome, not before it, so the toast can name what was applied.
    SucceededAddTag: ({ count, ...page }) => {
      const label = (id: string): string =>
        `“${model.tags.find((tag) => tag.id === id)?.label ?? id}”`
      const { patch } = bulkDetailsPatch(model.bulkDetails)
      const parts = [
        ...(model.addTagIds.length > 0 ? [`added ${model.addTagIds.map(label).join(', ')}`] : []),
        ...(model.removeTagIds.length > 0
          ? [`removed ${model.removeTagIds.map(label).join(', ')}`]
          : []),
        ...(Object.keys(patch).length > 0 ? [`set ${Object.keys(patch).join(', ')}`] : []),
      ]
      return settled(
        modifyFields(model, {
          addTagIds: () => [],
          removeTagIds: () => [],
          bulkDetails: () => EMPTY_BULK_DETAILS,
        }),
        page,
        `Edited ${photoCountLabel(count)}`,
        parts.length > 0 ? parts.join('; ') : undefined,
      )
    },
    AddBorderToSelection: () => {
      const ids = selectedIds(model)
      if (ids.length === 0) return { model }
      return { model, commands: [AddBorderCmd({ ids, page: currentPage(model) })] }
    },
    SucceededAddBorder: ({ count, ...page }) =>
      settled(
        model,
        page,
        `Border added to ${photoCountLabel(count)}`,
        `Even mat, paper, ${String(BULK_BORDER_MAT.width)}%.`,
      ),
    SetSelectionStatus: ({ status }) => {
      const ids = selectedIds(model)
      if (ids.length === 0) return { model }
      return { model, commands: [BulkSetStatusCmd({ ids, status, page: currentPage(model) })] }
    },
    SucceededSetSelectionStatus: ({ count, status, ...page }) =>
      settled(
        model,
        page,
        `${photoCountLabel(count)} ${status === 'published' ? 'published' : 'unpublished'}`,
        status === 'published'
          ? 'Visitors can see them on the public site.'
          : 'Visitors can no longer see them.',
      ),
    SetEditorPhotoStatus: ({ status }) => {
      if (model.route._tag !== 'Photo' || model.photo === undefined) return { model }
      if (model.photoStatus !== 'ready' || model.editor.saving) return { model }
      return {
        model: modifyFields(model, {
          segmentGroups: () => withEditorStatusSelected(model.segmentGroups, status),
        }),
        commands: [SetEditorStatusCmd({ id: model.route.id, status })],
      }
    },
    RequestBulkTrash: ({ count }) => openConfirm(model, { kind: 'bulk', count }),
    SucceededBulkTrash: ({ count, ...page }) => {
      // Every selected Photo left every list, so the selection goes with them:
      // it named rows this page can no longer show, and a Bulk Bar still
      // offering them would offer a second delete of photographs that are
      // already in the Trash.
      const cleared = clearSelection(model)
      return settled(
        cleared,
        page,
        `${photoCountLabel(count)} moved to Trash`,
        'Nothing was purged. Originals stay in R2, and no number is ever reused.',
      )
    },

    // ----- routing -------------------------------------------------------------------
    // A plain anchor the runtime intercepted, and a URL that changed without a
    // click (popstate, or a navigation the runtime itself performed).
    ClickedLink: ({ request }) =>
      UrlRequest.match<UpdateReturn>(request, {
        // The public Home page shares this origin, and so does any other origin the
        // operator links to: neither is this document. Everything inside the
        // Admin's own URL space is, including a path that names no route —
        // that one is the Admin's NotFound page, not a document to fetch.
        Internal: ({ url }) => {
          const target = urlToString(url)
          // An unproven session has no in-app way back. Every read the
          // navigation would dispatch is a read the gate just refused, so the
          // only request that can change the answer is a *document* request
          // for this same path — which is the one Access turns into a login,
          // because Access runs at the edge, before this Worker.
          //
          // The runtime's link listener has already called `preventDefault`
          // by the time this message arrives, so the browser will not make
          // that request on its own: an in-app `Navigate` would leave the
          // affordance inert, pushing the URL it is already on. This is the
          // same rule the view's own comment argues for, and it is decided
          // here because this is where a clicked anchor stops being the
          // browser's and becomes ours.
          //
          // It comes before the Editor's leave guard on purpose: that guard's
          // Dialog is drawn by the shell, and an expired session replaces the
          // shell (`views/session.ts`), so raising it would raise a dialog
          // nothing draws.
          if (model.session.status === 'expired') {
            return { model, commands: [LoadCmd({ href: target })] }
          }
          // Leaving the Editor with unsaved changes asks first, whether the
          // link is `← Library` or anything else in the Admin's URL space.
          if (discardsTheDraft(model, urlToAppRoute(url))) {
            return withLeaveGuard(model, target)
          }
          return isAdminPath(url.pathname)
            ? { model, commands: [NavigateCmd({ url: target })] }
            : { model, commands: [LoadCmd({ href: target })] }
        },
        External: ({ href }) => ({ model, commands: [LoadCmd({ href })] }),
      }),
    ChangedUrl: ({ url }) =>
      closingNav(() => {
        const nextRoute = urlToAppRoute(url)
        // A popstate has already moved the URL bar. Leaving a dirty Editor
        // through one undoes the step and asks, because an in-app history move
        // does not fire `beforeunload` and would otherwise be the one way out of
        // the Editor that loses an authored crop. Going *back* rather than
        // writing the Editor's URL into the bar is what puts the operator where
        // they were, with the entry they came from still behind them.
        if (discardsTheDraft(model, nextRoute)) {
          const guard = withLeaveGuard(model, editorReturnUrl(model.editor.returnRoute))
          return { model: guard.model, commands: [BackCmd(), ...(guard.commands ?? [])] }
        }
        // A filter change moves the URL and the Model together and then the
        // runtime reports the new URL back. When the Model already holds exactly
        // what the route names — and the route the Model last saw names
        // something else — the change was ours: adopt the route and stop, so
        // clicking a filter costs one page read rather than two and does not
        // re-run the shell's three reads. A URL that changed while the route did
        // not is a real navigation and falls through to `applyRoute`.
        const nextFilters = nextRoute._tag === 'Library' ? libraryFiltersOf(nextRoute) : undefined
        const routeFilters = libraryFiltersOf(model.route)
        const routeUnchanged =
          nextFilters !== undefined &&
          model.route._tag === 'Library' &&
          sameLibraryFilters(nextFilters, routeFilters)
        if (
          !routeUnchanged &&
          nextFilters !== undefined &&
          model.route._tag === 'Library' &&
          sameLibraryFilters(nextFilters, libraryFiltersOfModel(model))
        ) {
          return { model: modifyFields(model, { route: () => nextRoute }) }
        }
        // `← Library` goes back to the route the Editor was opened from, so a
        // Photo reached from a filtered Library returns to that same filter.
        // Recorded here rather than in `applyRoute`, which is handed the model
        // with the route already changed and so no longer knows where the Editor
        // was opened from.
        const returning =
          model.route._tag !== 'Photo' && nextRoute._tag === 'Photo'
            ? withOptional(model, { editor: { ...model.editor, returnRoute: model.route } })
            : model
        return applyRoute(
          modifyFields(returning, { route: () => nextRoute }),
          Transition.make(model.route, nextRoute),
        )
      }),
    CompletedNavigate: () => ({ model }),
    CompletedLoad: () => ({ model }),

    // ----- child message folds ----------------------------------------------------------
    GotUploadDialogMessage: ({ message }) => foldUploadDialog(model, message),
    GotConfirmMessage: ({ message }) => foldConfirm(model, message),
    GotRowMenuMessage: ({ message }) => foldRowMenu(model, message),
    GotAddTagDialogMessage: ({ message }) => foldAddTag(model, message),
    GotFileDropMessage: ({ message }) =>
      // A drop anywhere the FileDrop is real (the dialog, the Library strip, the
      // atoms sheet) opens the dialog on what it queued, so the operator can
      // tag the batch before it goes up.
      withUploadDialogOpen(foldFileDrop(model, message)),
    GotToastMessage: ({ message }) => foldToast(model, message),
    // One Segment group, by id. Every group's pick is view state except the
    // `DETAILS` Status group's, which is a lifecycle write: the child's own
    // fold has already moved the selection, and the parent adds the
    // `SetPhotoStatus` call. `SucceededSetEditorStatus` puts the selection back
    // on the stored value, so a pick that fails leaves the group where it was.
    GotSegmentMessage: ({ groupId, message }) => {
      const folded = foldSegmentGroup(groupId)(model, message)
      if (
        groupId !== EDITOR_STATUS_SEGMENT.id ||
        message._tag !== 'Picked' ||
        !isPhotoStatus(message.value) ||
        model.route._tag !== 'Photo' ||
        model.photo === undefined ||
        model.photoStatus !== 'ready'
      ) {
        return folded
      }
      return {
        model: folded.model,
        commands: [
          SetEditorStatusCmd({ id: model.route.id, status: message.value }),
          ...(folded.commands ?? []),
        ],
      }
    },
    // The Crop Ratio `Segment` is authored rather than stored child state: its
    // pick moves the Editor's Ratio override, and the next render reads the
    // selection back off the override, so there is no second copy to sync.
    GotCropRatioMessage: ({ message }) =>
      Segment.Message.match<UpdateReturn>(message, {
        Picked: ({ value }) =>
          isPhotoRatio(value)
            ? {
                model: modifyFields(model, {
                  editor: () => withEditorRatio(model.editor, model.photo, value),
                }),
              }
            : { model },
      }),
    GotEditorLeaveMessage: ({ message }) => foldEditorLeave(model, message),

    // SAFETY: the carrier is S.Unknown because the multi-combobox child
    // message schema is not part of @foldkit/ui's public surface; these
    // messages were produced by this module's own toParentMessage wrapper.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    GotUploadComboMessage: ({ message }) => foldUploadCombo(model, message as never),
  })

/** Write one field of the draft. The draft is one value, so a control's write
 *  is a spread of its own field over it, and the field's type is the type the
 *  Message carried. */
const setDraftField = <K extends keyof SettingsDraft>(
  model: Model,
  field: K,
  value: SettingsDraft[K],
): Model =>
  modifyFields(model, { settingsDraft: () => ({ ...model.settingsDraft, [field]: value }) })

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

/** Does moving to `next` throw away an unsaved draft? True for every route
 *  change out of the Editor, and for a move to a *different* Photo inside it —
 *  which re-reads both the Photo and its Presentation, so the draft goes with
 *  it. Staying on the same Photo is the one move that keeps it. */
const discardsTheDraft = (model: Model, next: AppRoute): boolean =>
  model.route._tag === 'Photo' &&
  (next._tag !== 'Photo' || next.id !== model.route.id) &&
  isEditorDirty(model.editor)

/** Put the Editor's draft back to the snapshot it loaded, or `undefined` when
 *  there is no draft to put back. The Ratio override, the `DETAILS` record and
 *  any pan in flight go back with the draft: `Discard` is "put the snapshot
 *  back", and a half-dragged crop is not something the operator asked to keep.
 *
 *  Shared by `DiscardEditor` and the leave guard's `Discard and leave`, because
 *  leaving *is* discarding — and a guard that navigated with the draft still in
 *  the model would have its own `Navigate` undone by the `ChangedUrl` it
 *  provokes. */
const discardEditorDraft = (model: Model): Model | undefined => {
  const { snapshot, draft, detailsSnapshot } = model.editor
  if (snapshot === undefined || draft === undefined) return undefined
  return modifyFields(model, {
    editor: () => ({
      ...model.editor,
      snapshot,
      draft: { ...snapshot },
      ratio: undefined,
      // The stored hash is what the composition drew before the edits, so
      // `Discard` puts the readout back with the draft (CONTEXT.md).
      blurhash: model.photo?.blurhash ?? undefined,
      ...(detailsSnapshot === undefined ? {} : { detailsDraft: { ...detailsSnapshot } }),
      cropDrag: undefined,
      saving: false,
    }),
  })
}

/** Raise the Editor's leave guard on `url`, or leave the model alone when it is
 *  already raised — a second `← Library` press while the dialog is up must not
 *  re-run the open animation or move the URL the guard is holding. */
const withLeaveGuard = (model: Model, url: string): UpdateReturn => {
  if (model.editor.leaveDialog.isOpen) return { model }
  const opened = Dialog.open(model.editor.leaveDialog)
  return {
    model: modifyFields(model, {
      editor: () => ({ ...model.editor, leaveDialog: opened.model, leaveUrl: url }),
    }),
    commands: liftChildCommands(opened.commands ?? [], (message) =>
      Message.GotEditorLeaveMessage({ message }),
    ),
  }
}

export function update(model: Model, message: Msg): UpdateReturn {
  return step(model, message)
}
