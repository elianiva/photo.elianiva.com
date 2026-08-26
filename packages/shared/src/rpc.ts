import { Schema as S } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import { PhotoMetadata, PhotoWithTags, Tag } from './photo'

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
    tagSlug: S.optional(S.String),
    q: S.optional(S.String),
    limit: S.optional(S.Number),
    cursor: S.optional(S.String),
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
// Admin writes — edge-gated (Access on /api/admin*) + JWT-verified in-worker
// (ADR 0007).
// ---------------------------------------------------------------------------

export class UpdatePhoto extends Rpc.make('UpdatePhoto', {
  payload: {
    id: S.String,
    title: S.optional(S.String),
    slug: S.optional(S.String),
    takenAt: S.optional(S.String),
    metadata: S.optional(PhotoMetadata),
    tagIds: S.optional(S.Array(S.String)),
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
  payload: { slug: S.String, label: S.String },
  success: Tag,
  error: S.Union([SlugConflict, InvalidInput, StorageError]),
}) {}

export class DeleteTag extends Rpc.make('DeleteTag', {
  payload: { id: S.String },
  success: S.Boolean,
  error: StorageError,
}) {}

export const PhotoAdminRpcs = RpcGroup.make(UpdatePhoto, DeletePhoto, CreateTag, DeleteTag)
