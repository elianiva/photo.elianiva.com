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
import { load, pushUrl } from 'foldkit/navigation'
import { PhotoId } from '@photo/shared'
import type { PhotoIndexRow, PhotoWithTags, Settings, Tag } from '@photo/shared'
import { SettingsInput } from '@photo/shared'

import { apiUrl } from '@/lib/api'
import { RpcFailure, rpcAdmin, rpcPublic } from '@/lib/rpc'
import { encodeBlurhash } from '@/lib/blurhash'

import { CSV_INDEX_FILENAME, csvIndex, downloadCsv } from './storage-index'
import {
  BULK_BORDER_MAT,
  DraftFields,
  GridCols,
  LIBRARY_PAGE_SIZE,
  Message,
  Storage,
  abortStore,
  fileStore,
} from './model'
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

/** Where the table is reading: its filter, and the keyset position of the page.
 *  The empty string is the first page, which is the only page with no cursor. */
export const PageArgs = S.Struct({
  tagIds: S.Array(S.String),
  q: S.String,
  cursor: S.String,
})
export type PageArgs = typeof PageArgs.Type

/** One `ListLibraryRows` read. Every list read in the Admin goes through here,
 *  so a page of rows and the number it is paged over are never fetched under
 *  two different filters. */
const listPayload = (args: { tagIds: readonly string[]; q: string; cursor?: string }) =>
  rpcAdmin<PhotoPage>('ListLibraryRows', {
    ...(args.tagIds.length > 0 ? { tagIds: [...args.tagIds] } : {}),
    ...(args.q === '' ? {} : { q: args.q }),
    ...(args.cursor === '' ? {} : { cursor: args.cursor }),
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

export const COLS_STORAGE_KEY = 'photo-admin:cols'
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
  args: { tagIds: S.Array(S.String), q: S.String, cursor: S.optional(S.String) },
  messages: [Message.SucceededFetchPhotos, Message.FailedRpc],
  execute: ({ tagIds, q, cursor }) =>
    Effect.map(listPayload({ tagIds, q, ...(cursor === undefined ? {} : { cursor }) }), (page) =>
      Message.SucceededFetchPhotos(toLibraryPage(page)),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

export const FetchMoreCmd = Command.define('FetchMore', {
  args: { tagIds: S.Array(S.String), q: S.String, cursor: S.String },
  messages: [Message.SucceededFetchMore, Message.FailedRpc],
  execute: ({ tagIds, q, cursor }) =>
    Effect.map(listPayload({ tagIds, q, cursor }), (page) =>
      Message.SucceededFetchMore({ photos: [...page.items], nextCursor: page.nextCursor }),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
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

/** A full document navigation — a URL the Admin's routes do not name, which
 *  includes the public Front on this same origin. */
export const LoadCmd = Command.define('Load', {
  args: { href: S.String },
  messages: [Message.CompletedLoad],
  execute: ({ href }) => load(href).pipe(Effect.as(Message.CompletedLoad())),
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
      const page = yield* rpcAdmin<PhotoPage>('ListLibraryRows', { limit: 60 })
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
        rpcAdmin<PhotoPage>('ListLibraryRows', { limit: 60 }),
      ),
      (page) => Message.DeletedPhoto({ id, photos: [...page.items] }),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

export const DeleteTagCmd = Command.define('DeleteTag', {
  args: { id: S.String, tagIds: S.Array(S.String) },
  messages: [Message.DeletedTag, Message.FailedRpc],
  execute: ({ id, tagIds }) =>
    Effect.map(
      Effect.andThen(
        rpcAdmin('DeleteTag', { id }),
        // Refetch both sides: cards would otherwise keep showing the deleted
        // tag until the next full reload. The surviving filter rides along so
        // a filtered view stays filtered after the delete.
        Effect.all({
          tags: rpcPublic<ReadonlyArray<Tag>>('ListTags', {}),
          page: rpcAdmin<PhotoPage>('ListLibraryRows', {
            ...(tagIds.length > 0 ? { tagIds: [...tagIds] } : {}),
            limit: 60,
          }),
        }),
      ),
      ({ tags, page }) => Message.DeletedTag({ tags: [...tags], photos: [...page.items] }),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

export const CreateTagCmd = Command.define('CreateTag', {
  args: { source: S.Literals(['draft', 'upload', 'manager', 'sidebar']), label: S.String },
  messages: [Message.SucceededCreateTag, Message.FailedRpc],
  execute: ({ source, label }) =>
    Effect.map(rpcAdmin<Tag>('CreateTag', { slug: label, label }), (tag) =>
      Message.SucceededCreateTag({ source, tag }),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

/** One queue item per command run; `update` chains the next pending item.
 *  Batch-wide tag/takenAt choices ride along as args so the execute closure
 *  needs no access to the Model. The request rides an AbortController stored
 *  in `abortStore` so `CancelUploads` can kill the in-flight fetch. */
export const UploadItemCmd = Command.define('UploadItem', {
  args: { itemId: S.String, tagIds: S.Array(S.String), takenAt: S.String },
  messages: [Message.SucceededUploadItem, Message.FailedUploadItem],
  execute: ({ itemId, tagIds, takenAt }) =>
    Effect.gen(function* () {
      const file = fileStore.get(itemId)
      if (file === undefined) {
        return Message.FailedUploadItem({ itemId, message: 'uploaded bytes are gone' })
      }
      // Placeholder hash is computed here because only the browser can decode
      // pixels — the Worker never sees a decodable image.
      const blurhash = yield* Effect.promise(() => encodeBlurhash(file))
      const controller = new AbortController()
      abortStore.set(itemId, controller)
      const form = new FormData()
      form.set('file', file)
      form.set('title', file.name.replace(/\.[^/.]+$/, ''))
      form.set('tagIds', JSON.stringify([...tagIds]))
      if (blurhash !== undefined) form.set('blurhash', blurhash)
      if (takenAt !== '') form.set('takenAt', takenAt)
      // The foldkit-provided signal is superseded by the cancellable
      // controller — `CancelUploads` must be able to reach this request
      // without tearing down the whole command runner.
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(apiUrl('/upload'), {
            method: 'POST',
            body: form,
            credentials: 'include',
            signal: controller.signal,
          }),
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
      // Unregister on every exit path (success, failure, abort).
      Effect.ensuring(Effect.sync(() => abortStore.delete(itemId))),
    ),
})
