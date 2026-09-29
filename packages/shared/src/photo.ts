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
  /** The sentence under the name on a public Series row. Null for a Tag whose
   *  caption has never been written — not an empty string. */
  caption: S.NullOr(S.String),
})
export type Tag = typeof Tag.Type

export const PhotoMetadata = S.Struct({
  caption: S.optional(S.String.pipe(S.check(S.isMaxLength(500)))),
  location: S.optional(S.String.pipe(S.check(S.isMaxLength(200)))),
  camera: S.optional(S.String.pipe(S.check(S.isMaxLength(200)))),
  lens: S.optional(S.String.pipe(S.check(S.isMaxLength(200)))),
})
export type PhotoMetadata = typeof PhotoMetadata.Type

/** The four EXIF facts the public Exif line prints. Nullable columns, not
 *  blob entries: a formatted number is checkable at the boundary. A Photo
 *  without one omits the segment rather than inventing a value. */
const ExifColumn = S.optional(S.NullOr(S.Number))

export const PhotoWithTags = S.Struct({
  id: PhotoId,
  slug: S.String,
  title: S.String,
  r2Key: S.String,
  width: S.Number,
  height: S.Number,
  takenAt: S.optional(S.String),
  aperture: ExifColumn,
  shutter: ExifColumn,
  iso: ExifColumn,
  focalLength: ExifColumn,
  metadata: S.optional(PhotoMetadata),
  /** Client-decoded placeholder source. Absent for Photos uploaded before
   *  blurhash existed — views fall back to a plain background. */
  blurhash: S.optional(S.NullOr(S.String)),
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
  aperture: S.NullOr(S.Number),
  shutter: S.NullOr(S.Number),
  iso: S.NullOr(S.Number),
  focalLength: S.NullOr(S.Number),
  metadata: S.String,
  blurhash: S.NullOr(S.String),
})
export type DbPhotoRow = typeof DbPhotoRow.Type

export const DbTagRow = S.Struct({
  id: TagId,
  slug: S.String,
  label: S.String,
  caption: S.NullOr(S.String),
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
