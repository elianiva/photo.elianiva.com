/**
 * TagService — free-form labels for grouping/filtering Photos (CONTEXT.md).
 */

import { Context, Effect, Layer, Schema as S } from 'effect'
import { InvalidInput, SlugConflict, StorageError, describeCause, Tag } from '@photo/shared'
import * as SqlClient from 'effect/sql/SqlClient'
import type { Fragment } from 'effect/sql/Statement'
import { Batch } from './batch'
import { firstRow } from './photo'
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
   *  is a Tag page, ADR 0006), so it is not writable here. */
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
    const sql = yield* SqlClient.SqlClient
    const batch = yield* Batch

    const list: TagServiceContract['list'] = Effect.mapError(
      sql<Tag>`SELECT id, slug, label, caption FROM tags ORDER BY label`,
      (cause) => new StorageError({ message: 'Failed to list tags', cause: describeCause(cause) }),
    )

    const create: TagServiceContract['create'] = (input) =>
      Effect.gen(function* () {
        const slug = slugify(input.slug)
        const id = crypto.randomUUID()
        const existing = yield* Effect.mapError(
          sql<{ id: string }>`SELECT id FROM tags WHERE slug = ${slug}`,
          (cause) =>
            new StorageError({ message: 'Failed to check tag slug', cause: describeCause(cause) }),
        ).pipe(Effect.map(firstRow))
        if (existing !== null) {
          return yield* Effect.fail(new SlugConflict({ slug }))
        }
        yield* Effect.mapError(
          sql`INSERT INTO tags (id, slug, label) VALUES (${id}, ${slug}, ${input.label})`.raw,
          (cause) =>
            new StorageError({ message: 'Failed to insert tag', cause: describeCause(cause) }),
        )
        // Decode brands the freshly-generated id through the shared schema.
        return S.decodeSync(Tag)({ id, slug, label: input.label, caption: null })
      })

    const rowById = (id: string) =>
      Effect.mapError(
        sql<Tag>`SELECT id, slug, label, caption FROM tags WHERE id = ${id}`,
        (cause) =>
          new StorageError({ message: `Failed to get tag ${id}`, cause: describeCause(cause) }),
      ).pipe(Effect.map(firstRow))

    const update: TagServiceContract['update'] = (id, patch) =>
      Effect.gen(function* () {
        // An empty patch is a read: it still has to prove the Tag exists,
        // because an unknown id is the one thing this call can reject.
        if ((yield* rowById(id)) === null) {
          return yield* Effect.fail(new InvalidInput({ message: `no tag with id ${id}` }))
        }
        const assignments: Array<Fragment> = []
        if (patch.label !== undefined) assignments.push(sql`label = ${patch.label}`)
        if (patch.caption !== undefined) assignments.push(sql`caption = ${patch.caption}`)
        if (assignments.length > 0) {
          yield* Effect.mapError(
            sql`UPDATE tags SET ${sql.join(', ', false)(assignments)} WHERE id = ${id}`.raw,
            (cause) =>
              new StorageError({
                message: `Failed to update tag ${id}`,
                cause: describeCause(cause),
              }),
          )
        }
        const row = yield* rowById(id)
        if (row === null) {
          return yield* Effect.fail(new InvalidInput({ message: `no tag with id ${id}` }))
        }
        return row
      })

    const remove: TagServiceContract['remove'] = (id) =>
      Effect.gen(function* () {
        yield* Effect.mapError(
          batch.run([
            sql`DELETE FROM photo_tags WHERE tagId = ${id}`,
            sql`DELETE FROM tags WHERE id = ${id}`,
          ]),
          (cause) =>
            new StorageError({
              message: `Failed to delete tag ${id}`,
              cause: describeCause(cause),
            }),
        )
        return true
      })

    return TagService.of({ list, create, update, remove })
  }),
)
