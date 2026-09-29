/**
 * TagService — free-form labels for grouping/filtering Photos (CONTEXT.md).
 */

import { Context, Effect, Layer, Schema as S } from 'effect'
import { InvalidInput, SlugConflict, StorageError, describeCause, Tag } from '@photo/shared'
import { Gateway } from './gateway'
import { slugify } from './photo'

export interface TagUpdatePatch {
  readonly label?: string | undefined
  /** Null clears the caption; a Tag with none has null, never `''`. */
  readonly caption?: string | null | undefined
}

export interface TagServiceContract {
  readonly list: Effect.Effect<ReadonlyArray<Tag>, StorageError>
  readonly create: (input: {
    slug: string
    label: string
  }) => Effect.Effect<Tag, SlugConflict | StorageError>
  /** Relabel and caption in one call. A `slug` is a live URL (a Series page
   *  is a Tag page, ADR 0008), so it is not writable here. */
  readonly update: (
    id: string,
    patch: TagUpdatePatch,
  ) => Effect.Effect<Tag, InvalidInput | StorageError>
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
      try: () => db.prepare(`SELECT id, slug, label, caption FROM tags ORDER BY label`).all<Tag>(),
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
        return S.decodeSync(Tag)({ id, slug, label: input.label, caption: null })
      })

    const rowById = (id: string) =>
      Effect.tryPromise({
        try: () =>
          db
            .prepare(`SELECT id, slug, label, caption FROM tags WHERE id = ?`)
            .bind(id)
            .first<Tag>(),
        catch: (cause) =>
          new StorageError({ message: `Failed to get tag ${id}`, cause: describeCause(cause) }),
      })

    const update: TagServiceContract['update'] = (id, patch) =>
      Effect.gen(function* () {
        // An empty patch is a read: it still has to prove the Tag exists,
        // because an unknown id is the one thing this call can reject.
        if ((yield* rowById(id)) === null) {
          return yield* Effect.fail(new InvalidInput({ message: `no tag with id ${id}` }))
        }
        const fields: Array<string> = []
        const binds: Array<string | null> = []
        if (patch.label !== undefined) {
          fields.push('label = ?')
          binds.push(patch.label)
        }
        if (patch.caption !== undefined) {
          fields.push('caption = ?')
          binds.push(patch.caption)
        }
        if (fields.length > 0) {
          yield* Effect.tryPromise({
            try: () =>
              db
                .prepare(`UPDATE tags SET ${fields.join(', ')} WHERE id = ?`)
                .bind(...binds, id)
                .run(),
            catch: (cause) =>
              new StorageError({
                message: `Failed to update tag ${id}`,
                cause: describeCause(cause),
              }),
          })
        }
        const row = yield* rowById(id)
        if (row === null) {
          return yield* Effect.fail(new InvalidInput({ message: `no tag with id ${id}` }))
        }
        return row
      })

    const remove: TagServiceContract['remove'] = (id) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () =>
            db.batch([
              db.prepare(`DELETE FROM photo_tags WHERE tagId = ?`).bind(id),
              db.prepare(`DELETE FROM tags WHERE id = ?`).bind(id),
            ]),
          catch: (cause) =>
            new StorageError({
              message: `Failed to delete tag ${id}`,
              cause: describeCause(cause),
            }),
        })
        return true
      })

    return TagService.of({ list, create, update, remove })
  }),
)
