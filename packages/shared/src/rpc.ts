import { Schema as S } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import { PhotoMetadata, PhotoWithTags, Tag, TagId } from './photo'

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
    /** Any-of: a Photo carrying at least one of these Tags. The Admin's
     *  sidebar filter is multi-select, so this is a set and never a slug —
     *  a slug would make the second pick replace the first. */
    tagIds: S.optional(
      S.Array(S.String.pipe(S.check(S.isMaxLength(128)))).pipe(S.check(S.isMaxLength(32))),
    ),
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
// The shell reads — session, counts, storage (issue #24). All three are on
// the admin group, so the edge gate and the in-worker JWT (ADR 0007) are what
// make them readable at all. None of them is a mutation and none of them is
// ever public.
// ---------------------------------------------------------------------------

/** The Access facts the gate already computed, read rather than recomputed
 *  (ADR 0007). `email` is `null` only where the gate stood down — the `dev`
 *  stage creates no Access applications — and `teamDomain` is `''` there too.
 *  There is no signed-out state: Access gates the route before any of this
 *  runs, so a caller either has a verified claim or never got this far. */
export class GetSession extends Rpc.make('GetSession', {
  payload: {},
  success: S.Struct({
    email: S.NullOr(S.String),
    teamDomain: S.String,
  }),
}) {}

/** The sidebar's counts, over live Photos. `scheduled` has no entry because
 *  it is not a Status (CONTEXT.md) and nothing records a publish time. */
export class GetCounts extends Rpc.make('GetCounts', {
  payload: {},
  success: S.Struct({
    /** Every live Photo. */
    total: S.Number,
    /** Soft-deleted Photos, so the Trash row can report a real number. */
    trashed: S.Number,
    byStatus: S.Struct({
      draft: S.Number,
      published: S.Number,
      failed: S.Number,
    }),
    /** Every Tag with how many live Photos carry it. A count of 0 is a fact. */
    byTag: S.Array(S.Struct({ id: TagId, label: S.String, count: S.Number })),
  }),
  error: StorageError,
}) {}

/** The sidebar meter's aggregate. `capBytes` is a configured constant, not a
 *  Settings row — the quota is a property of the bucket, not something the
 *  operator authors. */
export class GetStorageUsage extends Rpc.make('GetStorageUsage', {
  payload: {},
  success: S.Struct({
    photos: S.Number,
    bytes: S.Number,
    capBytes: S.Number,
  }),
  error: StorageError,
}) {}

export const PhotoAdminRpcs = RpcGroup.make(
  GetSession,
  GetCounts,
  GetStorageUsage,
  UpdatePhoto,
  DeletePhoto,
  CreateTag,
  DeleteTag,
)
