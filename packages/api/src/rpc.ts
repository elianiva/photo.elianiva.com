/**
 * RPC handler layers: wire the shared RPC groups (the contract) to the
 * domain services (the implementation). The Worker composes these into its
 * HTTP router — public reads on `/rpc`, the edge-gated admin group on
 * `/admin/rpc` (ADR 0006/0007).
 */

import { Effect } from 'effect'
import { InvalidInput, PhotoAdminRpcs, PhotoPublicRpcs } from '@photo/shared'
import { PhotoService, STORAGE_CAP_BYTES, type PhotoListFilter } from './photo'
import { TagService } from './tag'

export const PublicRpcHandlersLive = PhotoPublicRpcs.toLayer({
  ListPhotos: (payload) =>
    Effect.gen(function* () {
      // The contract speaks Tag ids, the same thing the service filters on, so
      // the boundary has no slug to resolve and no way to smuggle two Tags
      // through a field that took one.
      const filter: PhotoListFilter = {
        q: payload.q,
        limit: payload.limit,
        cursor: payload.cursor,
        tagIds: payload.tagIds,
      }
      return yield* PhotoService.use((service) => service.list(filter))
    }),
  GetPhoto: (payload) => PhotoService.use((service) => service.get(payload.id)),
  ListTags: () => TagService.use((service) => service.list),
})

/** The Access facts the gate verified for this request. `email` is null and
 *  `teamDomain` is '' only where the gate stood down (the dev stage creates no
 *  Access applications). */
export interface AdminSession {
  readonly email: string | null
  readonly teamDomain: string
}

/** A layer over the verified session rather than a bare one: `GetSession` has
 *  to hand back the claim the gate already checked (ADR 0007), and recomputing
 *  it in the handler would be a second, unchecked answer to the same question. */
export const adminRpcHandlersLive = (session: AdminSession) =>
  PhotoAdminRpcs.toLayer({
    GetSession: () => Effect.succeed({ email: session.email, teamDomain: session.teamDomain }),
    GetCounts: () => PhotoService.use((service) => service.counts()),
    GetStorageUsage: () =>
      Effect.map(
        PhotoService.use((service) => service.storageUsage()),
        (usage) => ({ ...usage, capBytes: STORAGE_CAP_BYTES }),
      ),
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
