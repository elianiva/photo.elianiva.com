/**
 * PhotoService — the Photo domain over D1 + R2 (see CONTEXT.md).
 * Essential queryable fields are columns; the rest lives in the JSON
 * `metadata` blob. Tags join through `photo_tags`.
 */

import { Context, DateTime, Effect, Layer, Schema as S } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'
import type { Fragment } from 'effect/unstable/sql/Statement'
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
import { Batch, type BatchContract, type BatchStatement } from './batch'
import { Gateway } from './gateway'

/** The metadata database. The standard Effect SQL client, so the Worker
 *  provides `@effect/sql-d1` over its D1 binding and the tests provide
 *  `@effect/sql-sqlite-node` over the same `migrations/*.sql` — one
 *  data-access style, one set of tests, no re-declared D1 surface. */
export type Db = SqlClient.SqlClient

/** A WHERE clause, or nothing. The values it binds live inside the fragment,
 *  so a query cannot be assembled from a clause and a parallel list of
 *  binds that have quietly stopped lining up. */
type Clause = Fragment | undefined

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
  /** Live Photos. Not `frames` — that is display copy (ADR 0006). */
  readonly photos: number
  /** Bytes those originals take, against the bucket cap. */
  readonly bytes: number
}

export interface PhotoUpdatePatch {
  readonly title?: string | undefined
  readonly slug?: string | undefined
  readonly takenAt?: string | undefined
  readonly metadata?: Record<string, unknown> | undefined
  /** The frame proportion. A Photo column, set from the Editor's crop. */
  readonly ratio?: PhotoRatio | undefined
  /** The client re-encoded Blurhash of the authored composition. A Photo
   *  column; `null` clears it for a Photo whose bytes no longer back a hash. */
  readonly blurhash?: string | null | undefined
  readonly tagIds?: ReadonlyArray<string> | undefined
}

/** The authored presentation, in the four groups the Editor edits it in. Every
 *  group is optional and only the supplied columns are written, so one group
 *  can be saved without restating the other three. A `null` clears its column
 *  — `level` and the three mat details are nullable, and null is un-levelled
 *  rather than zero — where an absent key leaves the column alone. */
export interface PhotoPresentationPatch {
  readonly crop?:
    | {
        readonly x: number
        readonly y: number
        readonly scale: number
        readonly flipX?: boolean | undefined
      }
    | undefined
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

/** The ORDER BY, as a fragment. The text is this module's own — a closed set
 *  of column expressions from {@link SORTS} — so it is a literal; the sort the
 *  caller picked is what chose it, never anything a payload carried. */
export const orderBy = (sql: Db, sort: PhotoSort): Fragment =>
  sql.literal(
    SORTS[sort.key].columns
      .map((column) => `${column.sql} ${columnDirection(column, sort)}`)
      .join(', '),
  )

/**
 * The keyset predicate: "strictly past the cursor, in this order". Built from
 * the same columns as the ORDER BY — a lexicographic OR-chain over them — and
 * the values come out of the same walk, so a branch's placeholders and its
 * binds cannot drift apart.
 */
export const keysetWhere = (
  sql: Db,
  sort: PhotoSort,
  key: ReadonlyArray<number | string | null>,
): Fragment => {
  const columns = SORTS[sort.key].columns
  // Each branch parenthesised: `AND` binds tighter than `OR`, so the
  // lexicographic chain only reads as one if it is written down.
  const branches = columns.map((column, index) => {
    // The earlier columns pinned to the cursor's own values, then this column
    // compared past it. Branch `index` therefore reads the first `index + 1`
    // key parts, and it does so by naming them rather than by shipping a
    // parallel list — a branch's placeholders and its binds cannot drift,
    // because there is no second list to drift.
    const pinned = columns
      .slice(0, index)
      .map((earlier, position) => sql`${sql.literal(earlier.sql)} = ${key[position]}`)
    const comparison = columnDirection(column, sort) === 'asc' ? '>' : '<'
    return sql`(${sql.and([...pinned, sql`${sql.literal(column.sql)} ${sql.literal(comparison)} ${key[index]}`])})`
  })
  return sql`(${sql.or(branches)})`
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

export const tagsForPhotos = (sql: Db, ids: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const map = new Map<string, Array<Tag>>()
    for (const id of ids) map.set(id, [])
    if (ids.length === 0) return new Map<string, ReadonlyArray<Tag>>()

    // Chunk IN lists to stay well under D1's ~100 bind limit
    for (const chunk of chunkOf(ids, 80)) {
      const raw = yield* Effect.mapError(
        sql<TagRowWithPhotoId>`SELECT t.id, t.slug, t.label, t.caption, pt.photoId as photoId FROM tags t JOIN photo_tags pt ON pt.tagId = t.id WHERE ${sql.in(
          'pt.photoId',
          chunk,
        )} ORDER BY t.label`,
        (cause) =>
          new StorageError({ message: 'Failed to load tags', cause: describeCause(cause) }),
      )
      for (const row of raw) {
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
/** One row, or null. D1's `.first()` said "at most one"; a statement answers
 *  with an array, and what makes it at-most-one is the `WHERE` above it.
 *  Exported because the public read model asks the same question of its own
 *  statements. */
export const firstRow = <A>(rows: ReadonlyArray<A>): A | null => rows[0] ?? null

/** One row by id, or null. `scope: 'any'` is for the lifecycle operations,
 *  which have to find a Photo the soft delete has already hidden; everything
 *  else takes the live scope.
 *
 *  The audience predicate is composed *before* the template rather than
 *  interpolated conditionally: a missing fragment inside `${}` binds as a
 *  parameter, so the conditional form compiled to `WHERE id = ??`. */
const rowById = (sql: Db, id: string, scope: 'live' | 'any' = 'live') =>
  Effect.mapError(
    sql<DbPhotoRow>`SELECT ${sql.literal(PHOTO_COLUMNS)} FROM photos WHERE id = ${id}${
      scope === 'live' ? sql.literal(` AND ${LIVE}`) : sql.literal('')
    }`,
    (cause) => new StorageError({ message: `Failed to get photo ${id}`, cause: describeCause(cause) }),
  ).pipe(Effect.map(firstRow))

/** The row an operation is about to act on, or `PhotoNotFound`. Every method
 *  in this layer resolves its Photo through here, so a Photo that is gone and
 *  one that is in the Trash are the same answer everywhere, and the only
 *  difference between the lifecycle operations and the rest is which row they
 *  ask for — the failure is written once, here. */
const requireRow = <A>(
  row: Effect.Effect<NonNullable<A> | null, StorageError>,
  id: string,
): Effect.Effect<NonNullable<A>, StorageError | PhotoNotFound> =>
  Effect.flatMap(row, (found) =>
    found === null ? Effect.fail(new PhotoNotFound({ id })) : Effect.succeed(found),
  )

/** The row with its Tags attached — what every read operation returns. */
const withTags = (sql: Db, row: DbPhotoRow) =>
  Effect.gen(function* () {
    const tagMap = yield* tagsForPhotos(sql, [row.id])
    return toPhotoWithTags(row, tagMap.get(row.id) ?? [])
  })

// ---------------------------------------------------------------------------
// presentation
// ---------------------------------------------------------------------------

/** The presentation columns migration 0004 added, in one string so the write
 *  and the read-back can never name different columns. */
const PRESENTATION_COLUMNS =
  'cropX, cropY, cropScale, cropFlip, level, borderEnabled, borderStyle, borderColour, borderWidth, previewLongEdge, previewFormat, previewQuality, fullQuality, keepExif, removeGps'

/** SQLite hands booleans back as the 0/1 the columns are declared with. */
interface DbPresentationRow {
  readonly cropX: number
  readonly cropY: number
  readonly cropScale: number
  readonly cropFlip: number
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
  cropFlipX: row.cropFlip !== 0,
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

const presentationRow = (sql: Db, id: string) =>
  Effect.mapError(
    sql<DbPresentationRow>`SELECT ${sql.literal(PRESENTATION_COLUMNS)} FROM photos WHERE id = ${id} AND ${sql.literal(LIVE)}`,
    (cause) =>
      new StorageError({
        message: `Failed to get presentation for photo ${id}`,
        cause: describeCause(cause),
      }),
  ).pipe(Effect.map(firstRow))

/** Only the supplied columns, in the order the four groups are named. An empty
 *  result is an empty patch, which is an error rather than a no-op UPDATE. */
/** The presentation columns a patch sets, as `column = value` fragments. The
 *  shape this replaces returned the columns and their values as two parallel
 *  lists, so a column added to one and not the other wrote the wrong value into
 *  the wrong column; a list of assignments cannot be split like that. */
const presentationAssignments = (sql: Db, patch: PhotoPresentationPatch): Array<Fragment> => {
  const assignments: Array<Fragment> = []
  const set = (column: string, value: unknown): void => {
    assignments.push(sql`${sql(column)} = ${value}`)
  }
  if (patch.crop !== undefined) {
    set('cropX', patch.crop.x)
    set('cropY', patch.crop.y)
    set('cropScale', patch.crop.scale)
    if (patch.crop.flipX !== undefined) set('cropFlip', patch.crop.flipX ? 1 : 0)
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
  return assignments
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
const assertLivePhotos = (sql: Db, photoIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const found = new Set<string>()
    for (const chunk of chunkOf(photoIds, LINK_BIND_BUDGET)) {
      const raw = yield* Effect.mapError(
        sql<{ id: string }>`SELECT id FROM photos WHERE ${sql.literal(LIVE)} AND ${sql.in('id', chunk)}`,
        (cause) =>
          new StorageError({ message: 'Failed to check photos', cause: describeCause(cause) }),
      )
      for (const row of raw) found.add(row.id)
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
const assertTagsExist = (sql: Db, tagIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const found = new Set<string>()
    for (const chunk of chunkOf(tagIds, LINK_BIND_BUDGET)) {
      const raw = yield* Effect.mapError(
        sql<{ id: string }>`SELECT id FROM tags WHERE ${sql.in('id', chunk)}`,
        (cause) =>
          new StorageError({ message: 'Failed to check tags', cause: describeCause(cause) }),
      )
      for (const row of raw) found.add(row.id)
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
export const filterWhere = (sql: Db, filter: PhotoListFilter): Clause => {
  const clauses: Array<Fragment> = []
  if (filter.status !== undefined) {
    clauses.push(sql`status = ${filter.status}`)
  }
  if (filter.ratio !== undefined) {
    clauses.push(sql`ratio = ${filter.ratio}`)
  }
  const tagIds = filter.tagIds ?? []
  if (tagIds.length > 0) {
    clauses.push(sql`id IN (SELECT photoId FROM photo_tags WHERE ${sql.in('tagId', tagIds)})`)
  }
  const q = filter.q?.trim().slice(0, 120) ?? ''
  if (q !== '') {
    // One bound needle, read three times: the escape runs over the searcher's
    // own text, so `100%` cannot match every title containing `100`.
    const needle = `%${escapeLike(q.toLowerCase())}%`
    clauses.push(
      sql`(LOWER(title) LIKE ${needle} ESCAPE '\\' OR LOWER(slug) LIKE ${needle} ESCAPE '\\' OR LOWER(metadata) LIKE ${needle} ESCAPE '\\')`,
    )
  }
  return clauses.length === 0 ? undefined : sql.and(clauses)
}

/** The audience predicate AND the filters. An unfiltered query is the
 *  predicate on its own rather than a dangling `AND`. */
const andFilter = (sql: Db, predicate: Fragment, filters: Clause): Fragment =>
  filters === undefined ? predicate : sql.and([predicate, filters])

const selectPhotoRows = (
  sql: Db,
  predicate: Fragment,
  filter: PhotoListFilter,
  sort: PhotoSort,
  cursor: PhotoCursor | null,
): Effect.Effect<{ rows: ReadonlyArray<DbPhotoRow>; nextCursor: string | null }, StorageError> =>
  Effect.gen(function* () {
    const where = [andFilter(sql, predicate, filterWhere(sql, filter))]
    if (cursor !== null) {
      where.push(keysetWhere(sql, sort, cursor.key))
    }
    const limit = clampLimit(filter.limit)
    const rows = yield* Effect.mapError(
      sql<DbPhotoRow>`SELECT ${sql.literal(PHOTO_COLUMNS)} FROM photos WHERE ${sql.and(where)} ORDER BY ${orderBy(
        sql,
        sort,
      )} LIMIT ${limit}`,
      (cause) => new StorageError({ message: 'Failed to list photos', cause: describeCause(cause) }),
    )
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
  sql: Db,
  predicate: Fragment,
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
    return yield* selectPhotoRows(sql, predicate, filter, sort, cursor)
  })

/** Replace a Photo's tag links. The delete and the inserts go in one batch so
 *  the links are never half-written. */
const linkTags = (
  sql: Db,
  photoId: string,
  tagIds: ReadonlyArray<string>,
): ReadonlyArray<BatchStatement> => [
  sql`DELETE FROM photo_tags WHERE photoId = ${photoId}`,
  ...tagIds.map((tagId) =>
    sql`INSERT OR IGNORE INTO photo_tags (photoId, tagId) VALUES (${photoId}, ${tagId})`,
  ),
]

/** A Photo's row and its links. `photo_tags` cascades in D1; the explicit
 *  delete keeps this correct on an engine with foreign keys off. */
const deletePhoto = (sql: Db, photoId: string): ReadonlyArray<BatchStatement> => [
  sql`DELETE FROM photo_tags WHERE photoId = ${photoId}`,
  sql`DELETE FROM photos WHERE id = ${photoId}`,
]

/** True when no other photo owns this slug. Trashed Photos are in scope: a
 *  slug stays taken while its Photo is in the Trash, or a restore could hand
 *  two Photos the same one. */
const slugAvailable = (sql: Db, slug: string, exceptPhotoId?: string) =>
  Effect.mapError(
    sql<{ id: string }>`SELECT id FROM photos WHERE slug = ${slug} AND (${exceptPhotoId ?? null} IS NULL OR id != ${exceptPhotoId ?? ''})`,
    (cause) =>
      new StorageError({ message: 'Failed to check slug', cause: describeCause(cause) }),
  ).pipe(Effect.map(firstRow), Effect.map((row) => row === null))

/**
 * Drops a row this call inserted, best effort. Keyed by id and never by
 * `r2Key`: the id is this Photo's, so a rollback can only ever undo itself.
 */
/** Best effort, and silent by design: a rollback that cannot roll back has
 *  nothing useful to say, and failing the call it was undoing would report the
 *  original write as lost when the row is still there. */
const dropRow = (batch: BatchContract, sql: Db, id: string): Effect.Effect<void> =>
  batch.run(deletePhoto(sql, id)).pipe(Effect.orElseSucceed(() => undefined), Effect.asVoid)

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
    const sql = yield* SqlClient.SqlClient
    const batch = yield* Batch
    const gateway = yield* Gateway

    const list: PhotoServiceContract['list'] = (filter) =>
      Effect.gen(function* () {
        const { rows, nextCursor } = yield* pagePhotos(sql, sql.literal(LIVE), filter)
        const tagMap = yield* tagsForPhotos(sql,
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
        const row = yield* Effect.mapError(
          sql<{ n: number }>`SELECT COUNT(*) AS n FROM photos WHERE ${andFilter(
            sql,
            sql.literal(LIVE),
            filterWhere(sql, filter),
          )}`,
          (cause) =>
            new StorageError({
              message: 'Failed to count filtered photos',
              cause: describeCause(cause),
            }),
        ).pipe(Effect.map(firstRow))
        return row?.n ?? 0
      })

    const get: PhotoServiceContract['get'] = (id) =>
      Effect.gen(function* () {
        const row = yield* requireRow(rowById(sql, id), id)
        return yield* withTags(sql, row)
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
        if (!(yield* slugAvailable(sql, slug))) {
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
        // A column and its value, side by side. The shape this replaces was
        // three parallel arrays — columns, `?` placeholders, binds — and a
        // column added in one and forgotten in another wrote a row with every
        // value after it shifted by one. Pairs cannot drift: the columns below
        // and the values beside them are read as one list.
        const columns: Array<{ readonly column: string; readonly value: Fragment }> = [
          { column: 'id', value: sql`${id}` },
          { column: 'slug', value: sql`${slug}` },
          { column: 'title', value: sql`${input.title}` },
          { column: 'r2Key', value: sql`${input.r2Key}` },
          { column: 'width', value: sql`${input.width}` },
          { column: 'height', value: sql`${input.height}` },
          // The Photo Number is the counter's own row, read inside the same
          // batch that increments it, so two concurrent uploads cannot be
          // handed the same one.
          {
            column: 'number',
            value: sql.literal('(SELECT value FROM photo_number_counter WHERE id = 1)'),
          },
          { column: 'ratio', value: sql`${ratio}` },
          { column: 'bytes', value: sql`${input.bytes.byteLength}` },
          { column: 'mime', value: sql`${contentType}` },
          { column: 'aperture', value: sql`${input.aperture ?? null}` },
          { column: 'shutter', value: sql`${input.shutter ?? null}` },
          { column: 'iso', value: sql`${input.iso ?? null}` },
          { column: 'focalLength', value: sql`${input.focalLength ?? null}` },
          { column: 'takenAt', value: sql`${input.takenAt ?? null}` },
          { column: 'metadata', value: sql`${input.metadata}` },
          { column: 'blurhash', value: sql`${input.blurhash ?? null}` },
        ]
        if (input.status !== undefined) {
          columns.push({ column: 'status', value: sql`${input.status}` })
        }
        if (input.exportDefaults !== undefined) {
          const d = input.exportDefaults
          columns.push(
            { column: 'previewLongEdge', value: sql`${d.previewLongEdge}` },
            { column: 'previewFormat', value: sql`${d.previewFormat}` },
            { column: 'previewQuality', value: sql`${d.previewQuality}` },
            { column: 'fullQuality', value: sql`${d.fullQuality}` },
            { column: 'keepExif', value: sql`${d.keepExif ? 1 : 0}` },
            { column: 'removeGps', value: sql`${d.removeGps ? 1 : 0}` },
          )
        }
        yield* Effect.mapError(
          batch.run([
            sql`UPDATE photo_number_counter SET value = value + 1 WHERE id = 1`,
            // The column list is this module's own names, joined into one
            // literal; the values beside them are bound, one per column, by the
            // same list — which is why they cannot come out shifted.
            sql`INSERT INTO photos (${sql.literal(
              columns.map((entry) => entry.column).join(', '),
            )}) VALUES (${sql.join(', ', false)(columns.map((entry) => entry.value))})`,
            ...linkTags(sql, id, input.tagIds),
          ]),
          (cause) =>
            new StorageError({ message: 'Failed to insert photo', cause: describeCause(cause) }),
        )
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
        }).pipe(Effect.tapError(() => dropRow(batch, sql, id)))

        return { id, slug, r2Key: input.r2Key }
      })

    const update: PhotoServiceContract['update'] = (id, patch) =>
      Effect.gen(function* () {
        yield* requireRow(rowById(sql, id), id)
        // `column = value` pairs, so a field and its bind cannot drift apart.
        const assignments: Array<Fragment> = []
        if (patch.title !== undefined) {
          assignments.push(sql`title = ${patch.title}`)
        }
        if (patch.slug !== undefined) {
          const nextSlug = slugify(patch.slug)
          if (!(yield* slugAvailable(sql, nextSlug, id))) {
            return yield* Effect.fail(new SlugConflict({ slug: nextSlug }))
          }
          assignments.push(sql`slug = ${nextSlug}`)
        }
        if (patch.takenAt !== undefined) {
          assignments.push(sql`takenAt = ${patch.takenAt === '' ? null : patch.takenAt}`)
        }
        if (patch.ratio !== undefined) {
          assignments.push(sql`ratio = ${patch.ratio}`)
        }
        if (patch.blurhash !== undefined) {
          assignments.push(sql`blurhash = ${patch.blurhash}`)
        }
        if (patch.metadata !== undefined) {
          assignments.push(sql`metadata = ${JSON.stringify(patch.metadata)}`)
        }
        // Columns and tag links in one batch, which D1 runs as one
        // transaction: a tag insert that fails must not leave the row
        // half-updated.
        const statements: Array<BatchStatement> = [
          ...(assignments.length > 0
            ? [sql`UPDATE photos SET ${sql.join(', ', false)(assignments)} WHERE id = ${id}`]
            : []),
          ...(patch.tagIds === undefined ? [] : linkTags(sql, id, patch.tagIds)),
        ]
        if (statements.length > 0) {
          yield* Effect.mapError(
            batch.run(statements),
            (cause) =>
              new StorageError({ message: 'Failed to update photo', cause: describeCause(cause) }),
          )
        }
        const row = yield* requireRow(rowById(sql, id), id)
        return yield* withTags(sql, row)
      })

    const setStatus: PhotoServiceContract['setStatus'] = (id, status) =>
      Effect.gen(function* () {
        yield* requireRow(rowById(sql, id), id)
        yield* Effect.mapError(
          sql`UPDATE photos SET status = ${status} WHERE id = ${id}`.raw,
          (cause) =>
            new StorageError({
              message: 'Failed to set photo status',
              cause: describeCause(cause),
            }),
        )
        const row = yield* requireRow(rowById(sql, id), id)
        return yield* withTags(sql, row)
      })

    const trash: PhotoServiceContract['trash'] = (id) =>
      Effect.gen(function* () {
        // Any row, live or not: trashing a trashed Photo is the end state it
        // is already in, and re-stamping the date would make the Trash's
        // ordering depend on how many times it was clicked.
        const row = yield* requireRow(rowById(sql, id, 'any'), id)
        if (row.deletedAt !== null) return
        yield* Effect.mapError(
          // `YYYY-MM-DD`, the format #14 gives `deletedAt` and `takenAt`.
          sql`UPDATE photos SET deletedAt = ${DateTime.formatIsoDateUtc(DateTime.nowUnsafe())} WHERE id = ${id} AND ${sql.literal(LIVE)}`.raw,
          (cause) =>
            new StorageError({ message: 'Failed to trash photo', cause: describeCause(cause) }),
        )
      })

    const restore: PhotoServiceContract['restore'] = (id) =>
      Effect.gen(function* () {
        const row = yield* requireRow(rowById(sql, id, 'any'), id)
        if (row.deletedAt === null) return
        yield* Effect.mapError(
          sql`UPDATE photos SET deletedAt = NULL WHERE id = ${id}`.raw,
          (cause) =>
            new StorageError({ message: 'Failed to restore photo', cause: describeCause(cause) }),
        )
      })

    const purge: PhotoServiceContract['purge'] = (id) =>
      Effect.gen(function* () {
        const row = yield* requireRow(rowById(sql, id, 'any'), id)
        if (row.deletedAt === null) {
          return yield* Effect.fail(
            new InvalidInput({ message: 'only a trashed photo can be purged' }),
          )
        }
        yield* Effect.mapError(
          batch.run(deletePhoto(sql, id)),
          (cause) =>
            new StorageError({ message: 'Failed to purge photo', cause: describeCause(cause) }),
        )
        yield* Effect.tryPromise({
          try: () => gateway.photos.delete(row.r2Key),
          catch: (cause) =>
            new StorageError({ message: 'R2 delete failed', cause: describeCause(cause) }),
        }).pipe(Effect.orElseSucceed(() => undefined))
      })

    const counts: PhotoServiceContract['counts'] = () =>
      Effect.gen(function* () {
        const raw = yield* Effect.mapError(
          sql<CountRow>`${sql.literal(COUNTS_SQL)}`,
          (cause) =>
            new StorageError({ message: 'Failed to count photos', cause: describeCause(cause) }),
        )
        const byStatus: Record<PhotoStatus, number> = { ...NO_STATUSES }
        const byTag: Array<PhotoTagCount> = []
        let total = 0
        let trashed = 0
        const rows = raw
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
        const rows = yield* Effect.mapError(
          sql<DbPhotoIndexRow>`SELECT id, number, title, slug, ratio, takenAt, bytes, metadata
             FROM photos WHERE ${sql.literal(LIVE)} ORDER BY ${sql.literal(INDEX_ORDER)}`,
          (cause) =>
            new StorageError({
              message: 'Failed to read the photo index',
              cause: describeCause(cause),
            }),
        )
        const tagMap = yield* tagsForPhotos(sql, rows.map((row) => row.id))
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
      Effect.mapError(
        sql<{ photos: number; bytes: number }>`SELECT COUNT(*) AS photos, COALESCE(SUM(bytes), 0) AS bytes FROM photos WHERE ${sql.literal(LIVE)}`,
        (cause) =>
          new StorageError({
            message: 'Failed to read storage usage',
            cause: describeCause(cause),
          }),
      ).pipe(
        Effect.map(firstRow),
        Effect.map((row) => ({ photos: row?.photos ?? 0, bytes: row?.bytes ?? 0 })),
      )

    const presentation: PhotoServiceContract['presentation'] = (id) =>
      Effect.gen(function* () {
        // The read is scoped to live Photos, exactly as the write is: a
        // trashed Photo has a stored Presentation, and the Editor is not where
        // the Trash is edited.
        const row = yield* requireRow(presentationRow(sql, id), id)
        return toPhotoPresentation(row)
      })

    const setPresentation: PhotoServiceContract['setPresentation'] = (id, patch) =>
      Effect.gen(function* () {
        yield* requireRow(rowById(sql, id), id)
        const assignments = presentationAssignments(sql, patch)
        if (assignments.length === 0) {
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
        yield* Effect.mapError(
          sql`UPDATE photos SET ${sql.join(', ', false)(assignments)} WHERE id = ${id}`.raw,
          (cause) =>
            new StorageError({
              message: 'Failed to update photo presentation',
              cause: describeCause(cause),
            }),
        )
        // The whole presentation, not the patch: a save returns the stored
        // truth so the Editor never has to guess what it did not send.
        const row = yield* requireRow(presentationRow(sql, id), id)
        return toPhotoPresentation(row)
      })

    const addTags: PhotoServiceContract['addTags'] = (photoIds, tagIds) =>
      Effect.gen(function* () {
        yield* assertLivePhotos(sql, photoIds)
        yield* assertTagsExist(sql, tagIds)
        // One statement per Tag over a chunk of Photos: a link names exactly
        // one `tagId`, so the Tag ids are the loop and the Photo ids are the
        // binds inside one statement.
        const statements = tagIds.flatMap((tagId) =>
          linkPhotoChunks(photoIds).map((chunk) =>
            sql`INSERT OR IGNORE INTO photo_tags (photoId, tagId)
                SELECT id, ${tagId} FROM photos WHERE ${sql.literal(LIVE)} AND ${sql.in('id', chunk)}`,
          ),
        )
        if (statements.length === 0) return
        yield* Effect.mapError(
          batch.run(statements),
          (cause) =>
            new StorageError({ message: 'Failed to add tags', cause: describeCause(cause) }),
        )
      })

    const removeTags: PhotoServiceContract['removeTags'] = (photoIds, tagIds) =>
      Effect.gen(function* () {
        yield* assertLivePhotos(sql, photoIds)
        yield* assertTagsExist(sql, tagIds)
        const statements = tagIds.flatMap((tagId) =>
          linkPhotoChunks(photoIds).map((chunk) =>
            sql`DELETE FROM photo_tags WHERE tagId = ${tagId} AND ${sql.in('photoId', chunk)}`,
          ),
        )
        if (statements.length === 0) return
        yield* Effect.mapError(
          batch.run(statements),
          (cause) =>
            new StorageError({ message: 'Failed to remove tags', cause: describeCause(cause) }),
        )
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
