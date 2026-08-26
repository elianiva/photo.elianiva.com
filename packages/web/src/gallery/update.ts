/**
 * Gallery update core: message → (model, commands) transition plus init.
 * RPC commands live in `commands.ts`.
 */

import { Command, Runtime } from 'foldkit'

import { FetchMoreCmd, FetchPhotosCmd } from './commands'
import { Message } from './model'
import type { Model } from './model'

type UpdateReturn = readonly [Model, ReadonlyArray<Command.Command<Message>>]

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export const init: Runtime.ApplicationInit<Model, Message> = () => [
  {
    status: 'loading',
    photos: [],
    nextCursor: null,
    loadingMore: false,
    error: undefined,
    selectedId: null,
  },
  [FetchPhotosCmd()],
]

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    FetchPhotos: () => [{ ...model, status: 'loading' }, [FetchPhotosCmd()]],
    SucceededFetchPhotos: ({ photos, nextCursor }) => [
      {
        ...model,
        status: 'ready',
        photos,
        nextCursor: nextCursor ?? null,
        loadingMore: false,
        error: undefined,
      },
      [],
    ],
    SucceededFetchMore: ({ photos, nextCursor }) => [
      {
        ...model,
        photos: [...model.photos, ...photos],
        nextCursor: nextCursor ?? null,
        loadingMore: false,
      },
      [],
    ],
    LoadMore: () => {
      if (model.nextCursor === null || model.loadingMore) return [model, []]
      return [{ ...model, loadingMore: true }, [FetchMoreCmd({ cursor: model.nextCursor })]]
    },
    FailedFetchPhotos: ({ message }) => [
      { ...model, status: 'error', error: message, loadingMore: false },
      [],
    ],
    ClickedPhoto: ({ id }) => [{ ...model, selectedId: id }, []],
    CloseLightbox: () => [{ ...model, selectedId: null }, []],
  })
