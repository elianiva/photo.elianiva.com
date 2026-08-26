/**
 * TagService — free-form labels for grouping/filtering Photos (CONTEXT.md).
 */

import { Context, Effect, Layer, Schema as S } from 'effect'
import { SlugConflict, StorageError, describeCause, Tag } from '@photo/shared'
import { Gateway } from './gateway'
import { slugify } from './photo'

export interface TagServiceContract {
  readonly list: Effect.Effect<ReadonlyArray<Tag>, StorageError>
  readonly create: (input: {
    slug: string
    label: string
  }) => Effect.Effect<Tag, SlugConflict | StorageError>
  /** Idempotent: removing an unknown tag still succeeds. */
  readonly remove: (id: string) => Effect.Effect<boolean, StorageError>
}

export class TagService extends Context.Service<TagService, TagServiceContract>()(
  'photo/TagService',
) {}

export const TagServiceLive = Layer.effect(
  TagService,
  Effect.gen(function* () {
    const gateway = yield* Gateway
    const db = gateway.db

    const list: TagServiceContract['list'] = Effect.tryPromise({
      try: () => db.prepare(`SELECT id, slug, label FROM tags ORDER BY label`).all<Tag>(),
      catch: (cause) =>
        new StorageError({ message: 'Failed to list tags', cause: describeCause(cause) }),
    }).pipe(Effect.map((raw) => raw.results ?? []))

    const create: TagServiceContract['create'] = (input) =>
      Effect.gen(function* () {
        const slug = slugify(input.slug)
        const id = crypto.randomUUID()
        const existing = yield* Effect.tryPromise({
          try: () => db.prepare(`SELECT id FROM tags WHERE slug = ?`).bind(slug).first(),
          catch: (cause) =>
            new StorageError({ message: 'Failed to check tag slug', cause: describeCause(cause) }),
        })
        if (existing !== null) {
          return yield* Effect.fail(new SlugConflict({ slug }))
        }
        yield* Effect.tryPromise({
          try: () =>
            db
              .prepare(`INSERT INTO tags (id, slug, label) VALUES (?, ?, ?)`)
              .bind(id, slug, input.label)
              .run(),
          catch: (cause) =>
            new StorageError({ message: 'Failed to insert tag', cause: describeCause(cause) }),
        })
        // Decode brands the freshly-generated id through the shared schema.
        return S.decodeSync(Tag)({ id, slug, label: input.label })
      })

    const remove: TagServiceContract['remove'] = (id) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () => db.prepare(`DELETE FROM tags WHERE id = ?`).bind(id).run(),
          catch: (cause) =>
            new StorageError({
              message: `Failed to delete tag ${id}`,
              cause: describeCause(cause),
            }),
        })
        return true
      })

    return TagService.of({ list, create, remove })
  }),
)
