/**
 * Gallery commands — the RPC seam (ADR 0006). Side-effecting operations of
 * the public showcase report back through Message variants.
 */

import { Effect, Schema as S } from 'effect'
import { Command } from 'foldkit'
import type { PhotoWithTags } from '@photo/shared'

import { rpcPublic } from '@/lib/rpc'

import { Message } from './model'

interface PhotoPage {
  readonly items: ReadonlyArray<PhotoWithTags>
  readonly nextCursor: string | null
}

export const FetchPhotosCmd = Command.define('FetchPhotos', {
  messages: [Message.SucceededFetchPhotos, Message.FailedFetchPhotos],
  execute: Effect.map(rpcPublic<PhotoPage>('ListPhotos', { limit: 60 }), (page) =>
    Message.SucceededFetchPhotos({ photos: [...page.items], nextCursor: page.nextCursor }),
  ).pipe(
    Effect.catch((error) => Effect.succeed(Message.FailedFetchPhotos({ message: error.message }))),
  ),
})

export const FetchMoreCmd = Command.define('FetchMore', {
  args: { cursor: S.String },
  messages: [Message.SucceededFetchMore, Message.FailedFetchPhotos],
  execute: ({ cursor }) =>
    Effect.map(rpcPublic<PhotoPage>('ListPhotos', { limit: 60, cursor }), (page) =>
      Message.SucceededFetchMore({ photos: [...page.items], nextCursor: page.nextCursor }),
    ).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.FailedFetchPhotos({ message: error.message })),
      ),
    ),
})
