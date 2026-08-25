import { Schema as S } from 'effect'

// ---------------------------------------------------------------------------
// Photo — curated work (see CONTEXT.md). Flat list, tags, JSON metadata.
// ---------------------------------------------------------------------------

export const PhotoId = S.String.pipe(S.brand('PhotoId'))
export type PhotoId = typeof PhotoId.Type

export const TagId = S.String.pipe(S.brand('TagId'))
export type TagId = typeof TagId.Type

export const Tag = S.Struct({
  id: TagId,
  slug: S.String,
  label: S.String,
})
export type Tag = typeof Tag.Type

export const PhotoMetadata = S.Struct({
  caption: S.optional(S.String),
  location: S.optional(S.String),
  camera: S.optional(S.String),
  lens: S.optional(S.String),
})
export type PhotoMetadata = typeof PhotoMetadata.Type

export const PhotoWithTags = S.Struct({
  id: PhotoId,
  slug: S.String,
  title: S.String,
  r2Key: S.String,
  width: S.Number,
  height: S.Number,
  takenAt: S.optional(S.String),
  metadata: S.optional(PhotoMetadata),
  tags: S.optional(S.Array(Tag)),
})
export type PhotoWithTags = typeof PhotoWithTags.Type

// D1 row shapes — stored representation (metadata as JSON string, takenAt nullable)
export const DbPhotoRow = S.Struct({
  id: PhotoId,
  slug: S.String,
  title: S.String,
  r2Key: S.String,
  width: S.Number,
  height: S.Number,
  takenAt: S.NullOr(S.String),
  metadata: S.String,
})
export type DbPhotoRow = typeof DbPhotoRow.Type

export const DbTagRow = S.Struct({
  id: TagId,
  slug: S.String,
  label: S.String,
})
export type DbTagRow = typeof DbTagRow.Type

export const D1AllResultPhoto = S.Struct({
  results: S.optional(S.Array(DbPhotoRow)),
})
export type D1AllResultPhoto = typeof D1AllResultPhoto.Type

export const D1AllResultTag = S.Struct({
  results: S.optional(S.Array(DbTagRow)),
})
export type D1AllResultTag = typeof D1AllResultTag.Type
