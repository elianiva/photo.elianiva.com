import { Schema as S } from 'effect'

// ---------------------------------------------------------------------------
// Photo — curated work (see CONTEXT.md). Flat list, tags, JSON metadata.
// ---------------------------------------------------------------------------

export const PhotoId = S.String.pipe(S.brand('PhotoId'))
export type PhotoId = typeof PhotoId.Type

// ---------------------------------------------------------------------------
// Status — where a Photo sits in the publish lifecycle (CONTEXT.md).
// `scheduled` is deliberately not a value: it is a display label over a draft
// with a publish time, and nothing in the schema records one.
// ---------------------------------------------------------------------------

export const PHOTO_STATUSES = ['draft', 'published', 'failed'] as const

export const PhotoStatus = S.Literals(PHOTO_STATUSES)
export type PhotoStatus = typeof PhotoStatus.Type

// ---------------------------------------------------------------------------
// Ratio — a Photo's frame proportion, one of six (CONTEXT.md). In display
// order, which is the order the Filter Bar's ratio segment draws them in.
// ---------------------------------------------------------------------------

export const PHOTO_RATIOS = ['3:2', '2:3', '4:3', '3:4', '16:9', '9:16'] as const

export const PhotoRatio = S.Literals(PHOTO_RATIOS)
export type PhotoRatio = typeof PhotoRatio.Type

/** The six as reduced fractions — what a measured frame is compared against. */
const RATIO_FRACTIONS: Record<PhotoRatio, readonly [number, number]> = {
  '3:2': [3, 2],
  '2:3': [2, 3],
  '4:3': [4, 3],
  '3:4': [3, 4],
  '16:9': [16, 9],
  '9:16': [9, 16],
}

/**
 * How far a measured frame may sit from a supported Ratio and still snap to it.
 * Migration 0004 spells the same number into the backfill's SQL `CASE`; a test
 * runs both rules over one table of frames so neither can move alone.
 */
export const RATIO_SNAP_TOLERANCE = 0.02

/**
 * The supported Ratio nearest a measured frame, or `null` when none is within
 * `RATIO_SNAP_TOLERANCE` — a square frame matches nothing, and the author picks
 * its Ratio in the Editor rather than have an upload invent one.
 *
 * Pure and exported: the upload path validates against it, `create` snaps the
 * stored `ratio` with it, and the Editor displays with it.
 */
export const nearestRatio = (width: number, height: number): PhotoRatio | null => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  const measured = width / height
  let nearest: PhotoRatio | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const ratio of PHOTO_RATIOS) {
    const [numerator, denominator] = RATIO_FRACTIONS[ratio]
    const distance = Math.abs(measured - numerator / denominator)
    if (distance < nearestDistance) {
      nearest = ratio
      nearestDistance = distance
    }
  }
  return nearestDistance <= RATIO_SNAP_TOLERANCE ? nearest : null
}

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
  /** Where the Photo sits in the publish lifecycle. */
  status: S.optional(PhotoStatus),
  /** Its site-wide serial. Absent on a row the backfill has not numbered yet. */
  number: S.optional(S.NullOr(S.Number)),
  /** Snapped at upload; absent until an upload or the Editor sets one. */
  ratio: S.optional(S.NullOr(PhotoRatio)),
  /** Size of the original in bytes. Null for a row uploaded before `bytes`. */
  bytes: S.optional(S.NullOr(S.Number)),
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
  status: PhotoStatus,
  number: S.NullOr(S.Number),
  ratio: S.NullOr(PhotoRatio),
  bytes: S.NullOr(S.Number),
  takenAt: S.NullOr(S.String),
  aperture: S.NullOr(S.Number),
  shutter: S.NullOr(S.Number),
  iso: S.NullOr(S.Number),
  focalLength: S.NullOr(S.Number),
  metadata: S.String,
  blurhash: S.NullOr(S.String),
  /** `YYYY-MM-DD`. Non-null on a trashed Photo; no read path returns one. */
  deletedAt: S.NullOr(S.String),
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
