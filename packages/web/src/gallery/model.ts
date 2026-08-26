/**
 * Gallery Model + Message (the TEA core). See CONTEXT.md — this surface is
 * the public showcase: a flat, curated list of Photos for visitors.
 */

import { Schema as S } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { PhotoWithTags } from '@photo/shared'

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const Model = S.Struct({
  photos: S.Array(PhotoWithTags),
  nextCursor: S.NullOr(S.String),
  loadingMore: S.Boolean,
  status: S.String,
  error: S.optional(S.String),
  /** Photo shown in the lightbox; null while browsing the grid. */
  selectedId: S.NullOr(S.String),
})
export type Model = typeof Model.Type

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export const Message = defineMessageUnion({
  FetchPhotos: {},
  SucceededFetchPhotos: {
    photos: S.Array(PhotoWithTags),
    nextCursor: S.NullOr(S.String),
  },
  SucceededFetchMore: {
    photos: S.Array(PhotoWithTags),
    nextCursor: S.NullOr(S.String),
  },
  LoadMore: {},
  FailedFetchPhotos: {
    message: S.String,
  },
  ClickedPhoto: {
    id: S.String,
  },
  CloseLightbox: {},
})
export type Message = typeof Message.Type
