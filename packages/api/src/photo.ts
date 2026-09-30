/**
 * PhotoService — the Photo domain over D1 + R2 (see CONTEXT.md).
 * Essential queryable fields are columns; the rest lives in the JSON
 * `metadata` blob. Tags join through `photo_tags`.
 */

import { Context, DateTime, Effect, Layer, Schema as S } from 'effect'
import {
  DbPhotoRow,
  InvalidInput,
  MatColour,
  MatStyle,
  PHOTO_STATUSES,
  PhotoIndexRow,
  PhotoNotFound,
  PhotoPresentation,
  RenditionFormat,
  SlugConflict,
  StorageError,
  TagId,
  describeCause,
  formatMeasuredRatio,
  nearestRatio,
  PhotoRatio,
  type PhotoStatus,
  type PhotoWithTags,
  type Tag,
} from '@photo/shared'
import { Gateway } from './gateway'

// The bucket cap is a configured constant, not a Settings row, and it is
// single-sourced in `@photo/shared` because the RPC contract and the view that
// renders the meter both need it. It is re-exported here so the module that
// measures storage usage is where anything reaching for the cap looks first.
export { STORAGE_CAP_BYTES } from '@photo/shared'

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
  /** Every trashed Photo. The only count not over live Photos, and the only
   *  one that can be: the Trash is out of every list the others read. */
  readonly trashed: number
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

/** The authored presentation, in the four groups the Editor edits it in. Every
 *  group is optional and only the supplied columns are written, so one group
 *  can be saved without restating the other three. A `null` clears its column
 *  — `level` and the three mat details are nullable, and null is un-levelled
 *  rather than zero — where an absent key leaves the column alone. */
export interface PhotoPresentationPatch {
  readonly crop?: { readonly x: number; readonly y: number; readonly scale: number } | undefined
  readonly level?: number | null | undefined
  readonly mat?:
    | {
        readonly enabled: boolean
        readonly style?: MatStyle | null | undefined
        readonly colour?: MatColour | null | undefined
        readonly width?: number | null | undefined
      }
    | undefined
  readonly export?:
    | {
        readonly previewLongEdge?: number | undefined
        readonly previewFormat?: RenditionFormat | undefined
        readonly previewQuality?: number | undefined
        readonly fullQuality?: number | undefined
        readonly keepExif?: boolean | undefined
        readonly removeGps?: boolean | undefined
      }
    | undefined
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
  /** Where the new Photo starts in the publish lifecycle. Absent means the
   *  column default (`published`); the Upload dialog's `Publish when ready`
   *  off-state passes `draft`. This is the one place the service defaults it —
   *  the dialog's own default is `draft`. */
  readonly status?: PhotoStatus | undefined
  /** The six export columns a new upload is seeded from. Absent leaves the
   *  schema defaults (migration 0004) in place; the Upload dialog's `Use
   *  export defaults` sends the Settings singleton's values instead. */
  readonly exportDefaults?: PhotoExportDefaults | undefined
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

/** The export columns a Photo is created with: what `Use export defaults`
 *  seeds from the Settings singleton. One value rather than six arguments so
 *  the `CreatePhotoInput` field and the insert cannot disagree about the set. */
export interface PhotoExportDefaults {
  readonly previewLongEdge: number
  readonly previewFormat: RenditionFormat
  readonly previewQuality: number
  readonly fullQuality: number
  readonly keepExif: boolean
  readonly removeGps: boolean
}

export interface PhotoServiceContract {
  /** Live Photos newest-first by default, filtered and keyset paginated. */
  readonly list: (
    filter: PhotoListFilter,
  ) => Effect.Effect<PhotoListPage, StorageError | InvalidInput>
  /** How many live Photos `filter` selects, across the whole result set and
   *  not just one page — the `OF 412` in the Library's Pager. The cursor is
   *  ignored: a cursor is a position in one ordering, not a filter, so the
   *  number is the same on every page of the same filter. */
  readonly count: (filter: PhotoListFilter) => Effect.Effect<number, StorageError>
  readonly get: (id: string) => Effect.Effect<PhotoWithTags, StorageError | PhotoNotFound>
  /** Insert the row, link the tags, then store the bytes. Used by upload.
   *  The measured frame is snapped to the nearest supported Ratio first; a
   *  frame matching none of the six is refused with its measured proportion
   *  in the message and nothing is written to D1 or R2. */
  readonly create: (
    input: CreatePhotoInput,
  ) => Effect.Effect<CreatePhotoResult, StorageError | SlugConflict | InvalidInput>
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
  /** Per Status, per Tag, grand total and trashed total, in one read. */
  readonly counts: () => Effect.Effect<PhotoCounts, StorageError>
  /** Every live Photo as the Storage block's CSV index reads it: Photo Number
   *  order, tags resolved, place out of the metadata blob. */
  readonly index: () => Effect.Effect<ReadonlyArray<PhotoIndexRow>, StorageError>
  /** The load-bearing aggregate: the frame count and byte total behind the
   *  sidebar meter, the Archive bar and the SIZE column. */
  readonly storageUsage: () => Effect.Effect<StorageUsage, StorageError>
  /** The Editor's loaded snapshot: one Photo's whole Presentation as stored, or
   *  `PhotoNotFound` for a Photo that is gone or in the Trash. `setPresentation`
   *  returns this shape too, so the snapshot a save produces and the one a
   *  cold load produces are the same value. */
  readonly presentation: (
    id: string,
  ) => Effect.Effect<PhotoPresentation, StorageError | PhotoNotFound>
  /** Write the supplied presentation columns, then read the whole presentation
   *  back: a save answers with the stored truth, not with the patch. */
  readonly setPresentation: (
    id: string,
    patch: PhotoPresentationPatch,
  ) => Effect.Effect<PhotoPresentation, StorageError | PhotoNotFound | InvalidInput>
  /** Link Tags to Photos. The one set-shaped write with no per-Photo rule, so
   *  it is one statement rather than a fold over `update`. Idempotent. An id
   *  that resolves to no live Photo is `PhotoNotFound`; a Tag id that resolves
   *  to no Tag is `InvalidInput`. */
  readonly addTags: (
    photoIds: ReadonlyArray<string>,
    tagIds: ReadonlyArray<string>,
  ) => Effect.Effect<void, StorageError | PhotoNotFound | InvalidInput>
  /** The counterpart, for a row's tags. Idempotent, and the same two id
   *  checks. */
  readonly removeTags: (
    photoIds: ReadonlyArray<string>,
    tagIds: ReadonlyArray<string>,
  ) => Effect.Effect<void, StorageError | PhotoNotFound | InvalidInput>
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

/** Split an id list into bind-sized pieces. D1 caps a statement's bind list,
 *  so every `IN (...)` over more than a handful of ids goes through this. */
const chunkOf = (ids: ReadonlyArray<string>, size: number): ReadonlyArray<ReadonlyArray<string>> =>
  Array.from({ length: Math.ceil(ids.length / size) }, (_unused, index) =>
    ids.slice(index * size, (index + 1) * size),
  )

/**
 * Every read is scoped to live Photos. The lifecycle operations address a row
 * whatever its `deletedAt` and say so where they do it, so a trashed Photo can
 * be restored or purged but can never leak out of a list, a count or a lookup.
 */
const LIVE = 'deletedAt IS NULL'

/** The Photo columns every read returns. One string, so `list` and `get`
 *  cannot disagree about the shape of a row — and so the public read model in
 *  `public-photo.ts` selects the same row this one does. */
export const PHOTO_COLUMNS =
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

export const tagsForPhotos = (db: (typeof Gateway.Service)['db'], ids: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const map = new Map<string, Array<Tag>>()
    for (const id of ids) map.set(id, [])
    if (ids.length === 0) return new Map<string, ReadonlyArray<Tag>>()

    // Chunk IN lists to stay well under D1's ~100 bind limit
    for (const chunk of chunkOf(ids, 80)) {
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

export const toPhotoWithTags = (row: DbPhotoRow, tags: ReadonlyArray<Tag>): PhotoWithTags => ({
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

// ---------------------------------------------------------------------------
// presentation
// ---------------------------------------------------------------------------

/** The presentation columns migration 0004 added, in one string so the write
 *  and the read-back can never name different columns. */
const PRESENTATION_COLUMNS =
  'cropX, cropY, cropScale, level, borderEnabled, borderStyle, borderColour, borderWidth, previewLongEdge, previewFormat, previewQuality, fullQuality, keepExif, removeGps'

/** SQLite hands booleans back as the 0/1 the columns are declared with. */
interface DbPresentationRow {
  readonly cropX: number
  readonly cropY: number
  readonly cropScale: number
  readonly level: number | null
  readonly borderEnabled: number
  readonly borderStyle: MatStyle | null
  readonly borderColour: MatColour | null
  readonly borderWidth: number | null
  readonly previewLongEdge: number
  readonly previewFormat: RenditionFormat
  readonly previewQuality: number
  readonly fullQuality: number
  readonly keepExif: number
  readonly removeGps: number
}

const toPhotoPresentation = (row: DbPresentationRow): PhotoPresentation => ({
  cropX: row.cropX,
  cropY: row.cropY,
  cropScale: row.cropScale,
  level: row.level,
  borderEnabled: row.borderEnabled !== 0,
  borderStyle: row.borderStyle,
  borderColour: row.borderColour,
  borderWidth: row.borderWidth,
  previewLongEdge: row.previewLongEdge,
  previewFormat: row.previewFormat,
  previewQuality: row.previewQuality,
  fullQuality: row.fullQuality,
  keepExif: row.keepExif !== 0,
  removeGps: row.removeGps !== 0,
})

const presentationRow = (db: (typeof Gateway.Service)['db'], id: string) =>
  Effect.tryPromise({
    try: () =>
      db
        .prepare(`SELECT ${PRESENTATION_COLUMNS} FROM photos WHERE id = ? AND ${LIVE}`)
        .bind(id)
        .first<DbPresentationRow>(),
    catch: (cause) =>
      new StorageError({
        message: `Failed to get presentation for photo ${id}`,
        cause: describeCause(cause),
      }),
  })

/** Only the supplied columns, in the order the four groups are named. An empty
 *  result is an empty patch, which is an error rather than a no-op UPDATE. */
const presentationColumns = (
  patch: PhotoPresentationPatch,
): { fields: Array<string>; binds: Array<unknown> } => {
  const fields: Array<string> = []
  const binds: Array<unknown> = []
  const set = (column: string, value: unknown): void => {
    fields.push(`${column} = ?`)
    binds.push(value)
  }
  if (patch.crop !== undefined) {
    set('cropX', patch.crop.x)
    set('cropY', patch.crop.y)
    set('cropScale', patch.crop.scale)
  }
  if (patch.level !== undefined) set('level', patch.level)
  if (patch.mat !== undefined) {
    set('borderEnabled', patch.mat.enabled ? 1 : 0)
    if (patch.mat.style !== undefined) set('borderStyle', patch.mat.style)
    if (patch.mat.colour !== undefined) set('borderColour', patch.mat.colour)
    if (patch.mat.width !== undefined) set('borderWidth', patch.mat.width)
  }
  if (patch.export !== undefined) {
    const settings = patch.export
    if (settings.previewLongEdge !== undefined) set('previewLongEdge', settings.previewLongEdge)
    if (settings.previewFormat !== undefined) set('previewFormat', settings.previewFormat)
    if (settings.previewQuality !== undefined) set('previewQuality', settings.previewQuality)
    if (settings.fullQuality !== undefined) set('fullQuality', settings.fullQuality)
    if (settings.keepExif !== undefined) set('keepExif', settings.keepExif ? 1 : 0)
    if (settings.removeGps !== undefined) set('removeGps', settings.removeGps ? 1 : 0)
  }
  return { fields, binds }
}

// ---------------------------------------------------------------------------
// set-shaped tag links
// ---------------------------------------------------------------------------

/** D1's bind list is the limit, not the id count: a tag-link statement binds
 *  the Photo ids it selects and the Tag id it links them to. */
export const LINK_BIND_BUDGET = 80

/** A link statement names one `tagId` and binds the Photo ids it selects, so
 *  the chunk size is the budget less the bind the tag takes. */
const linkPhotoChunks = (photoIds: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> =>
  chunkOf(photoIds, LINK_BIND_BUDGET - 1)

/** An unknown id is a failure rather than a silent no-op, so a Bulk Bar move
 *  over a stale selection cannot report success for a Photo that is gone. */
const assertLivePhotos = (db: (typeof Gateway.Service)['db'], photoIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const found = new Set<string>()
    for (const chunk of chunkOf(photoIds, LINK_BIND_BUDGET)) {
      const placeholders = chunk.map(() => '?').join(', ')
      const raw = yield* Effect.tryPromise({
        try: () =>
          db
            .prepare(`SELECT id FROM photos WHERE ${LIVE} AND id IN (${placeholders})`)
            .bind(...chunk)
            .all<{ id: string }>(),
        catch: (cause) =>
          new StorageError({ message: 'Failed to check photos', cause: describeCause(cause) }),
      })
      for (const row of raw.results ?? []) found.add(row.id)
    }
    const missing = photoIds.find((id) => !found.has(id))
    if (missing !== undefined) return yield* Effect.fail(new PhotoNotFound({ id: missing }))
  })

/** A Tag id nobody carries is `InvalidInput` rather than a storage failure.
 *  `photo_tags.tagId` is a foreign key and `INSERT OR IGNORE` does not suppress
 *  a foreign-key violation, so without this the batch dies on the stale id and
 *  the operator is told D1 is broken. The whole set is one batch, so without
 *  the check ahead of it a single stale Tag rolls back every good link in the
 *  call. */
const assertTagsExist = (db: (typeof Gateway.Service)['db'], tagIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const found = new Set<string>()
    for (const chunk of chunkOf(tagIds, LINK_BIND_BUDGET)) {
      const placeholders = chunk.map(() => '?').join(', ')
      const raw = yield* Effect.tryPromise({
        try: () =>
          db
            .prepare(`SELECT id FROM tags WHERE id IN (${placeholders})`)
            .bind(...chunk)
            .all<{ id: string }>(),
        catch: (cause) =>
          new StorageError({ message: 'Failed to check tags', cause: describeCause(cause) }),
      })
      for (const row of raw.results ?? []) found.add(row.id)
    }
    const missing = tagIds.find((id) => !found.has(id))
    if (missing !== undefined) {
      return yield* Effect.fail(new InvalidInput({ message: `no tag with id ${missing}` }))
    }
  })

/**
 * The filters, and only the filters: the predicates that decide which Photos a
 * filter selects, with their binds in the order the query reads them.
 *
 * The audience predicate is not here — live for `PhotoService`, published for
 * the public read model, and each caller owns it. Nor is the keyset: a cursor
 * is a position in one ordering rather than a filter, so it must never be part
 * of a count. That leaves the row query and the count query reading the same
 * filters, which is the whole point of it being one function.
 */
export const filterWhere = (
  filter: PhotoListFilter,
): { readonly sql: string; readonly binds: ReadonlyArray<string | number | null> } => {
  const clauses: Array<string> = []
  const binds: Array<string | number | null> = []
  if (filter.status !== undefined) {
    clauses.push('status = ?')
    binds.push(filter.status)
  }
  if (filter.ratio !== undefined) {
    clauses.push('ratio = ?')
    binds.push(filter.ratio)
  }
  const tagIds = filter.tagIds ?? []
  if (tagIds.length > 0) {
    const placeholders = tagIds.map(() => '?').join(', ')
    clauses.push(`id IN (SELECT photoId FROM photo_tags WHERE tagId IN (${placeholders}))`)
    binds.push(...tagIds)
  }
  const q = filter.q?.trim().slice(0, 120) ?? ''
  if (q !== '') {
    const needle = `%${escapeLike(q.toLowerCase())}%`
    clauses.push(
      `(LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(slug) LIKE ? ESCAPE '\\' OR LOWER(metadata) LIKE ? ESCAPE '\\')`,
    )
    binds.push(needle, needle, needle)
  }
  return { sql: clauses.join(' AND '), binds }
}

/** The audience predicate AND the filters. An unfiltered query is the
 *  predicate on its own rather than a dangling `AND`. */
const andFilter = (predicate: string, filterSql: string): string =>
  filterSql === '' ? predicate : `${predicate} AND ${filterSql}`

const selectPhotoRows = (
  db: (typeof Gateway.Service)['db'],
  predicate: string,
  filter: PhotoListFilter,
  sort: PhotoSort,
  cursor: PhotoCursor | null,
): Effect.Effect<{ rows: ReadonlyArray<DbPhotoRow>; nextCursor: string | null }, StorageError> =>
  Effect.gen(function* () {
    const filters = filterWhere(filter)
    const where: Array<string> = [andFilter(predicate, filters.sql)]
    const binds: Array<string | number | null> = [...filters.binds]
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

/**
 * The paging half of every Photo list, over whichever audience predicate the
 * caller owns.
 *
 * `PhotoService` pages live Photos; the public read model pages published ones
 * with the same keyset cursor, the same LIKE escaping, the same clamp and the
 * same check that a cursor was cut under the sort it claims. The filters, the
 * ORDER BY and the cursor predicate are one thing here rather than two
 * hand-kept copies that can start paging differently.
 */
export const pagePhotos = (
  db: (typeof Gateway.Service)['db'],
  predicate: string,
  filter: PhotoListFilter,
): Effect.Effect<
  { rows: ReadonlyArray<DbPhotoRow>; nextCursor: string | null },
  StorageError | InvalidInput
> =>
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
    return yield* selectPhotoRows(db, predicate, filter, sort, cursor)
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
 * The counts the sidebar and the Filter Bar need, in one statement and one
 * round trip. `kind` is the discriminator: the Status counts, the grand
 * total, the trashed total and the per-Tag counts have different key spaces,
 * so a UNION keeps them in one result rather than four queries.
 */
const COUNTS_SQL = `
  SELECT 'status' AS kind, status AS key, NULL AS label, COUNT(*) AS n
    FROM photos WHERE ${LIVE} GROUP BY status
  UNION ALL
  SELECT 'total', 'all', NULL, COUNT(*) FROM photos WHERE ${LIVE}
  UNION ALL
  SELECT 'total', 'trashed', NULL, COUNT(*) FROM photos WHERE deletedAt IS NOT NULL
  UNION ALL
  SELECT 'tag', t.id, t.label, COUNT(p.id) AS n
    FROM tags t
    LEFT JOIN photo_tags pt ON pt.tagId = t.id
    LEFT JOIN photos p ON p.id = pt.photoId AND p.${LIVE}
   GROUP BY t.id, t.label
   ORDER BY t.label`

/** The row the CSV index reads, plus the two columns it needs but does not
 *  name: `id` keys the tag join, and the place is in the metadata blob. */
interface DbPhotoIndexRow {
  readonly id: string
  readonly number: number | null
  readonly title: string
  readonly slug: string
  readonly ratio: string | null
  readonly takenAt: string | null
  readonly bytes: number | null
  readonly metadata: string | null
}

/** Photo Number is the site's serial, so the index is a serial-ordered list and
 *  a Photo nobody numbered sorts last rather than first. `id` closes the order
 *  the way it closes every other sort here. */
const INDEX_ORDER = '(number IS NULL) ASC, number ASC, id ASC'

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
        const { rows, nextCursor } = yield* pagePhotos(db, LIVE, filter)
        const tagMap = yield* tagsForPhotos(
          db,
          rows.map((row) => row.id),
        )
        const items = rows.map((row) => toPhotoWithTags(row, tagMap.get(row.id) ?? []))
        return { items, nextCursor }
      })

    // The Pager's `OF 412`. Same predicate, same `filterWhere` as the row
    // query, no keyset and no LIMIT — a count taken over one page would
    // answer a question nobody asked.
    const count: PhotoServiceContract['count'] = (filter) =>
      Effect.gen(function* () {
        const { sql, binds } = filterWhere(filter)
        const row = yield* Effect.tryPromise({
          try: () =>
            db
              .prepare(`SELECT COUNT(*) AS n FROM photos WHERE ${andFilter(LIVE, sql)}`)
              .bind(...binds)
              .first<{ n: number }>(),
          catch: (cause) =>
            new StorageError({
              message: 'Failed to count filtered photos',
              cause: describeCause(cause),
            }),
        })
        return row?.n ?? 0
      })

    const get: PhotoServiceContract['get'] = (id) =>
      Effect.gen(function* () {
        const row = yield* rowById(db, id)
        if (row === null) return yield* Effect.fail(new PhotoNotFound({ id }))
        return yield* withTags(db, row)
      })

    const create: PhotoServiceContract['create'] = (input) =>
      Effect.gen(function* () {
        // Ratio first, before the slug, the row or the bytes: a frame matching
        // none of the six is refused here, so a rejected upload costs zero
        // storage and never reaches R2. The message names the frame's measured
        // proportion, which is what the failed Upload Item prints.
        const ratio = nearestRatio(input.width, input.height)
        if (ratio === null) {
          return yield* Effect.fail(
            new InvalidInput({
              message: `Unsupported ratio ${formatMeasuredRatio(input.width, input.height)}`,
            }),
          )
        }
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
        // `status` and the export columns are only listed when the caller
        // supplied them; otherwise the migration's column defaults apply, which
        // is what every `create` that is not the Upload dialog relies on.
        const columns = [
          'id',
          'slug',
          'title',
          'r2Key',
          'width',
          'height',
          'number',
          'ratio',
          'bytes',
          'mime',
          'aperture',
          'shutter',
          'iso',
          'focalLength',
          'takenAt',
          'metadata',
          'blurhash',
        ]
        const values = [
          '?',
          '?',
          '?',
          '?',
          '?',
          '?',
          '(SELECT value FROM photo_number_counter WHERE id = 1)',
          '?',
          '?',
          '?',
          '?',
          '?',
          '?',
          '?',
          '?',
          '?',
          '?',
        ]
        const binds: Array<unknown> = [
          id,
          slug,
          input.title,
          input.r2Key,
          input.width,
          input.height,
          ratio,
          input.bytes.byteLength,
          contentType,
          input.aperture ?? null,
          input.shutter ?? null,
          input.iso ?? null,
          input.focalLength ?? null,
          input.takenAt ?? null,
          input.metadata,
          input.blurhash ?? null,
        ]
        if (input.status !== undefined) {
          columns.push('status')
          values.push('?')
          binds.push(input.status)
        }
        if (input.exportDefaults !== undefined) {
          const exportDefaults = input.exportDefaults
          columns.push(
            'previewLongEdge',
            'previewFormat',
            'previewQuality',
            'fullQuality',
            'keepExif',
            'removeGps',
          )
          values.push('?', '?', '?', '?', '?', '?')
          binds.push(
            exportDefaults.previewLongEdge,
            exportDefaults.previewFormat,
            exportDefaults.previewQuality,
            exportDefaults.fullQuality,
            exportDefaults.keepExif ? 1 : 0,
            exportDefaults.removeGps ? 1 : 0,
          )
        }
        yield* Effect.tryPromise({
          try: () =>
            db.batch([
              db.prepare(`UPDATE photo_number_counter SET value = value + 1 WHERE id = 1`),
              db
                .prepare(`INSERT INTO photos (${columns.join(', ')}) VALUES (${values.join(', ')})`)
                .bind(...binds),
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
        let trashed = 0
        const rows = raw.results ?? []
        for (const status of PHOTO_STATUSES) {
          const row = rows.find(
            (candidate) => candidate.kind === 'status' && candidate.key === status,
          )
          if (row !== undefined) byStatus[status] = row.n
        }
        for (const row of rows) {
          if (row.kind === 'total') {
            if (row.key === 'trashed') trashed = row.n
            else total = row.n
          } else if (row.kind === 'tag') {
            byTag.push({
              id: S.decodeSync(TagId)(row.key),
              label: row.label ?? '',
              count: row.n,
            })
          }
        }
        return { total, trashed, byStatus, byTag }
      })

    const index: PhotoServiceContract['index'] = () =>
      Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: () =>
            db
              .prepare(
                `SELECT id, number, title, slug, ratio, takenAt, bytes, metadata
                   FROM photos WHERE ${LIVE} ORDER BY ${INDEX_ORDER}`,
              )
              .all<DbPhotoIndexRow>(),
          catch: (cause) =>
            new StorageError({
              message: 'Failed to read the photo index',
              cause: describeCause(cause),
            }),
        })
        const rows = raw.results ?? []
        const tagMap = yield* tagsForPhotos(
          db,
          rows.map((row) => row.id),
        )
        return rows.map((row) => {
          const location = parseMetadataObject(row.metadata)?.['location']
          return {
            number: row.number,
            title: row.title,
            slug: row.slug,
            ratio: row.ratio === null ? null : S.decodeUnknownSync(PhotoRatio)(row.ratio),
            takenAt: row.takenAt,
            place: typeof location === 'string' ? location : null,
            tags: (tagMap.get(row.id) ?? []).map((tag) => tag.label),
            bytes: row.bytes,
          }
        })
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

    const presentation: PhotoServiceContract['presentation'] = (id) =>
      Effect.gen(function* () {
        // The read is scoped to live Photos, exactly as the write is: a
        // trashed Photo has a stored Presentation, and the Editor is not where
        // the Trash is edited.
        const row = yield* presentationRow(db, id)
        if (row === null) return yield* Effect.fail(new PhotoNotFound({ id }))
        return toPhotoPresentation(row)
      })

    const setPresentation: PhotoServiceContract['setPresentation'] = (id, patch) =>
      Effect.gen(function* () {
        if ((yield* rowById(db, id)) === null) {
          return yield* Effect.fail(new PhotoNotFound({ id }))
        }
        const { fields, binds } = presentationColumns(patch)
        if (fields.length === 0) {
          return yield* Effect.fail(new InvalidInput({ message: 'empty presentation patch' }))
        }
        // The column carries no CHECK, and a crop scale of zero is not a tight
        // crop, it is a divide by zero in the Rendition generator. Guarded here
        // so a caller that is not the RPC boundary cannot write one.
        if (patch.crop !== undefined && !(patch.crop.scale > 0)) {
          return yield* Effect.fail(new InvalidInput({ message: 'crop scale must be positive' }))
        }
        if (patch.level !== undefined && patch.level !== null && !Number.isFinite(patch.level)) {
          return yield* Effect.fail(new InvalidInput({ message: 'level must be a finite angle' }))
        }
        yield* Effect.tryPromise({
          try: () =>
            db
              .prepare(`UPDATE photos SET ${fields.join(', ')} WHERE id = ?`)
              .bind(...binds, id)
              .run(),
          catch: (cause) =>
            new StorageError({
              message: 'Failed to update photo presentation',
              cause: describeCause(cause),
            }),
        })
        // The whole presentation, not the patch: a save returns the stored
        // truth so the Editor never has to guess what it did not send.
        const row = yield* presentationRow(db, id)
        if (row === null) return yield* Effect.fail(new PhotoNotFound({ id }))
        return toPhotoPresentation(row)
      })

    const addTags: PhotoServiceContract['addTags'] = (photoIds, tagIds) =>
      Effect.gen(function* () {
        yield* assertLivePhotos(db, photoIds)
        yield* assertTagsExist(db, tagIds)
        // One statement per Tag over a chunk of Photos: a link names exactly
        // one `tagId`, so the Tag ids are the loop and the Photo ids are the
        // binds inside one statement.
        const statements = tagIds.flatMap((tagId) =>
          linkPhotoChunks(photoIds).map((chunk) => {
            const placeholders = chunk.map(() => '?').join(', ')
            return db
              .prepare(
                `INSERT OR IGNORE INTO photo_tags (photoId, tagId)
                   SELECT id, ? FROM photos WHERE ${LIVE} AND id IN (${placeholders})`,
              )
              .bind(tagId, ...chunk)
          }),
        )
        if (statements.length === 0) return
        yield* Effect.tryPromise({
          try: () => db.batch(statements),
          catch: (cause) =>
            new StorageError({ message: 'Failed to add tags', cause: describeCause(cause) }),
        })
      })

    const removeTags: PhotoServiceContract['removeTags'] = (photoIds, tagIds) =>
      Effect.gen(function* () {
        yield* assertLivePhotos(db, photoIds)
        yield* assertTagsExist(db, tagIds)
        const statements = tagIds.flatMap((tagId) =>
          linkPhotoChunks(photoIds).map((chunk) => {
            const placeholders = chunk.map(() => '?').join(', ')
            return db
              .prepare(`DELETE FROM photo_tags WHERE tagId = ? AND photoId IN (${placeholders})`)
              .bind(tagId, ...chunk)
          }),
        )
        if (statements.length === 0) return
        yield* Effect.tryPromise({
          try: () => db.batch(statements),
          catch: (cause) =>
            new StorageError({ message: 'Failed to remove tags', cause: describeCause(cause) }),
        })
      })

    return PhotoService.of({
      list,
      count,
      get,
      create,
      update,
      setStatus,
      trash,
      restore,
      purge,
      counts,
      index,
      storageUsage,
      presentation,
      setPresentation,
      addTags,
      removeTags,
    })
  }),
)
