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
import type { PhotoWithTags, Tag } from '@photo/shared'

import { apiUrl } from '@/lib/api'
import { RpcFailure, rpcAdmin, rpcPublic } from '@/lib/rpc'
import { encodeBlurhash } from '@/lib/blurhash'

import { DraftFields, GridCols, Message, abortStore, fileStore } from './model'
import type { GridCols as GridColsType } from './model'

interface PhotoPage {
  readonly items: ReadonlyArray<PhotoWithTags>
  readonly nextCursor: string | null
}

/** Narrow on purpose: widening this to the whole Message union would leak
 *  every variant into each command's success channel. */
const failWith = (error: RpcFailure) => Message.FailedRpc({ message: error.message })

// ---------------------------------------------------------------------------
// grid density persistence
// ---------------------------------------------------------------------------

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

export const FetchPhotosCmd = Command.define('FetchPhotos', {
  args: { tagIds: S.Array(S.String) },
  messages: [Message.SucceededFetchPhotos, Message.FailedRpc],
  execute: ({ tagIds }) =>
    Effect.map(rpcAdmin<PhotoPage>('ListLibraryRows', { tagIds: [...tagIds], limit: 60 }), (page) =>
      Message.SucceededFetchPhotos({ photos: [...page.items], nextCursor: page.nextCursor }),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

export const FetchMoreCmd = Command.define('FetchMore', {
  args: { tagIds: S.Array(S.String), cursor: S.String },
  messages: [Message.SucceededFetchMore, Message.FailedRpc],
  execute: ({ tagIds, cursor }) =>
    Effect.map(
      rpcAdmin<PhotoPage>('ListLibraryRows', {
        tagIds: [...tagIds],
        limit: 60,
        cursor,
      }),
      (page) =>
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
          page: rpcAdmin<PhotoPage>('ListLibraryRows', { tagIds: [...tagIds], limit: 60 }),
        }),
      ),
      ({ tags, page }) => Message.DeletedTag({ tags: [...tags], photos: [...page.items] }),
    ).pipe(Effect.catch((error) => Effect.succeed(failWith(error)))),
})

export const CreateTagCmd = Command.define('CreateTag', {
  args: { source: S.Literals(['draft', 'upload', 'manager']), label: S.String },
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
