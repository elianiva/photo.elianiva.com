/**
 * Gallery update core: message → (model, commands) transition plus init.
 * RPC commands live in `commands.ts`.
 */

import { Runtime, Update } from 'foldkit'

import { FetchMoreCmd, FetchPhotosCmd } from './commands'
import { Flags, Message } from './model'
import type { Model } from './model'

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export const init: Runtime.ApplicationInit<Model, Message, Flags> = (flags) => {
  if (flags !== undefined) {
    const photos = [...flags.photos]
    const needsFetch = photos.length === 0
    const model = {
      status: needsFetch ? 'loading' : 'ready',
      photos,
      nextCursor: flags.nextCursor ?? null,
      loadingMore: false,
      error: undefined,
      selectedId: null,
    }
    return needsFetch ? { model, commands: [FetchPhotosCmd()] } : { model }
  }
  return {
    model: {
      status: 'loading',
      photos: [],
      nextCursor: null,
      loadingMore: false,
      error: undefined,
      selectedId: null,
    },
    commands: [FetchPhotosCmd()],
  }
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    FetchPhotos: () => ({ model: { ...model, status: 'loading' }, commands: [FetchPhotosCmd()] }),
    SucceededFetchPhotos: ({ photos, nextCursor }) => ({
      model: {
        ...model,
        status: 'ready',
        photos,
        nextCursor: nextCursor ?? null,
        loadingMore: false,
        error: undefined,
      },
    }),
    SucceededFetchMore: ({ photos, nextCursor }) => ({
      model: {
        ...model,
        photos: [...model.photos, ...photos],
        nextCursor: nextCursor ?? null,
        loadingMore: false,
      },
    }),
    LoadMore: () => {
      if (model.nextCursor === null || model.loadingMore) return { model }
      return {
        model: { ...model, loadingMore: true },
        commands: [FetchMoreCmd({ cursor: model.nextCursor })],
      }
    },
    FailedFetchPhotos: ({ message }) => ({
      model: { ...model, status: 'error', error: message, loadingMore: false },
    }),
    ClickedPhoto: ({ id }) => ({ model: { ...model, selectedId: id } }),
    CloseLightbox: () => ({ model: { ...model, selectedId: null } }),
  })
