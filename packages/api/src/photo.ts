/**
 * PhotoService — the Photo domain over D1 + R2 (see CONTEXT.md).
 * Essential queryable fields are columns; the rest lives in the JSON
 * `metadata` blob. Tags join through `photo_tags`.
 */

import { Context, DateTime, Effect, Layer, Schema as S } from 'effect'
import {
  DbPhotoRow,
  InvalidInput,
  PHOTO_STATUSES,
  PhotoNotFound,
  SlugConflict,
  StorageError,
  TagId,
  describeCause,
  nearestRatio,
  type PhotoRatio,
  type PhotoStatus,
  type PhotoWithTags,
  type Tag,
} from '@photo/shared'
import { Gateway } from './gateway'

// ---------------------------------------------------------------------------
// filters, sorts and results
// ---------------------------------------------------------------------------

/** The sortable keys, in the order the Table Head offers them. */
export const PHOTO_SORT_KEYS = ['takenAt'] as const
export type PhotoSortKey = (typeof PHOTO_SORT_KEYS)[number]
export type PhotoSortDirection = 'asc' | 'desc'

export interface PhotoSort {
  readonly key: PhotoSortKey
  readonly direction: PhotoSortDirection
}

/** `NEWEST FIRST` — what the Filter Bar's SORT select starts on. */
export const DEFAULT_SORT: PhotoSort = { key: 'takenAt', direction: 'desc' }

export interface PhotoListFilter {
  readonly status?: PhotoStatus | undefined
  readonly ratio?: PhotoRatio | undefined
  /** Any-of: a Photo carrying at least one of these Tags. */
  readonly tagIds?: ReadonlyArray<TagId | string> | undefined
  readonly q?: string | undefined
  /** Defaults to {@link DEFAULT_SORT}; the Table Head's `TAKEN ↓` is it. */
  readonly sort?: PhotoSort | undefined
  readonly cursor?: string | undefined
  readonly limit?: number | undefined
}

export interface PhotoListPage {
  readonly items: ReadonlyArray<PhotoWithTags>
  readonly nextCursor: string | null
}

export interface PhotoCounts {
  /** Every live Photo — the Filter Bar's `ALL`. */
  readonly total: number
  /** One entry per stored Status. `scheduled` is not a Status, so it has none. */
  readonly byStatus: Readonly<Record<PhotoStatus, number>>
  /** Every Tag with how many live Photos carry it. A count of 0 is a fact. */
  readonly byTag: ReadonlyArray<PhotoTagCount>
}

export interface PhotoTagCount {
  readonly id: TagId
  readonly label: string
  readonly count: number
}

export interface StorageUsage {
  /** Live Photos. Not `frames` — that is display copy (ADR 0008). */
  readonly photos: number
  /** Bytes those originals take, against the bucket cap. */
  readonly bytes: number
}

export interface PhotoUpdatePatch {
  readonly title?: string | undefined
  readonly slug?: string | undefined
  readonly takenAt?: string | undefined
  readonly metadata?: Record<string, unknown> | undefined
  readonly tagIds?: ReadonlyArray<string> | undefined
}

export interface CreatePhotoResult {
  readonly id: string
  readonly slug: string
  readonly r2Key: string
}

export interface CreatePhotoInput {
  readonly slug: string
  readonly title: string
  readonly r2Key: string
  readonly width: number
  readonly height: number
  readonly takenAt?: string | undefined
  /** The four EXIF facts extracted from the original's bytes. */
  readonly aperture?: number | undefined
  readonly shutter?: number | undefined
  readonly iso?: number | undefined
  readonly focalLength?: number | undefined
  readonly metadata: string
  /** Client-encoded placeholder hash; null for legacy uploads. */
  readonly blurhash?: string | undefined
  readonly contentType?: string | undefined
  readonly bytes: ArrayBuffer
  readonly tagIds: ReadonlyArray<string>
}

export interface PhotoServiceContract {
  /** Live Photos newest-first by default, filtered and keyset paginated. */
  readonly list: (
    filter: PhotoListFilter,
  ) => Effect.Effect<PhotoListPage, StorageError | InvalidInput>
  readonly get: (id: string) => Effect.Effect<PhotoWithTags, StorageError | PhotoNotFound>
  /** Insert the row, link the tags, then store the bytes. Used by upload. */
  readonly create: (
    input: CreatePhotoInput,
  ) => Effect.Effect<CreatePhotoResult, StorageError | SlugConflict>
  readonly update: (
    id: string,
    patch: PhotoUpdatePatch,
  ) => Effect.Effect<PhotoWithTags, StorageError | PhotoNotFound | SlugConflict>
  /** Publish and unpublish are this one call. The Status type is the guard;
   *  the column's CHECK is the backstop. */
  readonly setStatus: (
    id: string,
    status: PhotoStatus,
  ) => Effect.Effect<PhotoWithTags, StorageError | PhotoNotFound>
  /** Soft delete: stamps `deletedAt` and leaves R2 alone. Idempotent. */
  readonly trash: (id: string) => Effect.Effect<void, StorageError | PhotoNotFound>
  /** Clears `deletedAt`. R2 is never touched, so a restored Photo still has
   *  its original. Idempotent. */
  readonly restore: (id: string) => Effect.Effect<void, StorageError | PhotoNotFound>
  /** The irreversible one: drops the row, then the R2 object. Only a trashed
   *  Photo can be purged, so `Delete` in the Bulk Bar cannot skip the Trash. */
  readonly purge: (id: string) => Effect.Effect<void, StorageError | PhotoNotFound | InvalidInput>
  /** Per Status, per Tag and grand total, over live Photos only. */
  readonly counts: () => Effect.Effect<PhotoCounts, StorageError>
  /** The load-bearing aggregate: the frame count and byte total behind the
   *  sidebar meter, the Archive bar and the SIZE column. */
  readonly storageUsage: () => Effect.Effect<StorageUsage, StorageError>
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

/**
 * Every read is scoped to live Photos. The lifecycle operations address a row
 * whatever its `deletedAt` and say so where they do it, so a trashed Photo can
 * be restored or purged but can never leak out of a list, a count or a lookup.
 */
const LIVE = 'deletedAt IS NULL'

/** The Photo columns every read returns. One string, so `list` and `get`
 *  cannot disagree about the shape of a row. */
const PHOTO_COLUMNS =
  'id, slug, title, r2Key, width, height, status, number, ratio, bytes, aperture, shutter, iso, focalLength, takenAt, metadata, blurhash, deletedAt'

/**
 * LIKE reads `%` and `_` as wildcards, so a search for `100%` would otherwise
 * match every title containing "100" and `a_b` would match `aXb`.
 */
const escapeLike = (raw: string): string => raw.replace(/[\\%_]/g, (match) => `\\${match}`)

const parseMetadataObject = (raw: string | null): Record<string, unknown> | undefined => {
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// sorting and the keyset cursor
// ---------------------------------------------------------------------------

/**
 * A sortable column and how to read its value off a row. Keeping the two
 * together is what lets the ORDER BY and the keyset predicate be generated
 * from one list: a cursor that resumed on different columns than the query
 * ordered by would silently skip or repeat rows.
 */
interface SortColumn {
  readonly sql: string
  readonly value: (row: DbPhotoRow) => number | string | null
  /** Overrides the sort's own direction for this level. */
  readonly direction?: PhotoSortDirection
}

const columnDirection = (column: SortColumn, sort: PhotoSort): string =>
  column.direction ?? sort.direction

/**
 * The columns a sort is ordered by, most significant first. `id` closes every
 * sort: it is unique, so the order is total and a page boundary is exact.
 */
const SORTS: Record<PhotoSortKey, { readonly columns: ReadonlyArray<SortColumn> }> = {
  takenAt: {
    columns: [
      // Undated Photos sort last whichever way the rest is ordered, so this
      // level is ascending always and "no takenAt" never falls out of the
      // collation's hands as an empty string.
      {
        sql: '(takenAt IS NULL)',
        value: (row) => (row.takenAt === null ? 1 : 0),
        direction: 'asc',
      },
      { sql: "COALESCE(takenAt, '')", value: (row) => row.takenAt ?? '' },
      { sql: 'id', value: (row) => row.id },
    ],
  },
}

const sortLabel = (sort: PhotoSort): string => `${sort.key}:${sort.direction}`

export const orderBy = (sort: PhotoSort): string =>
  SORTS[sort.key].columns
    .map((column) => `${column.sql} ${columnDirection(column, sort)}`)
    .join(', ')

/**
 * The keyset predicate: "strictly past the cursor, in this order". Built from
 * the same columns as the ORDER BY — a lexicographic OR-chain over them — and
 * the values come out of the same walk, so a branch's placeholders and its
 * binds cannot drift apart.
 */
export const keysetWhere = (
  sort: PhotoSort,
  key: ReadonlyArray<number | string | null>,
): { readonly sql: string; readonly values: ReadonlyArray<number | string | null> } => {
  const columns = SORTS[sort.key].columns
  // Each branch parenthesised: `AND` binds tighter than `OR`, so the
  // lexicographic chain only reads as one if it is written down.
  const branches = columns.map((column, index) => {
    const sameAsCursor = columns.slice(0, index).map((earlier) => `${earlier.sql} = ?`)
    const comparison = columnDirection(column, sort) === 'asc' ? '>' : '<'
    return `(${[...sameAsCursor, `${column.sql} ${comparison} ?`].join(' AND ')})`
  })
  return {
    sql: `(${branches.join(' OR ')})`,
    // Branch `index` compares the first `index + 1` columns against the
    // cursor, and the query reads its placeholders left to right.
    values: columns.flatMap((_column, index) => key.slice(0, index + 1)),
  }
}

export interface PhotoCursor {
  /** The sort the page was cut under. A cursor is not resumable under another. */
  readonly sort: string
  readonly key: ReadonlyArray<number | string | null>
}

export const decodeCursor = (raw: string): PhotoCursor | null => {
  try {
    const json = atob(raw)
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null) return null
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- narrowing unknown JSON to record for cursor decode
    const record = parsed as Record<string, unknown>
    if (typeof record['sort'] !== 'string' || !Array.isArray(record['key'])) return null
    const key = record['key']
    if (
      !key.every((part) => part === null || typeof part === 'string' || typeof part === 'number')
    ) {
      return null
    }
    return { sort: record['sort'], key }
  } catch {
    return null
  }
}

export const encodeCursor = (row: DbPhotoRow, sort: PhotoSort): string =>
  btoa(
    JSON.stringify({
      sort: sortLabel(sort),
      key: SORTS[sort.key].columns.map((column) => column.value(row)),
    }),
  )

export const clampLimit = (input: number | undefined): number => {
  if (input === undefined || !Number.isFinite(input)) return 60
  return Math.min(Math.max(Math.floor(input), 1), 100)
}

// ---------------------------------------------------------------------------
// row reads
// ---------------------------------------------------------------------------

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
              `SELECT t.id, t.slug, t.label, t.caption, pt.photoId as photoId FROM tags t JOIN photo_tags pt ON pt.tagId = t.id WHERE pt.photoId IN (${placeholders}) ORDER BY t.label`,
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
        if (list) list.push({ id: row.id, slug: row.slug, label: row.label, caption: row.caption })
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
  status: row.status,
  number: row.number ?? undefined,
  ratio: row.ratio ?? undefined,
  bytes: row.bytes ?? undefined,
  takenAt: row.takenAt ?? undefined,
  aperture: row.aperture,
  shutter: row.shutter,
  iso: row.iso,
  focalLength: row.focalLength,
  metadata: parseMetadataObject(row.metadata),
  blurhash: row.blurhash ?? null,
  tags: [...tags],
})

/**
 * One row by id. `scope: 'live'` is the default every read path wants;
 * `scope: 'any'` is for the lifecycle operations, which have to find a Photo
 * the soft delete has already hidden.
 */
const rowById = (db: (typeof Gateway.Service)['db'], id: string, scope: 'live' | 'any' = 'live') =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () =>
        db
          .prepare(
            `SELECT ${PHOTO_COLUMNS} FROM photos WHERE id = ?${
              scope === 'live' ? ` AND ${LIVE}` : ''
            }`,
          )
          .bind(id)
          .first<DbPhotoRow>(),

      catch: (cause) =>
        new StorageError({ message: `Failed to get photo ${id}`, cause: describeCause(cause) }),
    })
    if (!raw) return null
    return raw
  })

/** The row with its Tags attached — what every read operation returns. */
const withTags = (db: (typeof Gateway.Service)['db'], row: DbPhotoRow) =>
  Effect.gen(function* () {
    const tagMap = yield* tagsForPhotos(db, [row.id])
    return toPhotoWithTags(row, tagMap.get(row.id) ?? [])
  })

const selectPhotoRows = (
  db: (typeof Gateway.Service)['db'],
  filter: PhotoListFilter,
  sort: PhotoSort,
  cursor: PhotoCursor | null,
): Effect.Effect<{ rows: ReadonlyArray<DbPhotoRow>; nextCursor: string | null }, StorageError> =>
  Effect.gen(function* () {
    const where: Array<string> = [LIVE]
    const binds: Array<string | number | null> = []
    if (filter.status !== undefined) {
      where.push('status = ?')
      binds.push(filter.status)
    }
    if (filter.ratio !== undefined) {
      where.push('ratio = ?')
      binds.push(filter.ratio)
    }
    const tagIds = filter.tagIds ?? []
    if (tagIds.length > 0) {
      const placeholders = tagIds.map(() => '?').join(', ')
      where.push(`id IN (SELECT photoId FROM photo_tags WHERE tagId IN (${placeholders}))`)
      binds.push(...tagIds)
    }
    const q = filter.q?.trim().slice(0, 120) ?? ''
    if (q !== '') {
      const needle = `%${escapeLike(q.toLowerCase())}%`
      where.push(
        `(LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(slug) LIKE ? ESCAPE '\\' OR LOWER(metadata) LIKE ? ESCAPE '\\')`,
      )
      binds.push(needle, needle, needle)
    }
    if (cursor !== null) {
      const keyset = keysetWhere(sort, cursor.key)
      where.push(keyset.sql)
      binds.push(...keyset.values)
    }
    const limit = clampLimit(filter.limit)
    const raw = yield* Effect.tryPromise({
      try: () =>
        db
          .prepare(
            `SELECT ${PHOTO_COLUMNS} FROM photos WHERE ${where.join(
              ' AND ',
            )} ORDER BY ${orderBy(sort)} LIMIT ?`,
          )
          .bind(...binds, String(limit))
          .all<DbPhotoRow>(),
      catch: (cause) =>
        new StorageError({ message: 'Failed to list photos', cause: describeCause(cause) }),
    })
    const rows = raw.results ?? []
    const nextCursor = rows.length === limit ? encodeCursor(rows[rows.length - 1]!, sort) : null
    return { rows, nextCursor }
  })

/** Replace a Photo's tag links. The delete and the inserts go in one batch so
 *  the links are never half-written. */
const linkTags = (
  db: (typeof Gateway.Service)['db'],
  photoId: string,
  tagIds: ReadonlyArray<string>,
) => [
  db.prepare(`DELETE FROM photo_tags WHERE photoId = ?`).bind(photoId),
  ...tagIds.map((tagId) =>
    db
      .prepare(`INSERT OR IGNORE INTO photo_tags (photoId, tagId) VALUES (?, ?)`)
      .bind(photoId, tagId),
  ),
]

/** A Photo's row and its links. `photo_tags` cascades in D1; the explicit
 *  delete keeps this correct on an engine with foreign keys off. */
const deletePhoto = (db: (typeof Gateway.Service)['db'], photoId: string) => [
  db.prepare(`DELETE FROM photo_tags WHERE photoId = ?`).bind(photoId),
  db.prepare(`DELETE FROM photos WHERE id = ?`).bind(photoId),
]

/** True when no other photo owns this slug. Trashed Photos are in scope: a
 *  slug stays taken while its Photo is in the Trash, or a restore could hand
 *  two Photos the same one. */
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

/**
 * Drops a row this call inserted, best effort. Keyed by id and never by
 * `r2Key`: the id is this Photo's, so a rollback can only ever undo itself.
 */
const dropRow = (db: (typeof Gateway.Service)['db'], id: string) =>
  Effect.tryPromise({
    try: () => db.batch(deletePhoto(db, id)),
    catch: () => undefined,
  }).pipe(Effect.orElseSucceed(() => undefined))

// ---------------------------------------------------------------------------
// aggregates
// ---------------------------------------------------------------------------

interface CountRow {
  readonly kind: 'status' | 'total' | 'tag'
  readonly key: string
  readonly label: string | null
  readonly n: number
}

/**
 * The three counts the sidebar and the Filter Bar need, in one statement and
 * one round trip. `kind` is the discriminator: the Status counts, the grand
 * total and the per-Tag counts have different key spaces, so a UNION keeps
 * them in one result rather than three queries.
 */
const COUNTS_SQL = `
  SELECT 'status' AS kind, status AS key, NULL AS label, COUNT(*) AS n
    FROM photos WHERE ${LIVE} GROUP BY status
  UNION ALL
  SELECT 'total', 'all', NULL, COUNT(*) FROM photos WHERE ${LIVE}
  UNION ALL
  SELECT 'tag', t.id, t.label, COUNT(p.id) AS n
    FROM tags t
    LEFT JOIN photo_tags pt ON pt.tagId = t.id
    LEFT JOIN photos p ON p.id = pt.photoId AND p.${LIVE}
   GROUP BY t.id, t.label
   ORDER BY t.label`

/** Every Status is present even with no Photos in it: a count of 0 is what the
 *  Filter Bar's segments are for, and an absent key would be a missing fact. */
const NO_STATUSES: Record<PhotoStatus, number> = { draft: 0, published: 0, failed: 0 }

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
        const sort = filter.sort ?? DEFAULT_SORT
        const cursor = filter.cursor === undefined ? null : decodeCursor(filter.cursor)
        // A cursor is a position in one particular order. Reusing it under
        // another is a caller bug, and silently answering with page one is how
        // a list ends up repeating rows. A key of the wrong length is the same
        // bug wearing a different hat — it would bind the wrong number of
        // placeholders and come back as a StorageError.
        if (
          cursor !== null &&
          (cursor.sort !== sortLabel(sort) || cursor.key.length !== SORTS[sort.key].columns.length)
        ) {
          return yield* Effect.fail(
            new InvalidInput({
              message: `cursor was cut under sort ${cursor.sort}, not ${sortLabel(sort)}`,
            }),
          )
        }
        const { rows, nextCursor } = yield* selectPhotoRows(db, filter, sort, cursor)
        const tagMap = yield* tagsForPhotos(
          db,
          rows.map((row) => row.id),
        )
        const items = rows.map((row) => toPhotoWithTags(row, tagMap.get(row.id) ?? []))
        return { items, nextCursor }
      })

    const get: PhotoServiceContract['get'] = (id) =>
      Effect.gen(function* () {
        const row = yield* rowById(db, id)
        if (row === null) return yield* Effect.fail(new PhotoNotFound({ id }))
        return yield* withTags(db, row)
      })

    const create: PhotoServiceContract['create'] = (input) =>
      Effect.gen(function* () {
        let slug = slugify(input.slug)
        if (!(yield* slugAvailable(db, slug))) {
          // deterministic suffix keeps retries stable without a second round-trip
          slug = `${slug}-${crypto.randomUUID().slice(0, 8)}`
        }
        const id = crypto.randomUUID()
        const contentType = input.contentType ?? 'image/jpeg'
        // The row, its Photo Number and its tag links land in one transaction.
        //
        // D1 has no sequences, so the number comes from the counter row, and
        // the counter is bumped in the same transaction that spends it: a
        // read-then-write hands two concurrent uploads the same serial, and
        // `idx_photos_number` turns that into a failed upload. The counter
        // lives outside `photos` (migration 0006) because a purge deletes the
        // row a `MAX` would have read, and a Photo Number is never reused.
        //
        // `status` is left to the column default: a Photo is published on
        // arrival, which is what the backfill does and what #14 asserts.
        yield* Effect.tryPromise({
          try: () =>
            db.batch([
              db.prepare(`UPDATE photo_number_counter SET value = value + 1 WHERE id = 1`),
              db
                .prepare(
                  `INSERT INTO photos (id, slug, title, r2Key, width, height, number, ratio, bytes, mime,
                           aperture, shutter, iso, focalLength, takenAt, metadata, blurhash)
                   VALUES (?, ?, ?, ?, ?, ?,
                           (SELECT value FROM photo_number_counter WHERE id = 1),
                           ?, ?, ?,
                           ?, ?, ?, ?, ?, ?, ?)`,
                )
                .bind(
                  id,
                  slug,
                  input.title,
                  input.r2Key,
                  input.width,
                  input.height,
                  nearestRatio(input.width, input.height),
                  input.bytes.byteLength,
                  contentType,
                  input.aperture ?? null,
                  input.shutter ?? null,
                  input.iso ?? null,
                  input.focalLength ?? null,
                  input.takenAt ?? null,
                  input.metadata,
                  input.blurhash ?? null,
                ),
              ...linkTags(db, id, input.tagIds),
            ]),
          catch: (cause) =>
            new StorageError({ message: 'Failed to insert photo', cause: describeCause(cause) }),
        })
        // R2 after the row, never before it. A duplicate r2Key now fails the
        // insert, which leaves the pre-existing Photo's original untouched;
        // a failed put takes the new row back down with it, so no row is ever
        // left pointing at bytes that are not there.
        yield* Effect.tryPromise({
          try: () =>
            gateway.photos.put(input.r2Key, input.bytes, { httpMetadata: { contentType } }),
          catch: (cause) =>
            new StorageError({
              message: 'Failed to store original in R2',
              cause: describeCause(cause),
            }),
        }).pipe(Effect.tapError(() => dropRow(db, id)))

        return { id, slug, r2Key: input.r2Key }
      })

    const update: PhotoServiceContract['update'] = (id, patch) =>
      Effect.gen(function* () {
        if ((yield* rowById(db, id)) === null) {
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
        // Columns and tag links in one batch, which D1 runs as one
        // transaction: a tag insert that fails must not leave the row
        // half-updated.
        const statements = [
          ...(fields.length > 0
            ? [db.prepare(`UPDATE photos SET ${fields.join(', ')} WHERE id = ?`).bind(...binds, id)]
            : []),
          ...(patch.tagIds === undefined ? [] : linkTags(db, id, patch.tagIds)),
        ]
        if (statements.length > 0) {
          yield* Effect.tryPromise({
            try: () => db.batch(statements),
            catch: (cause) =>
              new StorageError({ message: 'Failed to update photo', cause: describeCause(cause) }),
          })
        }
        const row = yield* rowById(db, id)
        if (row === null) {
          return yield* Effect.fail(new PhotoNotFound({ id }))
        }
        return yield* withTags(db, row)
      })

    const setStatus: PhotoServiceContract['setStatus'] = (id, status) =>
      Effect.gen(function* () {
        if ((yield* rowById(db, id)) === null) {
          return yield* Effect.fail(new PhotoNotFound({ id }))
        }
        yield* Effect.tryPromise({
          try: () => db.prepare(`UPDATE photos SET status = ? WHERE id = ?`).bind(status, id).run(),
          catch: (cause) =>
            new StorageError({
              message: 'Failed to set photo status',
              cause: describeCause(cause),
            }),
        })
        const row = yield* rowById(db, id)
        if (row === null) {
          return yield* Effect.fail(new PhotoNotFound({ id }))
        }
        return yield* withTags(db, row)
      })

    const trash: PhotoServiceContract['trash'] = (id) =>
      Effect.gen(function* () {
        // Any row, live or not: trashing a trashed Photo is the end state it
        // is already in, and re-stamping the date would make the Trash's
        // ordering depend on how many times it was clicked.
        const row = yield* rowById(db, id, 'any')
        if (row === null) return yield* Effect.fail(new PhotoNotFound({ id }))
        if (row.deletedAt !== null) return
        yield* Effect.tryPromise({
          try: () =>
            db
              .prepare(`UPDATE photos SET deletedAt = ? WHERE id = ? AND ${LIVE}`)
              // `YYYY-MM-DD`, the format #14 gives `deletedAt` and `takenAt`.
              .bind(DateTime.formatIsoDateUtc(DateTime.nowUnsafe()), id)
              .run(),
          catch: (cause) =>
            new StorageError({ message: 'Failed to trash photo', cause: describeCause(cause) }),
        })
      })

    const restore: PhotoServiceContract['restore'] = (id) =>
      Effect.gen(function* () {
        const row = yield* rowById(db, id, 'any')
        if (row === null) return yield* Effect.fail(new PhotoNotFound({ id }))
        if (row.deletedAt === null) return
        yield* Effect.tryPromise({
          try: () => db.prepare(`UPDATE photos SET deletedAt = NULL WHERE id = ?`).bind(id).run(),
          catch: (cause) =>
            new StorageError({ message: 'Failed to restore photo', cause: describeCause(cause) }),
        })
      })

    const purge: PhotoServiceContract['purge'] = (id) =>
      Effect.gen(function* () {
        const row = yield* rowById(db, id, 'any')
        if (row === null) return yield* Effect.fail(new PhotoNotFound({ id }))
        if (row.deletedAt === null) {
          return yield* Effect.fail(
            new InvalidInput({ message: 'only a trashed photo can be purged' }),
          )
        }
        yield* Effect.tryPromise({
          try: () => db.batch(deletePhoto(db, id)),
          catch: (cause) =>
            new StorageError({ message: 'Failed to purge photo', cause: describeCause(cause) }),
        })
        yield* Effect.tryPromise({
          try: () => gateway.photos.delete(row.r2Key),
          catch: (cause) =>
            new StorageError({ message: 'R2 delete failed', cause: describeCause(cause) }),
        }).pipe(Effect.orElseSucceed(() => undefined))
      })

    const counts: PhotoServiceContract['counts'] = () =>
      Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: () => db.prepare(COUNTS_SQL).all<CountRow>(),
          catch: (cause) =>
            new StorageError({ message: 'Failed to count photos', cause: describeCause(cause) }),
        })
        const byStatus: Record<PhotoStatus, number> = { ...NO_STATUSES }
        const byTag: Array<PhotoTagCount> = []
        let total = 0
        const rows = raw.results ?? []
        for (const status of PHOTO_STATUSES) {
          const row = rows.find(
            (candidate) => candidate.kind === 'status' && candidate.key === status,
          )
          if (row !== undefined) byStatus[status] = row.n
        }
        for (const row of rows) {
          if (row.kind === 'total') {
            total = row.n
          } else if (row.kind === 'tag') {
            byTag.push({
              id: S.decodeSync(TagId)(row.key),
              label: row.label ?? '',
              count: row.n,
            })
          }
        }
        return { total, byStatus, byTag }
      })

    const storageUsage: PhotoServiceContract['storageUsage'] = () =>
      Effect.tryPromise({
        try: () =>
          db
            .prepare(
              `SELECT COUNT(*) AS photos, COALESCE(SUM(bytes), 0) AS bytes FROM photos WHERE ${LIVE}`,
            )
            .first<{ photos: number; bytes: number }>(),
        catch: (cause) =>
          new StorageError({
            message: 'Failed to read storage usage',
            cause: describeCause(cause),
          }),
      }).pipe(Effect.map((row) => ({ photos: row?.photos ?? 0, bytes: row?.bytes ?? 0 })))

    return PhotoService.of({
      list,
      get,
      create,
      update,
      setStatus,
      trash,
      restore,
      purge,
      counts,
      storageUsage,
    })
  }),
)
