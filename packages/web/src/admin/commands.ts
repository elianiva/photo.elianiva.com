/**
 * Admin commands — the RPC seam (ADR 0003). Every side-effecting operation
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
import { PhotoId, PhotoMetadata, PhotoPresentation, SettingsInput } from '@photo/shared'
import { LibrarySort, PhotoRatio, PhotoStatus } from '@photo/shared'
import type { PhotoIndexRow, PhotoWithTags, Settings, Tag } from '@photo/shared'

import { RpcFailure, rpcAdmin, rpcPublic } from '@/lib/rpc'

import { CSV_INDEX_FILENAME, csvIndex, downloadCsv } from './storage-index'
import { exifPatchOfDetails } from './editor'
import { librarySortOf } from './route'
import type { LibraryFilters } from './route'
import { ImagePipeline } from '@/lib/pipeline/service'
import {
  BULK_BORDER_MAT,
  DownloadFormat,
  DownloadFrame,
  GridCols,
  LIBRARY_PAGE_SIZE,
  Message,
  PhotoDetails,
} from './model'
import type { Counts as CountsType, LibraryPage } from './model'
import { GridPrefs, GridPrefsLive } from './prefs'
import { Theme, writeAdminTheme } from '@/lib/theme'

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
    q: filters.q,
    ...(filters.sort === 'newest' ? {} : { sort: librarySortOf(filters.sort) }),
  }
}

/** Where the table is reading: its filter, and the keyset position of the page.
 *  The empty string is the first page, which is the only page with no cursor.
 *
 *  The three optional keys are the Filter Bar's: Status, Ratio and Sort are
 *  omitted when they are the default, so an unfiltered read asks for exactly
 *  what it asked for before they existed. */
const photoListFields = {
  status: S.optional(PhotoStatus),
  ratio: S.optional(PhotoRatio),
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
  q: string
  cursor?: string | undefined
  status?: PhotoStatus | undefined
  ratio?: PhotoRatio | undefined
  sort?: typeof LibrarySort.Type | undefined
}) =>
  rpcAdmin<PhotoPage>('ListLibraryRows', {
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
// Status moved, so the sidebar's numbers moved too.
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
 *  Tag page (ADR 0006), so the grouping entity is the Tag. */
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

/** The grid's column count, persisted across sessions.
 *
 *  The read lives in `./prefs` as a synchronous function because Foldkit's
 *  `init` is synchronous by contract; the write is a command, so it goes through
 *  the `GridPrefs` service and the `KeyValueStore` under it. Both paths share one
 *  decode, so they cannot disagree about what a valid column count is. */
export const PersistColsCmd = Command.define('PersistCols', {
  args: { cols: GridCols },
  messages: [Message.CompletedPersistCols],
  execute: ({ cols }) =>
    GridPrefs.use((prefs) => prefs.setCols(cols)).pipe(
      // Provided here rather than by an app layer: the Admin's runtime is built
      // by Foldkit with no layer stack, and every other command closes over what
      // it needs the same way. The store is a layer over the platform's
      // `Storage`, so this is a lookup rather than a reimplementation.
      Effect.provide(GridPrefsLive),
      Effect.as(Message.CompletedPersistCols()),
      // A preference that cannot be remembered is not something the operator can
      // act on, so a failing store still completes the command and the grid
      // keeps the columns it was just given.
      Effect.catch(() => Effect.succeed(Message.CompletedPersistCols())),
    ),
})

/** The Desk's theme, persisted across sessions. A storage that cannot be
 *  written still completes the command: the theme the operator just chose
 *  stays on screen. */
export const PersistThemeCmd = Command.define('PersistTheme', {
  args: { theme: Theme },
  messages: [Message.CompletedPersistTheme],
  execute: ({ theme }) =>
    Effect.sync(() => writeAdminTheme(theme)).pipe(Effect.as(Message.CompletedPersistTheme())),
})

/** The Admin's Photo list. It carries the Page Head's search as `q`, omitted
 *  when empty, so "no filter" is the absence of a filter rather than an empty
 *  one.
 *
 *  `cursor` is the keyset position of the page being read. The empty string is
 *  the first page, which is the only page with no cursor. */
export const FetchPhotosCmd = Command.define('FetchPhotos', {
  args: photoListFields,
  messages: [Message.SucceededFetchPhotos, Message.FailedRpc],
  execute: ({ q, cursor, status, ratio, sort }) =>
    Effect.map(
      listPayload({ q, ...(cursor === undefined ? {} : { cursor }), status, ratio, sort }),
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
    /** The client's re-encoded Blurhash, present only when it differs from the
     *  stored row's. A Photo column, so it rides `UpdatePhoto`; the composition
     *  is what it describes, so a save that rewrote the crop carries it. */
    blurhash: S.optional(S.String),
    savePresentation: S.Boolean,
    /** The `DETAILS` record, present only when it moved. Its `location` rides
     *  in `metadata`, because `UpdatePhoto` replaces the whole blob. */
    details: S.optional(PhotoDetails),
    metadata: S.optional(PhotoMetadata),
  },
  messages: [Message.UpdatedEditor, Message.FailedRpc],
  execute: ({ id, presentation, ratio, blurhash, savePresentation, details, metadata }) =>
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
      // The Ratio, the Blurhash and the `DETAILS` record are all columns on
      // `photos`, so one `UpdatePhoto` carries whichever of them moved — and
      // the answer is the whole stored row, which is what the Editor's
      // snapshots become.
      const writesPhoto = ratio !== undefined || blurhash !== undefined || details !== undefined
      const photo = writesPhoto
        ? yield* rpcAdmin<PhotoWithTags>('UpdatePhoto', {
            id,
            ...(ratio === undefined ? {} : { ratio }),
            ...(blurhash === undefined ? {} : { blurhash }),
            ...(details === undefined
              ? {}
              : {
                  title: details.title,
                  slug: details.slug,
                  takenAt: details.takenAt,
                  ...exifPatchOfDetails(details),
                  ...(metadata === undefined ? {} : { metadata }),
                }),
          })
        : undefined
      return Message.UpdatedEditor({
        id: PhotoId.make(id),
        presentation: stored,
        ...(photo === undefined ? {} : { photo }),
      })
    }).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

/** The `DETAILS` tab's Status group. It is its own call rather than part of the
 *  save because a Status is a lifecycle move (`SetPhotoStatus`), not a field on
 *  `UpdatePhoto`, and it takes effect at once. The answer is the whole Photo,
 *  so the Top Bar's chip and the group's selection are the stored value rather
 *  than an optimistic guess. */
export const SetEditorStatusCmd = Command.define('SetEditorStatus', {
  args: { id: S.String, status: PhotoStatus },
  messages: [Message.SucceededSetEditorStatus, Message.FailedSetEditorStatus],
  execute: ({ id, status }) =>
    Effect.map(rpcAdmin<PhotoWithTags>('SetPhotoStatus', { id, status }), (photo) =>
      Message.SucceededSetEditorStatus({ id: PhotoId.make(id), photo }),
    ).pipe(Effect.catch(() => Effect.succeed(Message.FailedSetEditorStatus({})))),
})

// ---------------------------------------------------------------------------
// the Download panel
// ---------------------------------------------------------------------------

/** The download could not be made: the original was unreachable, or the
 *  pipeline failed. Either way the toast prints the message. */
class DownloadFailed extends S.TaggedError<DownloadFailed>()('DownloadFailed', {
  message: S.String,
}) {}

const saveBlob = (blob: Blob, filename: string): Effect.Effect<void> =>
  Effect.acquireUseRelease(
    Effect.sync(() => URL.createObjectURL(blob)),
    (href) =>
      Effect.sync(() => {
        const anchor = document.createElement('a')
        anchor.href = href
        anchor.download = filename
        document.body.append(anchor)
        anchor.click()
        anchor.remove()
      }).pipe(
        // The browser starts the save asynchronously; revoking at once would
        // cancel it.
        Effect.andThen(Effect.sleep('10 seconds')),
      ),
    (href) => Effect.sync(() => URL.revokeObjectURL(href)),
  )

const fetchOriginal = (url: string): Effect.Effect<Blob, DownloadFailed> =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, { credentials: 'include', signal })
      if (!response.ok) throw new Error(`status ${String(response.status)}`)
      return response.blob()
    },
    catch: (cause) =>
      new DownloadFailed({
        message: `Could not fetch the original (${cause instanceof Error ? cause.message : 'network'})`,
      }),
  })

const downloadPhoto = Effect.fn('admin.downloadPhoto')(function* (input: {
  readonly url: string
  readonly name: string
  readonly format: DownloadFormat
  readonly width: number
  readonly quality: number
  readonly frame: DownloadFrame
  readonly borderPercent: number
}) {
  const pipeline = yield* ImagePipeline
  const original = yield* fetchOriginal(input.url)
  if (input.format === 'original') {
    return yield* Effect.forkDetach(saveBlob(original, `${input.name}.jpg`))
  }
  const out = yield* pipeline
    .export(original, {
      format: input.format,
      width:
        input.width > 0
          ? input.width
          : (yield* Effect.promise(() => createImageBitmap(original))).width,
      quality: input.quality,
      frame: input.frame,
      borderPercent: input.borderPercent,
      method: 'lanczos3',
      background: '#ffffff',
      borderColor: '#ffffff',
    })
    .pipe(Effect.mapError((error) => new DownloadFailed({ message: error.message })))
  return yield* Effect.forkDetach(
    saveBlob(out.blob, `${input.name}-${String(out.width)}.${out.extension}`),
  )
})

/** Fetch the stored original and save it, as it is or re-encoded. Everything
 *  past the fetch runs in this tab (the pipeline's Web Workers), so a download
 *  costs the server one object read and nothing more. The save is forked: the
 *  Message answers when the file is made, not when the browser has finished
 *  writing it. */
export const DownloadPhotoCmd = Command.define('DownloadPhoto', {
  args: {
    url: S.String,
    name: S.String,
    format: DownloadFormat,
    width: S.Number,
    quality: S.Number,
    frame: DownloadFrame,
    borderPercent: S.Number,
  },
  messages: [Message.SucceededDownload, Message.FailedDownload],
  execute: ({ url, name, format, width, quality, frame, borderPercent }) =>
    downloadPhoto({ url, name, format, width, quality, frame, borderPercent }).pipe(
      Effect.map(() => Message.SucceededDownload()),
      Effect.catch((error) => Effect.succeed(Message.FailedDownload({ message: error.message }))),
      Effect.provide(ImagePipeline.layer),
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
 *  includes the public Home page on this same origin. */
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

export const CreateTagCmd = Command.define('CreateTag', {
  args: { label: S.String },
  messages: [Message.SucceededCreateTag, Message.FailedRpc],
  execute: ({ label }) =>
    Effect.map(rpcAdmin<Tag>('CreateTag', { slug: label, label }), (tag) =>
      Message.SucceededCreateTag({ tag }),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})
