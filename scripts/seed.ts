#!/usr/bin/env tsx
/**
 * Seed a fresh D1 with 8 tags and 12 placeholder photos.
 *
 * - Dry-run (default): prints the SQL to stdout.
 * - `--apply`: POSTs each photo at the dev API (`http://localhost:13371`).
 *
 * Usage:
 *   pnpm db:seed              # dry-run, prints SQL
 *   pnpm db:seed -- --apply   # attempt a live insert through the local API
 *
 * The seed data is a `Schema`, not a hand-typed array, because the dry run
 * interpolates it into SQL and the apply path sends it as multipart fields. A
 * row that cannot be decoded fails here, before either path has used it, rather
 * than producing a statement quoting a value that was never there.
 */

import { Effect, Option, Result, Schema as S } from 'effect'
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from 'effect/http'
import { UploadResponseBody, isUploadError } from '@photo/shared'

// ---------------------------------------------------------------------------
// seed data
// ---------------------------------------------------------------------------

/** A Tag as the database holds it: an id, a slug and a label. */
const SeedTag = S.Struct({
  slug: S.NonEmptyString,
  label: S.NonEmptyString,
})
type SeedTag = typeof SeedTag.Type

/** A placeholder Photo. `id` and `r2Key` are derived from the slug in one place
 *  so the two SQL statements and the multipart filename cannot name a Photo
 *  three different ways. */
const SeedPhoto = S.Struct({
  title: S.NonEmptyString,
  slug: S.NonEmptyString,
  takenAt: S.String,
  width: S.Int,
  height: S.Int,
})
type SeedPhoto = typeof SeedPhoto.Type

const photoId = (slug: string): string => `photo_${slug}`
const r2KeyOf = (slug: string): string => `originals/${photoId(slug)}-${slug}.jpg`

/** The first four Photos carry the example Tags, so a seeded front page has a
 *  Tag page and a filtered view to link to. */
const EXAMPLE_TAG_COUNT = 4

const SEED_TAGS: ReadonlyArray<SeedTag> = S.Array(SeedTag).make([
  { slug: 'kyoto', label: 'Kyoto' },
  { slug: 'film', label: 'Film' },
  { slug: 'portrait', label: 'Portrait' },
  { slug: 'landscape', label: 'Landscape' },
  { slug: 'street', label: 'Street' },
  { slug: 'night', label: 'Night' },
  { slug: 'bw', label: 'B&W' },
  { slug: 'travel', label: 'Travel' },
])

const SEED_PHOTOS: ReadonlyArray<SeedPhoto> = S.Array(SeedPhoto).make(
  Array.from({ length: 12 }, (_, index) => ({
    title: `Seed Photo ${String(index + 1).padStart(2, '0')}`,
    slug: `seed-photo-${String(index + 1).padStart(2, '0')}`,
    takenAt: `2024-0${String((index % 9) + 1)}-15`,
    width: 1200 + index * 10,
    height: 800 + index * 10,
  })),
)

const tagId = (tag: SeedTag): string => `tag_${tag.slug}`

const photoTagIds = (index: number): ReadonlyArray<string> =>
  index < EXAMPLE_TAG_COUNT ? ['tag_kyoto', 'tag_film'] : []

// ---------------------------------------------------------------------------
// SQL for the dry run
// ---------------------------------------------------------------------------

/**
 * A SQL string literal.
 *
 * The dry run builds statements by interpolation, so a value containing an
 * apostrophe would otherwise close the literal and the rest of the line would
 * be parsed as SQL. `B&W` is in the seed data and does not need it, but the next
 * value added might, and a seed script that breaks on a quote is a bad trade for
 * two lines of escaping.
 */
const sqlText = (value: string): string => `'${value.replaceAll("'", "''")}'`

const sqlNumber = (value: number): string => String(value)

const insertTag = (tag: SeedTag): string =>
  `INSERT OR IGNORE INTO tags (id, slug, label) VALUES (${sqlText(tagId(tag))}, ${sqlText(
    tag.slug,
  )}, ${sqlText(tag.label)});`

const insertPhoto = (photo: SeedPhoto): string => {
  const metadata = JSON.stringify({ caption: `Seed ${photo.title}` })
  // The numbers go in as numbers. `photos` is a STRICT table, so a quoted
  // `'1200'` in an INTEGER column is refused by the engine — the dry run has to
  // print statements the database will actually accept, or it is a script that
  // lies until someone pastes its output.
  const values = [
    photoId(photo.slug),
    photo.slug,
    photo.title,
    r2KeyOf(photo.slug),
    photo.width,
    photo.height,
    photo.takenAt,
    metadata,
  ]
    .map((value) => (typeof value === 'number' ? sqlNumber(value) : sqlText(value)))
    .join(', ')
  return `INSERT OR IGNORE INTO photos (id, slug, title, r2Key, width, height, takenAt, metadata) VALUES (${values});`
}

const insertPhotoTag = (photo: SeedPhoto, tag: string): string =>
  `INSERT OR IGNORE INTO photo_tags (photoId, tagId) VALUES (${sqlText(photoId(photo.slug))}, ${sqlText(
    tag,
  )});`

/** `JSON.parse` as a total function, lifted once rather than per line: a body
 *  that is not JSON is a fact about the answer, not an exception to be caught at
 *  each call site. */
const parseJson = Option.liftThrowable((raw: string): unknown => JSON.parse(raw))

const out = (line: string): Effect.Effect<void> =>
  Effect.sync(() => process.stdout.write(`${line}\n`))

const dryRun: Effect.Effect<void> = Effect.gen(function* () {
  yield* out('-- Seed SQL (dry-run) --')
  yield* out(
    '-- Run with --apply to POST against http://localhost:13371/api/upload (requires pnpm dev)\n',
  )
  for (const tag of SEED_TAGS) yield* out(insertTag(tag))
  for (const photo of SEED_PHOTOS) yield* out(insertPhoto(photo))
  yield* out(`\n-- Link the first ${EXAMPLE_TAG_COUNT} photos to Kyoto + Film as an example`)
  for (const [index, photo] of SEED_PHOTOS.slice(0, EXAMPLE_TAG_COUNT).entries()) {
    for (const tag of photoTagIds(index)) yield* out(insertPhotoTag(photo, tag))
  }
})

// ---------------------------------------------------------------------------
// live apply through the dev API
// ---------------------------------------------------------------------------

const API_ORIGIN = 'http://localhost:13371'
const UPLOAD_URL = `${API_ORIGIN}/api/upload`

/** A 1x1 JPEG, so the upload has a body the ingest path will accept. */
const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k='

/** The decoded JPEG, in an `ArrayBuffer` of its own — `Blob` takes a
 *  `BlobPart`, and a view over a shared buffer is not one. */
const tinyJpeg = (): ArrayBuffer => {
  const bytes = Uint8Array.from(atob(TINY_JPEG_BASE64), (char) => char.charCodeAt(0))
  return bytes.slice().buffer
}

/** The multipart body for one Photo, built the way the upload route parses it:
 *  the file, and the `title` / `slug` / `takenAt` / `tagIds` text fields. */
const uploadForm = (photo: SeedPhoto, tagIds: ReadonlyArray<string>): FormData => {
  const form = new FormData()
  form.set('file', new Blob([tinyJpeg()], { type: 'image/jpeg' }), `${photo.slug}.jpg`)
  form.set('title', photo.title)
  form.set('slug', photo.slug)
  form.set('takenAt', photo.takenAt)
  form.set('tagIds', JSON.stringify(tagIds))
  return form
}

/** One line describing what the API answered, decoded through the same
 *  {@link UploadResponseBody} the Admin reads — so the seed script cannot print
 *  a success the Admin would render as a failure, or the reverse.
 *
 *  The status is kept alongside the decoded body because the two are separate
 *  facts: the body says *what* happened, the status says whether it was
 *  accepted. A body the Worker did not declare falls back to the raw text rather
 *  than to a guess. */
const describeUpload = (status: number, raw: string): string =>
  Option.match(parseJson(raw), {
    onNone: () => `${String(status)} ${raw.trim()}`,
    onSome: (parsed) => {
      const decoded = S.decodeUnknownOption(UploadResponseBody)(parsed)
      if (decoded._tag === 'None') return `${String(status)} ${raw.trim()}`
      const body = decoded.value
      return isUploadError(body)
        ? `${String(status)} refused: ${body.message}`
        : `${String(status)} ${body.id}`
    },
  })

const applySeed: Effect.Effect<number, never, HttpClient.HttpClient> = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient

  let refused = 0
  // One at a time, and deliberately so: each upload writes a Photo, its
  // Renditions and its tag links, and a burst of twelve would be a burst of
  // twelve against a window that admits ten a minute.
  for (const [index, photo] of SEED_PHOTOS.entries()) {
    // A refused upload is a line of output and a non-zero exit, not a crash: the
    // operator is seeding a dev database and wants to see which rows went in,
    // and a connection refused is as much a result as a 400 is. So the whole
    // attempt is a `Result` — transport failure, HTTP refusal and success are
    // three answers to one question, not three control paths.
    const attempt = yield* Effect.result(
      Effect.gen(function* () {
        const response = yield* client.execute(
          HttpClientRequest.post(UPLOAD_URL, {
            body: HttpBody.formData(uploadForm(photo, photoTagIds(index))),
          }),
        )
        // `text` is an Effect at this version, not a promise — the response
        // body is read through the same channel as everything else.
        const raw = yield* response.text
        return describeUpload(response.status, raw)
      }),
    )
    const line = Result.isSuccess(attempt) ? attempt.success : 'request failed'
    yield* out(`  ${photo.slug}: ${line}`)
    if (!Result.isSuccess(attempt) || !line.startsWith('2')) refused += 1
  }
  return refused
})

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

// `pnpm db:seed | head` closes the pipe while the script is still writing, and
// an unhandled `EPIPE` on stdout takes the process down with a stack trace. A
// reader that stopped listening is not a failure of the seed.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0)
  throw error
})

const program = Effect.gen(function* () {
  if (!process.argv.includes('--apply')) {
    yield* dryRun
    return 0
  }
  return yield* applySeed
})

Effect.runPromise(Effect.provide(program, FetchHttpClient.layer)).then(
  (refused) => {
    process.exitCode = refused === 0 ? 0 : 1
  },
  (error: unknown) => {
    process.stderr.write(`seed failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  },
)
