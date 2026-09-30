/**
 * RPC handler layers: wire the shared RPC groups (the contract) to the
 * domain services (the implementation). The Worker composes these into its
 * HTTP router — public reads on `/rpc`, admin reads and writes on
 * `/admin/rpc` (ADR 0003).
 *
 * A handler translates a payload and a result, and owns no visibility rule.
 * The public group answers for published, non-trashed Photos because
 * `PublicPhotoService` filters to them, so the ungated `/rpc` cannot leak a
 * Draft by someone forgetting a `where`; the admin group answers through
 * `PhotoService`, which deliberately sees Drafts, failed uploads and the
 * Editor's Photo.
 */

import { Effect } from 'effect'
import { InvalidInput, PhotoAdminRpcs, PhotoPublicRpcs, PhotoNotFound } from '@photo/shared'
import { PhotoService, STORAGE_CAP_BYTES } from './photo'
import { PublicPhotoService } from './public-photo'
import { AdminSession } from './session'
import { SettingsService } from './settings'
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
  ListPhotos: (payload) => PublicPhotoService.use((service) => service.list(payload)),
  // The id has to name a published Photo or the call is not found: a Draft is
  // not a Photo the public has not been told about yet, it is a Photo the
  // public has not been given. `PhotoNotFound` is the protocol answer, not a
  // visibility decision — the scope that produced the null is the service's.
  GetPhoto: (payload) =>
    Effect.flatMap(
      PublicPhotoService.use((service) => service.byId(payload.id)),
      (photo) =>
        photo === null ? Effect.fail(new PhotoNotFound({ id: payload.id })) : Effect.succeed(photo),
    ),
  ListTags: () => TagService.use((service) => service.list),
  // The Front's one read: the Sections this pass renders, the month to resume
  // below them, and the Masthead's counters, in one call.
  GetFrontPage: (payload) =>
    Effect.gen(function* () {
      const page = yield* PublicPhotoService.use((service) => service.frontPage(payload))
      const stats = yield* PublicPhotoService.use((service) => service.frontStats())
      return { ...page, stats }
    }),
  GetPublicPhoto: (payload) => PublicPhotoService.use((service) => service.bySlug(payload.slug)),
  GetPublicPhotoByNumber: (payload) =>
    PublicPhotoService.use((service) => service.byNumber(payload.number)),
})

export const AdminRpcHandlersLive = PhotoAdminRpcs.toLayer({
  // The same wire shape the public group declares, and the Editor's Photo: a
  // Draft, a failed upload, anything but the Trash.
  GetPhoto: (payload) => PhotoService.use((service) => service.get(payload.id)),
  // The Editor's loaded snapshot. The gated group only: the public site reads
  // the Rendition the Presentation produced, not the authoring state.
  GetPhotoPresentation: (payload) =>
    PhotoService.use((service) => service.presentation(payload.id)),
  UpdatePhoto: (payload) =>
    Effect.gen(function* () {
      if (
        payload.title === undefined &&
        payload.slug === undefined &&
        payload.takenAt === undefined &&
        payload.metadata === undefined &&
        payload.ratio === undefined &&
        payload.blurhash === undefined &&
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
          ratio: payload.ratio,
          blurhash: payload.blurhash,
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
  // the dev stand-down (ADR 0003), not a signed-out state: there is no sign-in
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
    Effect.gen(function* () {
      // The same filter object for both reads, so the page and the number it is
      // paged over cannot be counted under different conditions. `count` drops
      // the cursor on purpose: `1–7 OF 412` counts the filter, not the position.
      const filter = {
        status: payload.status,
        ratio: payload.ratio,
        tagIds: payload.tagIds,
        q: payload.q,
        sort: payload.sort,
        cursor: payload.cursor,
        limit: payload.limit,
      }
      const [page, total] = yield* Effect.all([
        PhotoService.use((service) => service.list(filter)),
        PhotoService.use((service) => service.count(filter)),
      ])
      return { items: page.items, nextCursor: page.nextCursor, total }
    }),
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
  GetSettings: () => SettingsService.use((service) => service.read),
  UpdateSettings: (payload) => SettingsService.use((service) => service.update(payload)),
  // The rows, not the document: the Storage block's CSV is assembled from
  // these, and the join and the order are the service's to get right.
  ListPhotoIndex: () =>
    Effect.map(
      PhotoService.use((service) => service.index()),
      (items) => ({ items }),
    ),
})

// `Compress` would sit in the admin group beside `UpdatePhotoPresentation` and
// does not ship: it recompresses the `FULL` Rendition, which #35 creates. A
// button that reports work it cannot do is a lie in the UI.
