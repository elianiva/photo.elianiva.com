import { Schema as S } from 'effect'
import { PhotoWithTags, Tag } from './photo'

export const HelloResponse = S.Struct({
  message: S.String,
})
export type HelloResponse = typeof HelloResponse.Type

export class ApiError extends S.TaggedError<ApiError>()('ApiError', {
  message: S.String,
  cause: S.optional(S.Unknown),
}) {}

// Photos
export const ListPhotosResponse = S.Array(PhotoWithTags)
export type ListPhotosResponse = typeof ListPhotosResponse.Type

export const CreatePhotoRequest = S.Struct({
  title: S.String,
  slug: S.optional(S.String),
  takenAt: S.optional(S.String),
  metadata: S.optional(
    S.Struct({
      caption: S.optional(S.String),
      location: S.optional(S.String),
      camera: S.optional(S.String),
      lens: S.optional(S.String),
    }),
  ),
  tagIds: S.optional(S.Array(S.String)),
})
export type CreatePhotoRequest = typeof CreatePhotoRequest.Type

export const UpdatePhotoRequest = S.Struct({
  title: S.optional(S.String),
  slug: S.optional(S.String),
  takenAt: S.optional(S.String),
  metadata: S.optional(
    S.Struct({
      caption: S.optional(S.String),
      location: S.optional(S.String),
      camera: S.optional(S.String),
      lens: S.optional(S.String),
    }),
  ),
  tagIds: S.optional(S.Array(S.String)),
})
export type UpdatePhotoRequest = typeof UpdatePhotoRequest.Type

// Tags
export const ListTagsResponse = S.Array(Tag)
export type ListTagsResponse = typeof ListTagsResponse.Type

export const CreateTagRequest = S.Struct({
  slug: S.String,
  label: S.String,
})
export type CreateTagRequest = typeof CreateTagRequest.Type

export const UpdateTagRequest = S.Struct({
  slug: S.optional(S.String),
  label: S.optional(S.String),
})
export type UpdateTagRequest = typeof UpdateTagRequest.Type
