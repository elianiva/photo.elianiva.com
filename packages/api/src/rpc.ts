/**
 * RPC handler layers: wire the shared RPC groups (the contract) to the
 * domain services (the implementation). The Worker composes these into its
 * HTTP router — public reads on `/api/rpc`, admin writes on
 * `/api/admin/rpc` (ADR 0006/0007).
 */

import { Effect } from 'effect'
import { InvalidInput, PhotoAdminRpcs, PhotoPublicRpcs } from '@photo/shared'
import { PhotoService } from './photo'
import { TagService } from './tag'

export const PublicRpcHandlersLive = PhotoPublicRpcs.toLayer({
  ListPhotos: (payload) =>
    Effect.gen(function* () {
      if (payload.tagSlug !== undefined && payload.tagSlug.includes(',')) {
        return yield* new InvalidInput({ message: 'tagSlug takes one tag' })
      }
      return yield* PhotoService.use((service) =>
        service.list({
          tagSlug: payload.tagSlug,
          q: payload.q,
          limit: payload.limit,
          cursor: payload.cursor,
        }),
      )
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
  DeletePhoto: (payload) => PhotoService.use((service) => service.remove(payload.id)),
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
