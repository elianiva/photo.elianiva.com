/**
 * PublicPhotoService — the public site's read model (see CONTEXT.md).
 *
 * Every method here filters to `status = 'published' AND deletedAt IS NULL`
 * inside the service, so a caller cannot forget the filter and a draft or a
 * trashed Photo cannot leak to a visitor. `PhotoService` is the Admin's read
 * model and deliberately answers for drafts, failed uploads and the Trash;
 * this is the other audience, over the same `Gateway` and through the same row
 * decoder, so the two cannot disagree about what a Photo is.
 *
 * Grouping is SQL. `takenAt` is `YYYY-MM-DD` TEXT, so `substr(takenAt, 1, 7)`
 * groups published Photos into the Front's Edition Sections, and the
 * lexicographic collation orders those months newest first. Pulling every
 * published row into the isolate to group it in JavaScript would put a whole
 * table through the line on every request.
 */

import { Context, Effect, Layer } from 'effect'
import {
  DbPhotoRow,
  FRONT_SECTION_COUNT,
  InvalidInput,
  StorageError,
  describeCause,
  type PhotoWithTags,
  type Tag,
} from '@photo/shared'
import { Gateway } from './gateway'
import {
  DEFAULT_SORT,
  PHOTO_COLUMNS,
  orderBy,
  pagePhotos,
  slugify,
  tagsForPhotos,
  toPhotoWithTags,
} from './photo'

/**
 * The predicate every public read carries. One string, so `frontPage` and
 * `bySlug` cannot drift into disagreeing about who is visible.
 */
const PUBLIC = "status = 'published' AND deletedAt IS NULL"

/** A month key, `2025-08`. The Front walks backwards through these. */
const MONTH_KEY = /^\d{4}-(?:0[1-9]|1[0-2])$/

/**
 * The sentinel for "no cursor": a month key above every real one, so the
 * cursor predicate stays a plain range and the first page needs no second
 * SQL shape.
 */
const NEWEST_MONTH = '9999-12'

/** The most Edition Sections one call may ask for, over {@link
 *  FRONT_SECTION_COUNT} which is what it gets when it does not say. The cap
 *  keeps a caller from asking the Worker for the whole site's Photos in one
 *  payload. */
const MAX_SECTION_COUNT = 12

/** One Edition Section: a month of published Photos, and the numbers it spans. */
export interface PublicSection {
  /** `2025-08` — the Section's key, and the cursor that resumes below it. */
  readonly month: string
  /** `2025` */
  readonly year: string
  /** `August 2025`, the Section's own heading. */
  readonly label: string
  /** `COUNT(*)` over the month's published Photos, in SQL. */
  readonly frames: number
  /** `MIN(number)` over the same set. Null when none of it is numbered. */
  readonly numberFrom: number | null
  /** `MAX(number)` over the same set. */
  readonly numberTo: number | null
  /** The month's Photos, newest first, with their Tags. */
  readonly photos: ReadonlyArray<PhotoWithTags>
}

export interface FrontPageInput {
  /** `YYYY-MM` to resume strictly below. Absent is the newest month. */
  readonly sectionCursor?: string | undefined
  /** How many months to return. How many the first paint asks for is the
   *  caller's page-weight decision; the service only clamps it. */
  readonly sectionCount?: number | undefined
}

export interface FrontPage {
  readonly sections: ReadonlyArray<PublicSection>
  /** The month below the last Section, or null when there are no older ones. */
  readonly nextSectionCursor: string | null
}

export interface PublicPhotoPage {
  readonly items: ReadonlyArray<PhotoWithTags>
  readonly nextCursor: string | null
}

export interface PublicListInput {
  /** One Tag's slug, not a list. A Series page _is_ a Tag page (ADR 0008), so
   *  the public vocabulary is the slug and the id stays an internal detail. */
  readonly tagSlug?: string | undefined
  readonly q?: string | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
}

export interface FrontStats {
  /**
   * `MAX(number)` over published, non-trashed Photos: the site's public
   * counter, read as *the last photograph a visitor can see*. Trashing the
   * highest-numbered Photo moves this back while that Photo keeps its number
   * in the Trash — intended, and not a bug to be fixed here.
   */
  readonly number: number | null
  /** `COUNT(*)` over the same set — the folio's `412 FRAMES`.
   *
   *  A published Photo with no `takenAt` is counted here and belongs to no
   *  Edition Section, because a Section is a month. */
  readonly total: number
  /** The newest published `takenAt`. The sitemap's `lastmod` is this fact. */
  readonly latestTakenAt: string | null
}

/** A public Series page (ADR 0008: a Series page _is_ a Tag page). */
export interface PublicSeries {
  readonly tag: Tag
  /** The Tag's published Photos, earliest first: the cover is the one a
   *  Series page leads with (ADR 0008). */
  readonly photos: ReadonlyArray<PhotoWithTags>
}

export interface PublicPhotoServiceContract {
  /** Published Photos, newest first, keyset paginated. The public list carries
   *  the same `q` and Tag filter the Admin's has and the same keyset cursor,
   *  over the published set. */
  readonly list: (
    input?: PublicListInput,
  ) => Effect.Effect<PublicPhotoPage, StorageError | InvalidInput>
  /** Published Photos grouped into Edition Sections, newest month first. */
  readonly frontPage: (
    input?: FrontPageInput,
  ) => Effect.Effect<FrontPage, StorageError | InvalidInput>
  /** The Front's counters. The site's copy is not here: the Masthead, the
   *  lede, the Colophon and the Folio nav are authored text, not a read. */
  readonly frontStats: () => Effect.Effect<FrontStats, StorageError | InvalidInput>
  /** A public Photo by slug, or null when none is published under it. */
  readonly bySlug: (slug: string) => Effect.Effect<PhotoWithTags | null, StorageError>
  /** A public Photo by id, or null when the id names no published Photo. The
   *  by-id twin of `bySlug`; a Photo page is addressed by slug or number, but
   *  the id is what a caller that already holds a row asks with. */
  readonly byId: (id: string) => Effect.Effect<PhotoWithTags | null, StorageError>
  /** The same Photo addressed by its Photo Number — the design prints `No. 024`. */
  readonly byNumber: (number: number) => Effect.Effect<PhotoWithTags | null, StorageError>
  /** Every published Photo, newest first — the public Archive's read. */
  readonly archive: () => Effect.Effect<ReadonlyArray<PhotoWithTags>, StorageError>
  /** A Tag and its published Photos, or null when the slug names no Tag. */
  readonly byTag: (slug: string) => Effect.Effect<PublicSeries | null, StorageError>
}

export class PublicPhotoService extends Context.Service<
  PublicPhotoService,
  PublicPhotoServiceContract
>()('photo/PublicPhotoService') {}

// ---------------------------------------------------------------------------
// cursors and formatting
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/** `2025-08` -> `August 2025`, the Section's own heading. Read off the key
 *  rather than reformatted from a day, so the heading never depends on a
 *  Worker's locale or zone. */
const monthLabel = (month: string): string =>
  `${MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`

const clampSectionCount = (input: number | undefined): number => {
  if (input === undefined || !Number.isFinite(input)) return FRONT_SECTION_COUNT
  return Math.min(Math.max(Math.floor(input), 1), MAX_SECTION_COUNT)
}

/**
 * The Section cursor is a month key in the clear. One that is not a month is
 * rejected rather than ignored: a malformed cursor means the caller and the
 * service disagree about where the page starts, and answering with the newest
 * month instead would repeat a page the visitor has already read.
 */
const decodeSectionCursor = (raw: string | undefined): Effect.Effect<string, InvalidInput> => {
  if (raw === undefined) return Effect.succeed(NEWEST_MONTH)
  const month = raw.trim()
  if (!MONTH_KEY.test(month)) {
    return Effect.fail(
      new InvalidInput({ message: `sectionCursor is not a YYYY-MM month: ${raw}` }),
    )
  }
  return Effect.succeed(month)
}

/** A URL path segment as a stored slug, or null when the segment is empty.
 *  `slugify('')` is `untitled`, which is a real Photo's slug, so an empty
 *  segment has to be answered before the slug is normalised. */
const urlSlug = (input: string): string | null => {
  const trimmed = input.trim()
  return trimmed === '' ? null : slugify(trimmed)
}

// ---------------------------------------------------------------------------
// queries
// ---------------------------------------------------------------------------

interface SectionRow {
  readonly month: string
  readonly frames: number
  readonly numberFrom: number | null
  readonly numberTo: number | null
}

interface MonthPhoto {
  readonly month: string
  readonly photo: PhotoWithTags
}

/** The Sections themselves: their key, their frame count and their number
 *  range, all SQL aggregates over the month's published set. One month beyond
 *  the page is asked for so the cursor is exact rather than guessed from a
 *  full page, and asking costs a row here rather than a month of Photos. */
const SECTIONS_SQL = `
  SELECT substr(takenAt, 1, 7) AS month,
         COUNT(*) AS frames,
         MIN(number) AS numberFrom,
         MAX(number) AS numberTo
    FROM photos
   WHERE ${PUBLIC} AND takenAt IS NOT NULL AND substr(takenAt, 1, 7) < ?
   GROUP BY month
   ORDER BY month DESC
   LIMIT ?`

interface StatsRow {
  readonly total: number
  readonly number: number | null
  readonly latestTakenAt: string | null
}

const STATS_SQL = `
  SELECT COUNT(*) AS total, MAX(number) AS number, MAX(takenAt) AS latestTakenAt
    FROM photos WHERE ${PUBLIC}`

const rows = <Row>(
  db: (typeof Gateway.Service)['db'],
  sql: string,
  message: string,
  binds: ReadonlyArray<unknown> = [],
): Effect.Effect<ReadonlyArray<Row>, StorageError> =>
  Effect.tryPromise({
    try: () =>
      db
        .prepare(sql)
        .bind(...binds)
        .all<Row>(),
    catch: (cause) => new StorageError({ message, cause: describeCause(cause) }),
  }).pipe(Effect.map((raw) => raw.results ?? []))

const row = <Row>(
  db: (typeof Gateway.Service)['db'],
  sql: string,
  message: string,
  binds: ReadonlyArray<unknown> = [],
): Effect.Effect<Row | null, StorageError> =>
  Effect.tryPromise({
    try: () =>
      db
        .prepare(sql)
        .bind(...binds)
        .first<Row>(),
    catch: (cause) => new StorageError({ message, cause: describeCause(cause) }),
  })

/** The Photos of those Sections, each still carrying the month SQL grouped it
 *  under. The nesting happens in JavaScript; the grouping does not. */
const photosForMonths = (
  db: (typeof Gateway.Service)['db'],
  months: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<MonthPhoto>, StorageError> =>
  Effect.gen(function* () {
    if (months.length === 0) return []
    const placeholders = months.map(() => '?').join(', ')
    const found = yield* rows<DbPhotoRow & { readonly month: string }>(
      db,
      `SELECT ${PHOTO_COLUMNS}, substr(takenAt, 1, 7) AS month
         FROM photos
        WHERE ${PUBLIC} AND substr(takenAt, 1, 7) IN (${placeholders})
        ORDER BY substr(takenAt, 1, 7) DESC, takenAt DESC, number DESC`,
      'Failed to read the front page',
      months,
    )
    const tagged = yield* tagsForPhotos(
      db,
      found.map((found) => found.id),
    )
    return found.map((found) => ({
      month: found.month,
      photo: toPhotoWithTags(found, tagged.get(found.id) ?? []),
    }))
  })

const withTags = (
  db: (typeof Gateway.Service)['db'],
  found: ReadonlyArray<DbPhotoRow>,
): Effect.Effect<ReadonlyArray<PhotoWithTags>, StorageError> =>
  Effect.gen(function* () {
    if (found.length === 0) return []
    const tagged = yield* tagsForPhotos(
      db,
      found.map((one) => one.id),
    )
    return found.map((one) => toPhotoWithTags(one, tagged.get(one.id) ?? []))
  })

const publishedBy = (
  db: (typeof Gateway.Service)['db'],
  column: 'id' | 'slug' | 'number',
  key: string | number,
): Effect.Effect<PhotoWithTags | null, StorageError> =>
  Effect.gen(function* () {
    const found = yield* row<DbPhotoRow>(
      db,
      `SELECT ${PHOTO_COLUMNS} FROM photos WHERE ${PUBLIC} AND ${column} = ?`,
      `Failed to get the public photo ${column} ${String(key)}`,
      [key],
    )
    if (found === null) return null
    const [photo] = yield* withTags(db, [found])
    return photo ?? null
  })

/**
 * A Tag by slug, or null when no Tag carries it.
 *
 * The Photos table is keyed on ids and a public URL is keyed on slugs, so the
 * translation is a read. It lives in the public read model rather than in a
 * handler so a caller cannot resolve a slug over a set of Photos wider than
 * the published one.
 */
const tagBySlug = (
  db: (typeof Gateway.Service)['db'],
  slug: string,
): Effect.Effect<Tag | null, StorageError> =>
  row<Tag>(
    db,
    `SELECT id, slug, label, caption FROM tags WHERE slug = ?`,
    `Failed to get the tag ${slug}`,
    [slug],
  )

// ---------------------------------------------------------------------------
// live implementation
// ---------------------------------------------------------------------------

export const PublicPhotoServiceLive = Layer.effect(
  PublicPhotoService,
  Effect.gen(function* () {
    const gateway = yield* Gateway
    const db = gateway.db

    const list: PublicPhotoServiceContract['list'] = (input) =>
      Effect.gen(function* () {
        const requested = input?.tagSlug?.trim() ?? ''
        if (requested.includes(',')) {
          return yield* new InvalidInput({ message: 'tagSlug takes one tag' })
        }
        // `slugify` is what the write side applied, so the read side applies
        // it too: a filter typed `Istanbul` finds the Tag stored as
        // `istanbul`.
        const tag = requested === '' ? null : yield* tagBySlug(db, slugify(requested))
        // A slug nobody carries is a filter that matches nothing, which is a
        // different answer from not filtering at all.
        if (requested !== '' && tag === null) return { items: [], nextCursor: null }
        const { rows, nextCursor } = yield* pagePhotos(db, PUBLIC, {
          q: input?.q,
          limit: input?.limit,
          cursor: input?.cursor,
          tagIds: tag === null ? [] : [tag.id],
        })
        return { items: yield* withTags(db, rows), nextCursor }
      })

    const frontPage: PublicPhotoServiceContract['frontPage'] = (input) =>
      Effect.gen(function* () {
        const cursor = yield* decodeSectionCursor(input?.sectionCursor)
        const sectionCount = clampSectionCount(input?.sectionCount)
        const found = yield* rows<SectionRow>(
          db,
          SECTIONS_SQL,
          'Failed to read the front page sections',
          [cursor, String(sectionCount + 1)],
        )
        // The month past the page is the answer to "are there older Sections",
        // and it is dropped: a page that rendered a month the caller did not
        // ask for would leave a hole the cursor never comes back to.
        const page = found.slice(0, sectionCount)
        const byMonth = new Map<string, Array<PhotoWithTags>>()
        for (const { month, photo } of yield* photosForMonths(
          db,
          page.map((section) => section.month),
        )) {
          const list = byMonth.get(month)
          if (list === undefined) byMonth.set(month, [photo])
          else list.push(photo)
        }
        const last = page[page.length - 1]
        return {
          sections: page.map((section) => ({
            month: section.month,
            year: section.month.slice(0, 4),
            label: monthLabel(section.month),
            frames: section.frames,
            numberFrom: section.numberFrom,
            numberTo: section.numberTo,
            photos: byMonth.get(section.month) ?? [],
          })),
          nextSectionCursor: found.length > sectionCount && last !== undefined ? last.month : null,
        }
      })

    const frontStats: PublicPhotoServiceContract['frontStats'] = () =>
      Effect.gen(function* () {
        const found = yield* row<StatsRow>(db, STATS_SQL, 'Failed to read the front page stats')
        return {
          number: found?.number ?? null,
          total: found?.total ?? 0,
          latestTakenAt: found?.latestTakenAt ?? null,
        }
      })

    const bySlug: PublicPhotoServiceContract['bySlug'] = (slug) =>
      Effect.gen(function* () {
        const key = urlSlug(slug)
        return key === null ? null : yield* publishedBy(db, 'slug', key)
      })

    const byId: PublicPhotoServiceContract['byId'] = (id) => publishedBy(db, 'id', id)

    const byNumber: PublicPhotoServiceContract['byNumber'] = (number) =>
      Number.isFinite(number) ? publishedBy(db, 'number', number) : Effect.succeed(null)

    const archive: PublicPhotoServiceContract['archive'] = () =>
      Effect.gen(function* () {
        const found = yield* rows<DbPhotoRow>(
          db,
          `SELECT ${PHOTO_COLUMNS} FROM photos WHERE ${PUBLIC} ORDER BY ${orderBy(DEFAULT_SORT)}`,
          'Failed to read the archive',
        )
        return yield* withTags(db, found)
      })

    const byTag: PublicPhotoServiceContract['byTag'] = (slug) =>
      Effect.gen(function* () {
        const key = urlSlug(slug)
        if (key === null) return null
        const tag = yield* tagBySlug(db, key)
        if (tag === null) return null
        // Earliest first: a Series page leads with the earliest published
        // Photo (ADR 0008), so the cover is the head of the list.
        const found = yield* rows<DbPhotoRow>(
          db,
          `SELECT ${PHOTO_COLUMNS} FROM photos
            WHERE ${PUBLIC}
              AND id IN (SELECT photoId FROM photo_tags WHERE tagId = ?)
            ORDER BY takenAt, number`,
          `Failed to read the series ${key}`,
          [tag.id],
        )
        return { tag, photos: yield* withTags(db, found) }
      })

    return PublicPhotoService.of({
      list,
      frontPage,
      frontStats,
      bySlug,
      byId,
      byNumber,
      archive,
      byTag,
    })
  }),
)
