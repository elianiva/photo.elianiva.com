/**
 * Admin commands — the RPC seam (ADR 0006). Every side-effecting operation
 * the Admin performs runs here and reports back through Message variants.
 *
 * Every Photo read goes through `rpcAdmin`. The Admin is the audience that
 * needs a Draft, a failed upload and the Editor's own Photo, and the public
 * group is the one that must not have them: it is the ungated `/rpc`, and
 * `PublicPhotoService` is what keeps a Draft out of it.
 */

import { Effect, Schema as S } from 'effect'
import * as Command from 'foldkit/command'
import { load, pushUrl, replaceUrl, back } from 'foldkit/navigation'
import { PhotoId, PhotoPresentation, SettingsInput } from '@photo/shared'
import { LibrarySort, PhotoRatio, PhotoStatus } from '@photo/shared'
import type { PhotoIndexRow, PhotoWithTags, Settings, Tag } from '@photo/shared'

import { RpcFailure, rpcAdmin, rpcPublic } from '@/lib/rpc'

import { CSV_INDEX_FILENAME, csvIndex, downloadCsv } from './storage-index'
import { librarySortOf } from './route'
import type { LibraryFilters } from './route'
import { BULK_BORDER_MAT, GridCols, LIBRARY_PAGE_SIZE, Message, Storage } from './model'
import type { Counts as CountsType, GridCols as GridColsType, LibraryPage } from './model'

/** `ListLibraryRows` as the wire delivers it: the page's rows under `items`,
 *  the cursor that would follow, and the filtered total behind both. */
interface PhotoPage {
  readonly items: ReadonlyArray<PhotoWithTags>
  readonly nextCursor: string | null
  readonly total: number
}

/** The Access facts the sidebar's footer reads: the signed-in address and the
 *  team that vouched for it. */
interface Session {
  readonly email: string | null
  readonly teamDomain: string | null
}

/** The sidebar meter's aggregate, whole: the Storage block's frame count and
 *  the sidebar's byte fraction are the same payload. */
type StorageUsage = Storage

/** Narrow on purpose: widening this to the whole Message union would leak
 *  every variant into each command's success channel. */
const failWith = (error: RpcFailure) => Message.FailedRpc({ message: error.message })

// ---------------------------------------------------------------------------
// the shell's three reads
// ---------------------------------------------------------------------------

/** The Access claims the API worker's gate already verified. A failure is not
 *  a toast: the Admin has no signed-out state to fall back to, so a session it
 *  cannot prove is the one thing that replaces the whole shell with the
 *  sign-in affordance. */
export const FetchSessionCmd = Command.define('FetchSession', {
  messages: [Message.SucceededGetSession, Message.FailedGetSession],
  execute: Effect.map(rpcAdmin<Session>('GetSession', {}), ({ email, teamDomain }) =>
    Message.SucceededGetSession({ email, teamDomain }),
  ).pipe(Effect.catch(() => Effect.succeed(Message.FailedGetSession({})))),
})

/** The sidebar's counts. Re-issued on every route change and after every
 *  mutation, so a count never outlives the write that moved it. */
export const FetchCountsCmd = Command.define('FetchCounts', {
  messages: [Message.SucceededGetCounts, Message.FailedGetCounts],
  execute: Effect.map(rpcAdmin<CountsType>('GetCounts', {}), (counts) =>
    Message.SucceededGetCounts(counts),
  ).pipe(Effect.catch(() => Effect.succeed(Message.FailedGetCounts({})))),
})

/** The Storage meter's aggregate. `photos` rides in the same payload and the
 *  Storage block (#37) draws it beside the byte total, so the Model keeps the
 *  whole read rather than the half the sidebar happens to use. */
export const FetchStorageCmd = Command.define('FetchStorage', {
  messages: [Message.SucceededGetStorage, Message.FailedGetStorage],
  execute: Effect.map(rpcAdmin<StorageUsage>('GetStorageUsage', {}), (usage) =>
    Message.SucceededGetStorage(usage),
  ).pipe(Effect.catch(() => Effect.succeed(Message.FailedGetStorage({})))),
})

// ---------------------------------------------------------------------------
// grid density persistence
// ---------------------------------------------------------------------------

/** The RPC's list args for a filter. `status` and `ratio` are not stored
 *  values; the same function decides that as the URL does, so no caller can
 *  send the client's `all` to a column that only knows `draft`. */
export const listArgsOf = (filters: LibraryFilters): PhotoListArgs => {
  const status: PhotoStatus | undefined =
    filters.status === 'all' || filters.status === 'scheduled' ? undefined : filters.status
  const ratio: PhotoRatio | undefined = filters.ratio === 'any' ? undefined : filters.ratio
  return {
    ...(status === undefined ? {} : { status }),
    ...(ratio === undefined ? {} : { ratio }),
    tagIds: [...filters.tagIds],
    q: filters.q,
    ...(filters.sort === 'newest' ? {} : { sort: librarySortOf(filters.sort) }),
  }
}

/** Where the table is reading: its filter, and the keyset position of the page.
 *  The empty string is the first page, which is the only page with no cursor.
 *
 *  The four optional keys are the Filter Bar's: Status, Ratio and Sort are
 *  omitted when they are the default, so an unfiltered read asks for exactly
 *  what it asked for before they existed. */
const photoListFields = {
  status: S.optional(PhotoStatus),
  ratio: S.optional(PhotoRatio),
  tagIds: S.Array(S.String),
  q: S.String,
  sort: S.optional(LibrarySort),
  cursor: S.optional(S.String),
}
export const PhotoListArgs = S.Struct(photoListFields)
export type PhotoListArgs = typeof PhotoListArgs.Type

/** A list read that is not the first page: the cursor is the position. */
export const PageArgs = S.Struct({ ...photoListFields, cursor: S.String })
export type PageArgs = typeof PageArgs.Type

/** One `ListLibraryRows` read. Every list read in the Admin goes through here,
 *  so a page of rows and the number it is paged over are never fetched under
 *  two different filters. */
const listPayload = (args: {
  tagIds: readonly string[]
  q: string
  cursor?: string | undefined
  status?: PhotoStatus | undefined
  ratio?: PhotoRatio | undefined
  sort?: typeof LibrarySort.Type | undefined
}) =>
  rpcAdmin<PhotoPage>('ListLibraryRows', {
    ...(args.tagIds.length > 0 ? { tagIds: [...args.tagIds] } : {}),
    ...(args.q === '' ? {} : { q: args.q }),
    ...(args.cursor === undefined || args.cursor === '' ? {} : { cursor: args.cursor }),
    ...(args.status === undefined ? {} : { status: args.status }),
    ...(args.ratio === undefined ? {} : { ratio: args.ratio }),
    ...(args.sort === undefined ? {} : { sort: args.sort }),
    limit: LIBRARY_PAGE_SIZE,
  })

const toLibraryPage = (page: PhotoPage): LibraryPage => ({
  photos: [...page.items],
  nextCursor: page.nextCursor,
  total: page.total,
})
/** The contract's `PhotoIds` caps a call at a hundred ids, which is the D1 bind
 *  bound rather than an arbitrary number, and a selection can span more pages
 *  than that. The fold is all-or-nothing per call, so a chunked run is ordered
 *  and stops at the first chunk that fails — the same guarantee one large call
 *  would have given. */
const BULK_CHUNK = 100
const foldOverChunks = <E>(
  ids: ReadonlyArray<string>,
  batch: (ids: ReadonlyArray<string>) => Effect.Effect<unknown, E>,
): Effect.Effect<void, E> =>
  Effect.gen(function* () {
    for (let start = 0; start < ids.length; start += BULK_CHUNK) {
      yield* batch(ids.slice(start, start + BULK_CHUNK))
    }
  })

// ---------------------------------------------------------------------------
// the table's writes
//
// Every one of these ends by re-reading the page it was fired from. A Photo
// that changed Status, gained a Tag, gained a Mat or left the library is a row
// the table is now holding wrong, and a count read before the write is a count
// that is already wrong. `FetchCountsCmd` rides along for the same reason: a
// Status or a Tag moved, so the sidebar's numbers moved too.
// ---------------------------------------------------------------------------

/** A soft delete. The Bulk Bar's `Delete` and the Trash it lands in are one
 *  decision: nothing here touches R2, and the purge that does is the Trash's
 *  own irreversible step. */
export const BulkTrashCmd = Command.define('BulkTrash', {
  args: { ids: S.Array(S.String), page: PageArgs },
  messages: [Message.SucceededBulkTrash, Message.FailedRpc],
  execute: ({ ids, page }) =>
    Effect.gen(function* () {
      yield* foldOverChunks(ids, (batch) => rpcAdmin('TrashPhotos', { ids: [...batch] }))
      const fresh = yield* listPayload(page)
      return Message.SucceededBulkTrash({ count: ids.length, ...toLibraryPage(fresh) })
    }).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

/** `Add border`: one Mat patch on every ticked Photo, folded over the ids one
 *  at a time so a Photo that must exist has to. */
export const AddBorderCmd = Command.define('AddBorder', {
  args: { ids: S.Array(S.String), page: PageArgs },
  messages: [Message.SucceededAddBorder, Message.FailedRpc],
  execute: ({ ids, page }) =>
    Effect.gen(function* () {
      yield* foldOverChunks(ids, (batch) =>
        rpcAdmin('AddBorderToPhotos', { photoIds: [...batch], mat: BULK_BORDER_MAT }),
      )
      const fresh = yield* listPayload(page)
      return Message.SucceededAddBorder({ count: ids.length, ...toLibraryPage(fresh) })
    }).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

/** The design's `Move to series`, re-pointed at `Add tag`: a Series page *is* a
 *  Tag page (ADR 0008), so the grouping entity is the Tag. */
export const BulkAddTagsCmd = Command.define('BulkAddTags', {
  args: { ids: S.Array(S.String), tagIds: S.Array(S.String), page: PageArgs },
  messages: [Message.SucceededAddTag, Message.FailedRpc],
  execute: ({ ids, tagIds, page }) =>
    Effect.gen(function* () {
      yield* foldOverChunks(ids, (batch) =>
        rpcAdmin('BulkAddTags', { photoIds: [...batch], tagIds: [...tagIds] }),
      )
      const fresh = yield* listPayload(page)
      return Message.SucceededAddTag({ count: ids.length, ...toLibraryPage(fresh) })
    }).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

/** Publish and unpublish from a row's `⋯` menu. One Photo, so no chunking and
 *  no count — the row the operator clicked is the row that moves. */
export const SetRowStatusCmd = Command.define('SetRowStatus', {
  args: { id: S.String, status: S.Literals(['draft', 'published']), page: PageArgs },
  messages: [Message.SucceededSetRowStatus, Message.FailedRpc],
  execute: ({ id, status, page }) =>
    Effect.gen(function* () {
      yield* rpcAdmin('SetPhotoStatus', { id, status })
      const fresh = yield* listPayload(page)
      return Message.SucceededSetRowStatus({ status, ...toLibraryPage(fresh) })
    }).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

export const COLS_STORAGE_KEY = 'photo-admin:library:cols'
const COL_CHOICES = [2, 3, 4, 5, 6] as const
const DEFAULT_COLS = 4

/** Restore the persisted column count; falls back to the default when
 *  nothing (or something invalid) is stored. */
export const readStoredCols = (): GridColsType => {
  if (typeof window === 'undefined') return DEFAULT_COLS
  const saved = window.localStorage.getItem(COLS_STORAGE_KEY)
  return COL_CHOICES.find((cols) => String(cols) === saved) ?? DEFAULT_COLS
}

export const PersistColsCmd = Command.define('PersistCols', {
  args: { cols: GridCols },
  messages: [Message.CompletedPersistCols],
  execute: ({ cols }) =>
    Effect.try(() => localStorage.setItem(COLS_STORAGE_KEY, String(cols))).pipe(
      Effect.map(() => Message.CompletedPersistCols()),
      Effect.catch(() => Effect.succeed(Message.CompletedPersistCols())),
    ),
})

/** The Admin's Photo list. It carries the sidebar's filter as a set of Tag ids
 *  and the Page Head's search as `q`, because both are set-shaped: a single
 *  `tagSlug` would let a second pick replace the first rather than narrow it,
 *  and a query that had nowhere to go would be a control that lies. Both keys
 *  are omitted when empty, so "no filter" is the absence of a filter rather
 *  than an empty one.
 *
 *  `cursor` is the keyset position of the page being read. The empty string is
 *  the first page, which is the only page with no cursor. */
export const FetchPhotosCmd = Command.define('FetchPhotos', {
  args: photoListFields,
  messages: [Message.SucceededFetchPhotos, Message.FailedRpc],
  execute: ({ tagIds, q, cursor, status, ratio, sort }) =>
    Effect.map(
      listPayload({ tagIds, q, ...(cursor === undefined ? {} : { cursor }), status, ratio, sort }),
      (page) => Message.SucceededFetchPhotos(toLibraryPage(page)),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

/** A cold load (or a Back press) whose `page` has no cursor in the Model. A
 *  keyset cursor only goes forwards, so the page the URL names is reached by
 *  reading from the first page and keeping each step's `nextCursor`; the chain
 *  rides back in the success message so Previous works afterwards. */
export const FetchLibraryPageCmd = Command.define('FetchLibraryPage', {
  args: { ...photoListFields, page: S.Number },
  messages: [Message.SucceededFetchLibraryPage, Message.FailedRpc],
  execute: ({ page, ...filters }) =>
    Effect.gen(function* () {
      let cursor = ''
      const cursors: Array<string> = ['']
      for (let step = 0; step < page; step += 1) {
        const probe = yield* listPayload({ ...filters, cursor })
        if (probe.nextCursor === null) break
        cursor = probe.nextCursor
        cursors.push(cursor)
      }
      const target = yield* listPayload({ ...filters, cursor })
      return Message.SucceededFetchLibraryPage({
        page: cursors.length - 1,
        cursors,
        photos: [...target.items],
        nextCursor: target.nextCursor,
        total: target.total,
      })
    }).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

export const FetchTagsCmd = Command.define('FetchTags', {
  messages: [Message.SucceededFetchTags, Message.FailedRpc],
  execute: Effect.map(rpcPublic<ReadonlyArray<Tag>>('ListTags', {}), (tags) =>
    Message.SucceededFetchTags({ tags: [...tags] }),
  ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

/** One Photo, for `/admin/photos/<id>`. The route already holds a `PhotoId`,
 *  so this is the Photo's own fetch and it declares its own failure rather
 *  than the grid's: a Photo that is gone must not put the Library in its
 *  error state. */
export const FetchPhotoCmd = Command.define('FetchPhoto', {
  args: { id: S.String },
  messages: [Message.SucceededFetchPhoto, Message.FailedFetchPhoto],
  execute: ({ id }) =>
    Effect.map(rpcAdmin<PhotoWithTags>('GetPhoto', { id }), (photo) =>
      Message.SucceededFetchPhoto({ id: PhotoId.make(id), photo }),
    ).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.FailedFetchPhoto({ id: PhotoId.make(id), message: error.message })),
      ),
    ),
})

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// the Editor
// ---------------------------------------------------------------------------

/** The Editor's loaded snapshot. Separate from the Photo itself because
 *  `GetPhoto` is declared once and served by both RPC groups (#20), and the
 *  authored Presentation is the Admin's business — see `GetPhotoPresentation`
 *  in `@photo/shared`. */
export const FetchPresentationCmd = Command.define('FetchPresentation', {
  args: { id: S.String },
  messages: [Message.SucceededFetchPresentation, Message.FailedFetchPresentation],
  execute: ({ id }) =>
    Effect.map(rpcAdmin<PhotoPresentation>('GetPhotoPresentation', { id }), (presentation) =>
      Message.SucceededFetchPresentation({ id: PhotoId.make(id), presentation }),
    ).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          Message.FailedFetchPresentation({ id: PhotoId.make(id), message: error.message }),
        ),
      ),
    ),
})

/** The Editor's `Update`. One user action commits the two stored facts the
 *  Crop section authors, and each fact is still one call to the RPC that owns
 *  it: the Presentation (crop, level, mat, export) through
 *  `UpdatePhotoPresentation`, and the Ratio through `UpdatePhoto`, because
 *  Ratio is a Photo column rather than a Presentation field (CONTEXT.md).
 *
 *  `savePresentation` is what keeps a Ratio-only save off the crop: rewriting
 *  the crop would enqueue a Rendition regeneration (#35) for a change that did
 *  not touch it. The service answers with the stored truth, which becomes the
 *  Editor's new snapshot — so the unsaved indicator clears off what the
 *  database holds rather than off what was sent. */
export const UpdateEditorCmd = Command.define('UpdateEditor', {
  args: {
    id: S.String,
    presentation: PhotoPresentation,
    /** Present only while the operator's pick differs from the stored Ratio. */
    ratio: S.optional(PhotoRatio),
    savePresentation: S.Boolean,
  },
  messages: [Message.UpdatedEditor, Message.FailedRpc],
  execute: ({ id, presentation, ratio, savePresentation }) =>
    Effect.gen(function* () {
      const stored = savePresentation
        ? yield* rpcAdmin<PhotoPresentation>('UpdatePhotoPresentation', {
            id,
            crop: {
              x: presentation.cropX,
              y: presentation.cropY,
              scale: presentation.cropScale,
              flipX: presentation.cropFlipX,
            },
            level: presentation.level,
            mat: {
              enabled: presentation.borderEnabled,
              style: presentation.borderStyle,
              colour: presentation.borderColour,
              width: presentation.borderWidth,
            },
            export: {
              previewLongEdge: presentation.previewLongEdge,
              previewFormat: presentation.previewFormat,
              previewQuality: presentation.previewQuality,
              fullQuality: presentation.fullQuality,
              keepExif: presentation.keepExif,
              removeGps: presentation.removeGps,
            },
          })
        : presentation
      const storedRatio =
        ratio === undefined
          ? undefined
          : ((yield* rpcAdmin<PhotoWithTags>('UpdatePhoto', { id, ratio })).ratio ?? undefined)
      return Message.UpdatedEditor({
        id: PhotoId.make(id),
        presentation: stored,
        ratio: storedRatio,
      })
    }).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

// ---------------------------------------------------------------------------
// the Settings page
// ---------------------------------------------------------------------------

/** The Settings singleton. Fetched on entering the route like every other
 *  route-driven read, and never cached across a navigation: a save elsewhere
 *  moves `updatedAt`, and a page whose stamp is older than the row behind it is
 *  claiming something untrue. */
export const FetchSettingsCmd = Command.define('FetchSettings', {
  messages: [Message.SucceededGetSettings, Message.FailedGetSettings],
  execute: Effect.map(rpcAdmin<Settings>('GetSettings', {}), (settings) =>
    Message.SucceededGetSettings({ settings }),
  ).pipe(Effect.catch(() => Effect.succeed(Message.FailedGetSettings({})))),
})

/** One save is one call over the whole row. The answer is the stored row, so
 *  the draft the page keeps afterwards is what the database holds rather than
 *  what the operator typed. */
export const SaveSettingsCmd = Command.define('SaveSettings', {
  args: { input: SettingsInput },
  messages: [Message.SavedSettings, Message.FailedRpc],
  execute: ({ input }) =>
    Effect.map(rpcAdmin<Settings>('UpdateSettings', input), (settings) =>
      Message.SavedSettings({ settings }),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

/** The Storage block's CSV index. The rows are the API's, the document is the
 *  browser's, and the download is a browser fact the Model never has to hold —
 *  so a 400-row index costs one message with a count rather than 400 rows of
 *  state. */
export const ExportCsvIndexCmd = Command.define('ExportCsvIndex', {
  messages: [Message.ExportedCsvIndex, Message.FailedExportCsvIndex],
  execute: Effect.gen(function* () {
    const { items } = yield* rpcAdmin<{ items: ReadonlyArray<PhotoIndexRow> }>('ListPhotoIndex', {})
    yield* Effect.sync(() => downloadCsv(CSV_INDEX_FILENAME, csvIndex(items)))
    return Message.ExportedCsvIndex({ photos: items.length })
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(Message.FailedExportCsvIndex({ message: error.message })),
    ),
  ),
})

// ---------------------------------------------------------------------------
// navigation
// ---------------------------------------------------------------------------

/** Move the URL bar in-app. The runtime then reports the new URL back as
 *  `ChangedUrl`, which is where the route is parsed. */
export const NavigateCmd = Command.define('Navigate', {
  args: { url: S.String },
  messages: [Message.CompletedNavigate],
  execute: ({ url }) => pushUrl(url).pipe(Effect.as(Message.CompletedNavigate())),
})

/** Move the URL bar in place without adding a history entry. The runtime then
 *  reports the new URL back as `ChangedUrl`, exactly as `pushUrl` does, so the
 *  one route table parses both. Used by a view toggle: the back button must not
 *  walk through every mode the operator clicked through (#26's rule). */
export const ReplaceUrlCmd = Command.define('ReplaceUrl', {
  args: { url: S.String },
  messages: [Message.CompletedNavigate],
  execute: ({ url }) => replaceUrl(url).pipe(Effect.as(Message.CompletedNavigate())),
})

/** Step one entry back in the same-document history. The Editor's leave guard
 *  needs this: a popstate has already moved the URL bar, and the operator's
 *  Back press is undone by going back, not by writing the Editor's URL into
 *  the bar again — which would be a guess about the current origin and would
 *  still leave the entry we came from behind us. */
export const BackCmd = Command.define('Back', {
  messages: [Message.CompletedNavigate],
  execute: back().pipe(Effect.as(Message.CompletedNavigate())),
})

/** A full document navigation — a URL the Admin's routes do not name, which
 *  includes the public Front on this same origin. */
export const LoadCmd = Command.define('Load', {
  args: { href: S.String },
  messages: [Message.CompletedLoad],
  execute: ({ href }) => load(href).pipe(Effect.as(Message.CompletedLoad())),
})

export const DeletePhotoCmd = Command.define('DeletePhoto', {
  args: { id: S.String, page: PageArgs },
  messages: [Message.DeletedPhoto, Message.FailedRpc],
  execute: ({ id, page }) =>
    Effect.map(Effect.andThen(rpcAdmin('DeletePhoto', { id }), listPayload(page)), (fresh) =>
      Message.DeletedPhoto({ id, ...toLibraryPage(fresh) }),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

export const DeleteTagCmd = Command.define('DeleteTag', {
  args: { id: S.String, page: PageArgs },
  messages: [Message.DeletedTag, Message.FailedRpc],
  execute: ({ id, page }) =>
    Effect.map(
      Effect.andThen(
        rpcAdmin('DeleteTag', { id }),
        // Refetch both sides: cards would otherwise keep showing the deleted
        // tag until the next full reload. The surviving filter rides along so
        // a filtered view stays filtered after the delete.
        Effect.all({
          tags: rpcPublic<ReadonlyArray<Tag>>('ListTags', {}),
          page: listPayload(page),
        }),
      ),
      ({ tags, page: fresh }) => Message.DeletedTag({ tags: [...tags], ...toLibraryPage(fresh) }),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

export const CreateTagCmd = Command.define('CreateTag', {
  args: { source: S.Literals(['upload', 'sidebar']), label: S.String },
  messages: [Message.SucceededCreateTag, Message.FailedRpc],
  execute: ({ source, label }) =>
    Effect.map(rpcAdmin<Tag>('CreateTag', { slug: label, label }), (tag) =>
      Message.SucceededCreateTag({ source, tag }),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})
