/**
 * RPC handler layers: wire the shared RPC groups (the contract) to the
 * domain services (the implementation). The Worker composes these into its
 * HTTP router — public reads on `/rpc`, admin writes on
 * `/admin/rpc` (ADR 0006/0007).
 */

import { Effect } from 'effect'
import { InvalidInput, PhotoAdminRpcs, PhotoPublicRpcs } from '@photo/shared'
import { PhotoService, slugify, type PhotoListFilter } from './photo'
import { TagService } from './tag'

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
})
