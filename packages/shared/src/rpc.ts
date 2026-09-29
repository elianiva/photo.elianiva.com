import { Schema as S } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import {
  MatColour,
  MatStyle,
  PhotoMetadata,
  PhotoPresentation,
  PhotoRatio,
  PhotoStatus,
  PhotoWithTags,
  RenditionFormat,
  Tag,
  TagId,
} from './photo'

// ---------------------------------------------------------------------------
// Shared domain errors — part of the RPC contract so both sides typecheck
// against the same failure modes. StorageError covers infrastructure
// failures (D1/R2); the others are domain outcomes.
// ---------------------------------------------------------------------------

export class PhotoNotFound extends S.TaggedError<PhotoNotFound>()('PhotoNotFound', {
  id: S.String,
}) {}

export class SlugConflict extends S.TaggedError<SlugConflict>()('SlugConflict', {
  slug: S.String,
}) {}

export class InvalidInput extends S.TaggedError<InvalidInput>()('InvalidInput', {
  message: S.String,
}) {}

export class StorageError extends S.TaggedError<StorageError>()('StorageError', {
  message: S.String,
  /** Wire-safe by contract — attach through `describeCause`, never a raw
   *  error instance (the JSON codec dies on class instances). */
  cause: S.optional(S.String),
}) {}

/** D1/R2 errors are class instances the RPC JSON codec can't serialize;
 *  flatten them into a readable string before attaching to a StorageError. */
export const describeCause = (cause: unknown): string => {
  if (typeof cause === 'string') return cause
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`
  try {
    return JSON.stringify(cause) ?? String(cause)
  } catch (parseError) {
    void parseError
    return String(cause)
  }
}

// ---------------------------------------------------------------------------
// Public reads — the gallery and the Admin grid both consume these.
// ---------------------------------------------------------------------------

export class ListPhotos extends Rpc.make('ListPhotos', {
  payload: {
    tagSlug: S.optional(S.String.pipe(S.check(S.isMaxLength(120)))),
    q: S.optional(S.String.pipe(S.check(S.isMaxLength(120)))),
    limit: S.optional(S.Number),
    cursor: S.optional(S.String.pipe(S.check(S.isMaxLength(512)))),
  },
  success: S.Struct({
    items: S.Array(PhotoWithTags),
    nextCursor: S.NullOr(S.String),
  }),
  error: S.Union([InvalidInput, StorageError]),
}) {}

export class GetPhoto extends Rpc.make('GetPhoto', {
  payload: { id: S.String },
  success: PhotoWithTags,
  error: S.Union([PhotoNotFound, StorageError]),
}) {}

export class ListTags extends Rpc.make('ListTags', {
  // Explicit empty payload: schema-less RPCs expect `null` on the wire, and
  // callers pass `{}`.
  payload: {},
  success: S.Array(Tag),
  error: StorageError,
}) {}

export const PhotoPublicRpcs = RpcGroup.make(ListPhotos, GetPhoto, ListTags)

// ---------------------------------------------------------------------------
// Admin writes — edge-gated (Access on photo-api /admin/*) + JWT-verified in-worker
// (ADR 0007).
// ---------------------------------------------------------------------------

export class UpdatePhoto extends Rpc.make('UpdatePhoto', {
  payload: {
    id: S.String.pipe(S.check(S.isMaxLength(128))),
    title: S.optional(S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200)))),
    slug: S.optional(S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200)))),
    takenAt: S.optional(S.String.pipe(S.check(S.isMaxLength(64)))),
    metadata: S.optional(PhotoMetadata),
    tagIds: S.optional(
      S.Array(S.String.pipe(S.check(S.isMaxLength(128)))).pipe(S.check(S.isMaxLength(32))),
    ),
  },
  success: PhotoWithTags,
  error: S.Union([PhotoNotFound, SlugConflict, InvalidInput, StorageError]),
}) {}

export class DeletePhoto extends Rpc.make('DeletePhoto', {
  payload: { id: S.String },
  success: S.Boolean,
  error: S.Union([PhotoNotFound, StorageError]),
}) {}

export class CreateTag extends Rpc.make('CreateTag', {
  payload: {
    slug: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(120))),
    label: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(120))),
  },
  success: Tag,
  error: S.Union([SlugConflict, InvalidInput, StorageError]),
}) {}

export class DeleteTag extends Rpc.make('DeleteTag', {
  payload: { id: S.String },
  success: S.Boolean,
  error: StorageError,
}) {}

// ---------------------------------------------------------------------------
// Admin reads — what the Desk draws: who is signed in, the counts behind the
// Filter Bar, the Storage meter and the Library table.
// ---------------------------------------------------------------------------

export class GetSession extends Rpc.make('GetSession', {
  payload: {},
  success: S.Struct({ email: S.NullOr(S.String) }),
  error: S.Union([StorageError]),
}) {}

/** Every stored Status, always. `scheduled` is a display label over a draft
 *  (CONTEXT.md), not a fourth value with a count. */
export class GetCounts extends Rpc.make('GetCounts', {
  payload: {},
  success: S.Struct({
    total: S.Number,
    byStatus: S.Struct({ draft: S.Number, published: S.Number, failed: S.Number }),
    byTag: S.Array(S.Struct({ id: TagId, label: S.String, count: S.Number })),
  }),
  error: StorageError,
}) {}

/** The bucket cap. A configured constant, not a Settings row. The design disagrees
 *  with itself (the sidebar meter says 50 GB, the Settings Storage block says
 *  20 GB); one constant serves both, and 20 GB is the Storage block's number. */
export const STORAGE_CAP_BYTES = 20 * 1024 * 1024 * 1024

export class GetStorageUsage extends Rpc.make('GetStorageUsage', {
  payload: {},
  success: S.Struct({ photos: S.Number, bytes: S.Number, capBytes: S.Number }),
  error: StorageError,
}) {}

/** The Library's sort. `takenAt` is the only sortable column the Table Head offers
 *  today (`TAKEN ↓`). The service's `PHOTO_SORT_KEYS` is the source of truth; a
 *  test runs both so the two cannot drift. */
export const LibrarySort = S.Struct({
  key: S.Literals(['takenAt']),
  direction: S.Literals(['asc', 'desc']),
})

export class ListLibraryRows extends Rpc.make('ListLibraryRows', {
  payload: {
    status: S.optional(PhotoStatus),
    ratio: S.optional(PhotoRatio),
    tagIds: S.optional(
      S.Array(S.String.pipe(S.check(S.isMaxLength(128)))).pipe(S.check(S.isMaxLength(32))),
    ),
    q: S.optional(S.String.pipe(S.check(S.isMaxLength(120)))),
    sort: S.optional(LibrarySort),
    cursor: S.optional(S.String.pipe(S.check(S.isMaxLength(512)))),
    limit: S.optional(S.Number),
  },
  success: S.Struct({ items: S.Array(PhotoWithTags), nextCursor: S.NullOr(S.String) }),
  error: S.Union([InvalidInput, StorageError]),
}) {}

// ---------------------------------------------------------------------------
// Admin mutations — the Desk's single-Photo edits, its Bulk Bar and its Trash.
// ---------------------------------------------------------------------------

/** Publish and unpublish are one call: the Status is not a field on
 *  `UpdatePhoto`, and the type plus the column CHECK are both guards. */
export class SetPhotoStatus extends Rpc.make('SetPhotoStatus', {
  payload: { id: S.String.pipe(S.check(S.isMaxLength(128))), status: PhotoStatus },
  success: PhotoWithTags,
  error: S.Union([PhotoNotFound, StorageError]),
}) {}

/** A crop edit is one thing, so it is one call: the crop, the level, the mat and
 *  the export overrides ride in one request rather than six. */
const PhotoCrop = S.Struct({
  x: S.Number,
  y: S.Number,
  scale: S.Number.pipe(S.check(S.isGreaterThan(0))),
})

const PhotoMat = S.Struct({
  enabled: S.Boolean,
  style: S.optional(MatStyle),
  colour: S.optional(MatColour),
  /** A percentage of the frame edge; the design's slider reads `4%`. */
  width: S.optional(S.Number.pipe(S.check(S.isBetween({ minimum: 0, maximum: 100 })))),
})

const PhotoExportSettings = S.Struct({
  previewLongEdge: S.optional(S.Number.pipe(S.check(S.isGreaterThan(0)))),
  previewFormat: S.optional(RenditionFormat),
  previewQuality: S.optional(S.Number.pipe(S.check(S.isBetween({ minimum: 1, maximum: 100 })))),
  fullQuality: S.optional(S.Number.pipe(S.check(S.isBetween({ minimum: 1, maximum: 100 })))),
  keepExif: S.optional(S.Boolean),
  removeGps: S.optional(S.Boolean),
})

export class UpdatePhotoPresentation extends Rpc.make('UpdatePhotoPresentation', {
  payload: {
    id: S.String.pipe(S.check(S.isMaxLength(128))),
    crop: S.optional(PhotoCrop),
    level: S.optional(S.Number),
    mat: S.optional(PhotoMat),
    export: S.optional(PhotoExportSettings),
  },
  success: PhotoPresentation,
  error: S.Union([PhotoNotFound, InvalidInput, StorageError]),
}) {}

/** The Bulk Bar is multi-select and the Trash has `Restore all`, so the
 *  lifecycle moves in arrays. A count in, a count out: the service
 *  operations are idempotent, so a Photo already in the target state counts. */
const PhotoIds = S.Array(S.String.pipe(S.check(S.isMaxLength(128)))).pipe(
  S.check(S.isMinLength(1)),
  S.check(S.isMaxLength(100)),
)

export class TrashPhotos extends Rpc.make('TrashPhotos', {
  payload: { ids: PhotoIds },
  success: S.Number,
  error: S.Union([PhotoNotFound, StorageError]),
}) {}

export class RestorePhotos extends Rpc.make('RestorePhotos', {
  payload: { ids: PhotoIds },
  success: S.Number,
  error: S.Union([PhotoNotFound, StorageError]),
}) {}

export class PurgePhotos extends Rpc.make('PurgePhotos', {
  payload: { ids: PhotoIds },
  success: S.Number,
  error: S.Union([PhotoNotFound, InvalidInput, StorageError]),
}) {}

const TagIds = S.Array(S.String.pipe(S.check(S.isMaxLength(128)))).pipe(
  S.check(S.isMinLength(1)),
  S.check(S.isMaxLength(32)),
)

/** The Bulk Bar's `Move to series` slot, re-pointed: Series has no home
 *  (ADR 0008) and Tag is the grouping entity, so the slot is `Add tag`. */
export class BulkAddTags extends Rpc.make('BulkAddTags', {
  payload: { photoIds: PhotoIds, tagIds: TagIds },
  success: S.Number,
  error: S.Union([PhotoNotFound, StorageError]),
}) {}

export class BulkRemoveTags extends Rpc.make('BulkRemoveTags', {
  payload: { photoIds: PhotoIds, tagIds: TagIds },
  success: S.Number,
  error: S.Union([PhotoNotFound, StorageError]),
}) {}

/** `Add border` is the Bulk Bar's presentation move: one mat patch, every
 *  selected Photo. */
export class AddBorderToPhotos extends Rpc.make('AddBorderToPhotos', {
  payload: { photoIds: PhotoIds, mat: PhotoMat },
  success: S.Number,
  error: S.Union([PhotoNotFound, InvalidInput, StorageError]),
}) {}

/** A Tag's `slug` is not editable: a Series page is a Tag page (ADR 0008), so
 *  a slug is a live URL and renaming one is delete + create. */
export class UpdateTag extends Rpc.make('UpdateTag', {
  payload: {
    id: S.String.pipe(S.check(S.isMaxLength(128))),
    label: S.optional(S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(120)))),
    caption: S.optional(S.NullOr(S.String.pipe(S.check(S.isMaxLength(500))))),
  },
  success: Tag,
  error: S.Union([InvalidInput, StorageError]),
}) {}

export const PhotoAdminRpcs = RpcGroup.make(
  UpdatePhoto,
  DeletePhoto,
  CreateTag,
  DeleteTag,
  GetSession,
  GetCounts,
  GetStorageUsage,
  ListLibraryRows,
  SetPhotoStatus,
  UpdatePhotoPresentation,
  TrashPhotos,
  RestorePhotos,
  PurgePhotos,
  BulkAddTags,
  BulkRemoveTags,
  AddBorderToPhotos,
  UpdateTag,
)
