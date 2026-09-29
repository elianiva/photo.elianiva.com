/**
 * RPC handler layers: wire the shared RPC groups (the contract) to the
 * domain services (the implementation). The Worker composes these into its
 * HTTP router — public reads on `/rpc`, admin writes on
 * `/admin/rpc` (ADR 0006/0007).
 */

import { Effect } from 'effect'
import { InvalidInput, PhotoAdminRpcs, PhotoPublicRpcs } from '@photo/shared'
import { PhotoService, STORAGE_CAP_BYTES, slugify, type PhotoListFilter } from './photo'
import { AdminSession } from './session'
import { TagService } from './tag'

/**
 * The single-Photo operations, folded over a set in order. The lifecycle and
 * the presentation rules stay owned by the service — a Photo must exist, only
 * a trashed Photo can be purged — rather than being restated as bulk SQL that
 * can drift from them.
 */
const foldOver = <A, E>(
  ids: ReadonlyArray<string>,
  operation: (id: string) => Effect.Effect<A, E>,
): Effect.Effect<void, E> =>
  Effect.gen(function* () {
    for (const id of ids) {
      yield* operation(id)
    }
  })

export const PublicRpcHandlersLive = PhotoPublicRpcs.toLayer({
  ListPhotos: (payload) =>
    Effect.gen(function* () {
      const filter: PhotoListFilter = {
        q: payload.q,
        limit: payload.limit,
        cursor: payload.cursor,
      }
      const tagSlug = payload.tagSlug?.trim() ?? ''
      if (tagSlug.includes(',')) {
        return yield* new InvalidInput({ message: 'tagSlug takes one tag' })
      }
      if (tagSlug === '') {
        return yield* PhotoService.use((service) => service.list(filter))
      }
      // The public contract speaks slugs and the service filters on ids, so
      // the boundary resolves it. The read side normalises through the same
      // `slugify` the write side uses, which is the whole of #42's fourth
      // defect: a filter typed `Istanbul` finds the tag stored as `istanbul`.
      const tag = yield* Effect.map(
        TagService.use((service) => service.list),
        (tags) => tags.find((candidate) => candidate.slug === slugify(tagSlug)),
      )
      // A slug nobody carries is a filter that matches nothing, which is a
      // different answer from not filtering at all.
      if (tag === undefined) return { items: [], nextCursor: null }
      return yield* PhotoService.use((service) => service.list({ ...filter, tagIds: [tag.id] }))
    }),
  GetPhoto: (payload) => PhotoService.use((service) => service.get(payload.id)),
  ListTags: () => TagService.use((service) => service.list),
})

export const AdminRpcHandlersLive = PhotoAdminRpcs.toLayer({
  UpdatePhoto: (payload) =>
    Effect.gen(function* () {
      if (
        payload.title === undefined &&
        payload.slug === undefined &&
        payload.takenAt === undefined &&
        payload.metadata === undefined &&
        payload.tagIds === undefined
      ) {
        return yield* new InvalidInput({ message: 'empty update' })
      }
      return yield* PhotoService.use((service) =>
        service.update(payload.id, {
          title: payload.title,
          slug: payload.slug,
          takenAt: payload.takenAt,
          metadata: payload.metadata,
          tagIds: payload.tagIds,
        }),
      )
    }),
  // `DeletePhoto` is a soft delete: the row is stamped `deletedAt` and its
  // original stays in R2 until the Trash purges it.
  DeletePhoto: (payload) =>
    Effect.as(
      PhotoService.use((service) => service.trash(payload.id)),
      true,
    ),
  CreateTag: (payload) =>
    Effect.gen(function* () {
      if (payload.label.trim() === '') {
        return yield* new InvalidInput({ message: 'label is required' })
      }
      return yield* TagService.use((service) =>
        service.create({ slug: payload.slug, label: payload.label.trim() }),
      )
    }),
  DeleteTag: (payload) => TagService.use((service) => service.remove(payload.id)),
  // The claims the gate already verified, read and never recomputed. A null is
  // the dev stand-down (ADR 0007), not a signed-out state: there is no sign-in
  // form to show and no session to end.
  GetSession: () =>
    AdminSession.use((session) =>
      Effect.succeed({ email: session.email, teamDomain: session.teamDomain }),
    ),
  GetCounts: () => PhotoService.use((service) => service.counts()),
  GetStorageUsage: () =>
    Effect.map(
      PhotoService.use((service) => service.storageUsage()),
      (usage) => ({
        ...usage,
        capBytes: STORAGE_CAP_BYTES,
      }),
    ),
  // A dedicated admin shape rather than an overload of the public `ListPhotos`,
  // so the public contract stays small while the Library gets its Status,
  // Ratio and Tag filters.
  ListLibraryRows: (payload) =>
    PhotoService.use((service) =>
      service.list({
        status: payload.status,
        ratio: payload.ratio,
        tagIds: payload.tagIds,
        q: payload.q,
        sort: payload.sort,
        cursor: payload.cursor,
        limit: payload.limit,
      }),
    ),
  SetPhotoStatus: (payload) =>
    PhotoService.use((service) => service.setStatus(payload.id, payload.status)),
  UpdatePhotoPresentation: (payload) =>
    PhotoService.use((service) =>
      service.setPresentation(payload.id, {
        crop: payload.crop,
        level: payload.level,
        mat: payload.mat,
        export: payload.export,
      }),
    ),
  // `void` on purpose: the fold is all-or-nothing, so there is no partial
  // count to report, and a number read off the payload would report the
  // request back to the client. The Bulk Bar re-reads the list and the counts.
  TrashPhotos: (payload) =>
    PhotoService.use((service) => foldOver(payload.ids, (id) => service.trash(id))),
  RestorePhotos: (payload) =>
    PhotoService.use((service) => foldOver(payload.ids, (id) => service.restore(id))),
  PurgePhotos: (payload) =>
    PhotoService.use((service) => foldOver(payload.ids, (id) => service.purge(id))),
  BulkAddTags: (payload) =>
    PhotoService.use((service) => service.addTags(payload.photoIds, payload.tagIds)),
  BulkRemoveTags: (payload) =>
    PhotoService.use((service) => service.removeTags(payload.photoIds, payload.tagIds)),
  AddBorderToPhotos: (payload) =>
    PhotoService.use((service) =>
      foldOver(payload.photoIds, (id) => service.setPresentation(id, { mat: payload.mat })),
    ),
  UpdateTag: (payload) =>
    Effect.gen(function* () {
      if (payload.label !== undefined && payload.label.trim() === '') {
        return yield* new InvalidInput({ message: 'label is required' })
      }
      return yield* TagService.use((service) =>
        service.update(payload.id, {
          label: payload.label?.trim(),
          caption: payload.caption,
        }),
      )
    }),
})

// `Compress` would sit in the admin group beside `UpdatePhotoPresentation` and
// does not ship: it recompresses the `FULL` Rendition, which #35 creates. A
// button that reports work it cannot do is a lie in the UI.
