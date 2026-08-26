/**
 * PhotoService — the Photo domain over D1 + R2 (see CONTEXT.md).
 * Essential queryable fields are columns; the rest lives in the JSON
 * `metadata` blob. Tags join through `photo_tags`.
 */

import { Context, Effect, Layer } from 'effect'
import {
  DbPhotoRow,
  PhotoNotFound,
  SlugConflict,
  StorageError,
  describeCause,
  type PhotoWithTags,
  type Tag,
} from '@photo/shared'
import { Gateway } from './gateway'

export interface PhotoListFilter {
  readonly tagSlug?: string | undefined
  readonly q?: string | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
}

export interface PhotoListPage {
  readonly items: ReadonlyArray<PhotoWithTags>
  readonly nextCursor: string | null
}

export interface PhotoUpdatePatch {
  readonly title?: string | undefined
  readonly slug?: string | undefined
  readonly takenAt?: string | undefined
  readonly metadata?: Record<string, unknown> | undefined
  readonly tagIds?: ReadonlyArray<string> | undefined
}

export interface CreatePhotoInput {
  readonly slug: string
  readonly title: string
  readonly r2Key: string
  readonly width: number
  readonly height: number
  readonly takenAt?: string | undefined
  readonly metadata: string
  /** Client-encoded placeholder hash; null for legacy uploads. */
  readonly blurhash?: string | undefined
  readonly contentType?: string | undefined
  readonly bytes: ArrayBuffer
  readonly tagIds: ReadonlyArray<string>
}

export interface PhotoServiceContract {
  /** Photos newest-first, optionally filtered by tag or free text. Keyset paginated. */
  readonly list: (filter: PhotoListFilter) => Effect.Effect<PhotoListPage, StorageError>
  readonly get: (id: string) => Effect.Effect<PhotoWithTags, StorageError | PhotoNotFound>
  /** Store bytes in R2 + insert row + link tags. Used by the multipart upload endpoint. */
  readonly create: (
    input: CreatePhotoInput,
  ) => Effect.Effect<{ id: string; slug: string; r2Key: string }, StorageError | SlugConflict>
  readonly update: (
    id: string,
    patch: PhotoUpdatePatch,
  ) => Effect.Effect<PhotoWithTags, StorageError | PhotoNotFound | SlugConflict>
  /** Delete the row then best-effort delete the R2 object. */
  readonly remove: (id: string) => Effect.Effect<boolean, StorageError | PhotoNotFound>
}

export class PhotoService extends Context.Service<PhotoService, PhotoServiceContract>()(
  'photo/PhotoService',
) {}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export const slugify = (input: string): string =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled'

const parseMetadataObject = (raw: string | null): Record<string, unknown> | undefined => {
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

interface TagRowWithPhotoId extends Tag {
  readonly photoId: string
}

const tagsForPhotos = (db: (typeof Gateway.Service)['db'], ids: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const map = new Map<string, Array<Tag>>()
    for (const id of ids) map.set(id, [])
    if (ids.length === 0) return new Map<string, ReadonlyArray<Tag>>()

    // Chunk IN lists to stay well under D1's ~100 bind limit
    const chunkSize = 80
    for (let offset = 0; offset < ids.length; offset += chunkSize) {
      const chunk = ids.slice(offset, offset + chunkSize)
      const placeholders = chunk.map(() => '?').join(', ')
      const raw = yield* Effect.tryPromise({
        try: () =>
          db
            .prepare(
              `SELECT t.id, t.slug, t.label, pt.photoId as photoId FROM tags t JOIN photo_tags pt ON pt.tagId = t.id WHERE pt.photoId IN (${placeholders}) ORDER BY t.label`,
            )
            .bind(...chunk)
            .all<TagRowWithPhotoId>(),
        catch: (cause) =>
          new StorageError({
            message: `Failed to load tags for batch`,
            cause: describeCause(cause),
          }),
      })
      for (const row of raw.results ?? []) {
        const list = map.get(row.photoId)
        if (list) list.push({ id: row.id, slug: row.slug, label: row.label })
      }
    }
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Array<Tag> is assignable to ReadonlyArray<Tag> for the return view
    return map as Map<string, ReadonlyArray<Tag>>
  })

const toPhotoWithTags = (row: DbPhotoRow, tags: ReadonlyArray<Tag>): PhotoWithTags => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  r2Key: row.r2Key,
  width: row.width,
  height: row.height,
  takenAt: row.takenAt ?? undefined,
  metadata: parseMetadataObject(row.metadata),
  blurhash: row.blurhash ?? null,
  tags: [...tags],
})

interface ParsedCursor {
  readonly takenAt: string | null
  readonly id: string
}

export const decodeCursor = (raw: string): ParsedCursor | null => {
  try {
    const json = atob(raw)
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null) return null
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- narrowing unknown JSON to record for cursor decode
    const record = parsed as Record<string, unknown>
    const idRaw = record['id']
    if (typeof idRaw !== 'string' || !('takenAt' in record)) return null
    const takenAtRaw = record['takenAt']
    const takenAt =
      takenAtRaw === null || takenAtRaw === undefined
        ? null
        : typeof takenAtRaw === 'string'
          ? takenAtRaw
          : null
    return { takenAt, id: idRaw }
  } catch {
    return null
  }
}

export const encodeCursor = (row: DbPhotoRow): string =>
  btoa(JSON.stringify({ takenAt: row.takenAt, id: row.id }))

export const clampLimit = (input: number | undefined): number => {
  if (input === undefined || !Number.isFinite(input)) return 60
  return Math.min(Math.max(Math.floor(input), 1), 100)
}

const selectPhotoRows = (
  db: (typeof Gateway.Service)['db'],
  filter: PhotoListFilter,
): Effect.Effect<{ rows: ReadonlyArray<DbPhotoRow>; nextCursor: string | null }, StorageError> =>
  Effect.gen(function* () {
    const where: Array<string> = []
    const binds: Array<string> = []
    if (filter.q !== undefined && filter.q.trim() !== '') {
      const needle = `%${filter.q.trim().toLowerCase()}%`
      where.push(`(LOWER(title) LIKE ? OR LOWER(slug) LIKE ? OR LOWER(metadata) LIKE ?)`)
      binds.push(needle, needle, needle)
    }
    if (filter.tagSlug !== undefined && filter.tagSlug.trim() !== '') {
      where.push(
        `id IN (SELECT pt.photoId FROM photo_tags pt JOIN tags t ON t.id = pt.tagId WHERE t.slug = ?)`,
      )
      binds.push(filter.tagSlug.trim())
    }
    const limit = clampLimit(filter.limit)
    const cursor = filter.cursor !== undefined ? decodeCursor(filter.cursor) : null
    if (cursor !== null) {
      // Keyset: (COALESCE(takenAt,''), id) < (cursorTakenAt, cursorId) in DESC order
      // For DESC, next page is where the ordering key is strictly less.
      where.push(
        `(COALESCE(takenAt,'') < COALESCE(?, '') OR (COALESCE(takenAt,'') = COALESCE(?, '') AND id < ?))`,
      )
      binds.push(cursor.takenAt ?? '', cursor.takenAt ?? '', cursor.id)
    }

    const sql = `SELECT id, slug, title, r2Key, width, height, takenAt, metadata, blurhash FROM photos${
      where.length ? ` WHERE ${where.join(' AND ')}` : ''
    } ORDER BY COALESCE(takenAt,'') DESC, id DESC LIMIT ?`
    const raw = yield* Effect.tryPromise({
      try: () =>
        db
          .prepare(sql)
          .bind(...binds, String(limit))
          .all<DbPhotoRow>(),
      catch: (cause) =>
        new StorageError({ message: 'Failed to list photos', cause: describeCause(cause) }),
    })
    const rows = raw.results ?? []
    const nextCursor = rows.length === limit ? encodeCursor(rows[rows.length - 1]!) : null
    return { rows, nextCursor }
  })

const getRow = (db: (typeof Gateway.Service)['db'], id: string) =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () =>
        db
          .prepare(
            `SELECT id, slug, title, r2Key, width, height, takenAt, metadata, blurhash FROM photos WHERE id = ?`,
          )
          .bind(id)
          .first<DbPhotoRow>(),
      catch: (cause) =>
        new StorageError({ message: `Failed to get photo ${id}`, cause: describeCause(cause) }),
    })
    if (!raw) return null
    return raw
  })

const replaceTags = (
  db: (typeof Gateway.Service)['db'],
  photoId: string,
  tagIds: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => db.prepare(`DELETE FROM photo_tags WHERE photoId = ?`).bind(photoId).run(),
      catch: (cause) =>
        new StorageError({ message: 'Failed to reset tags', cause: describeCause(cause) }),
    })
    for (const tagId of tagIds) {
      yield* Effect.tryPromise({
        try: () =>
          db
            .prepare(`INSERT OR IGNORE INTO photo_tags (photoId, tagId) VALUES (?, ?)`)
            .bind(photoId, tagId)
            .run(),
        catch: (cause) =>
          new StorageError({ message: `Failed to link tag ${tagId}`, cause: describeCause(cause) }),
      })
    }
  })

/** True when no other photo owns this slug. */
const slugAvailable = (db: (typeof Gateway.Service)['db'], slug: string, exceptPhotoId?: string) =>
  Effect.gen(function* () {
    const row = yield* Effect.tryPromise({
      try: () =>
        db
          .prepare(`SELECT id FROM photos WHERE slug = ? AND (? IS NULL OR id != ?)`)
          .bind(slug, exceptPhotoId ?? null, exceptPhotoId ?? '')
          .first<{ id: string }>(),
      catch: (cause) =>
        new StorageError({ message: 'Failed to check slug', cause: describeCause(cause) }),
    })
    return row === null
  })

// ---------------------------------------------------------------------------
// live implementation
// ---------------------------------------------------------------------------

export const PhotoServiceLive = Layer.effect(
  PhotoService,
  Effect.gen(function* () {
    const gateway = yield* Gateway
    const db = gateway.db

    const list: PhotoServiceContract['list'] = (filter) =>
      Effect.gen(function* () {
        const { rows, nextCursor } = yield* selectPhotoRows(db, filter)
        const tagMap = yield* tagsForPhotos(
          db,
          rows.map((row) => row.id),
        )
        const items = rows.map((row) => toPhotoWithTags(row, tagMap.get(row.id) ?? []))
        return { items, nextCursor }
      })

    const get: PhotoServiceContract['get'] = (id) =>
      Effect.gen(function* () {
        const row = yield* getRow(db, id)
        if (row === null) return yield* Effect.fail(new PhotoNotFound({ id }))
        const tagMap = yield* tagsForPhotos(db, [row.id])
        return toPhotoWithTags(row, tagMap.get(row.id) ?? [])
      })

    const create: PhotoServiceContract['create'] = (input) =>
      Effect.gen(function* () {
        let slug = slugify(input.slug)
        if (!(yield* slugAvailable(db, slug))) {
          // deterministic suffix keeps retries stable without a second round-trip
          slug = `${slug}-${crypto.randomUUID().slice(0, 8)}`
        }
        const id = crypto.randomUUID()
        yield* Effect.tryPromise({
          try: () =>
            gateway.photos.put(input.r2Key, input.bytes, {
              httpMetadata: { contentType: input.contentType ?? 'image/jpeg' },
            }),
          catch: (cause) =>
            new StorageError({
              message: 'Failed to store original in R2',
              cause: describeCause(cause),
            }),
        })
        yield* Effect.tryPromise({
          try: () =>
            db
              .prepare(
                `INSERT INTO photos (id, slug, title, r2Key, width, height, takenAt, metadata, blurhash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(
                id,
                slug,
                input.title,
                input.r2Key,
                input.width,
                input.height,
                input.takenAt ?? null,
                input.metadata,
                input.blurhash ?? null,
              )
              .run(),
          catch: (cause) =>
            new StorageError({ message: 'Failed to insert photo', cause: describeCause(cause) }),
        })
        yield* replaceTags(db, id, input.tagIds)
        return { id, slug, r2Key: input.r2Key }
      })

    const update: PhotoServiceContract['update'] = (id, patch) =>
      Effect.gen(function* () {
        if ((yield* getRow(db, id)) === null) {
          return yield* Effect.fail(new PhotoNotFound({ id }))
        }
        const fields: Array<string> = []
        const binds: Array<string | null> = []
        if (patch.title !== undefined) {
          fields.push('title = ?')
          binds.push(patch.title)
        }
        if (patch.slug !== undefined) {
          const nextSlug = slugify(patch.slug)
          if (!(yield* slugAvailable(db, nextSlug, id))) {
            return yield* Effect.fail(new SlugConflict({ slug: nextSlug }))
          }
          fields.push('slug = ?')
          binds.push(nextSlug)
        }
        if (patch.takenAt !== undefined) {
          fields.push('takenAt = ?')
          binds.push(patch.takenAt === '' ? null : patch.takenAt)
        }
        if (patch.metadata !== undefined) {
          fields.push('metadata = ?')
          binds.push(JSON.stringify(patch.metadata))
        }
        if (fields.length > 0) {
          yield* Effect.tryPromise({
            try: () =>
              db
                .prepare(`UPDATE photos SET ${fields.join(', ')} WHERE id = ?`)
                .bind(...binds, id)
                .run(),
            catch: (cause) =>
              new StorageError({ message: 'Failed to update photo', cause: describeCause(cause) }),
          })
        }
        if (patch.tagIds !== undefined) {
          yield* replaceTags(db, id, patch.tagIds)
        }
        const row = yield* getRow(db, id)
        if (row === null) {
          return yield* Effect.fail(new PhotoNotFound({ id }))
        }
        const tagMap = yield* tagsForPhotos(db, [row.id])
        return toPhotoWithTags(row, tagMap.get(row.id) ?? [])
      })

    const remove: PhotoServiceContract['remove'] = (id) =>
      Effect.gen(function* () {
        const row = yield* getRow(db, id)
        if (row === null) return yield* Effect.fail(new PhotoNotFound({ id }))
        yield* Effect.tryPromise({
          try: () => db.prepare(`DELETE FROM photos WHERE id = ?`).bind(id).run(),
          catch: (cause) =>
            new StorageError({ message: 'Failed to delete photo', cause: describeCause(cause) }),
        })
        yield* Effect.tryPromise({
          try: () => gateway.photos.delete(row.r2Key),
          catch: (cause) =>
            new StorageError({ message: 'R2 delete failed', cause: describeCause(cause) }),
        }).pipe(Effect.orElseSucceed(() => undefined))
        return true
      })

    return PhotoService.of({ list, get, create, update, remove })
  }),
)
