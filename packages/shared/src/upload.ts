/**
 * The multipart upload contract — the one HTTP endpoint that is not RPC
 * (`POST /api/upload`, the route map in `README.md`).
 *
 * It lives here, in `@photo/shared`, because it is a contract with two
 * readers on two sides of the boundary: the API Worker produces these bodies
 * and the Admin's upload queue parses them. Before this module the two halves
 * were a raw `jsonResponse({ message })` in `api-worker.ts` and a hand-written
 * `{ message?: unknown }` interface in `admin/subscriptions.ts`, each with its
 * own `try { JSON.parse } catch`, so nothing checked that the Worker and the
 * queue still agreed.
 *
 * A failure is a body with a `message`, never a bare status: the upload
 * dialog's failed row prints the message, and `sanitizeError` in the Worker is
 * what decides an operator-actionable rejection from an opaque 500.
 */

import { Schema as S } from 'effect'

/** The Blurhash base83 alphabet, as the encoder in `@photo/web` writes it. The
 *  length bounds are the same two the `UpdatePhoto` payload already enforces, so
 *  an upload and a later Editor save cannot disagree about what a hash is. */
const BLURHASH_PATTERN = /^[0-9A-Za-z#$%*+,-.:;=?@[\]^_{|}~]+$/

/**
 * A Blurhash, as this codebase stores it. Bounds first, then the alphabet: a
 * hash the decoder rejects is a placeholder tile that fails to draw, so it is
 * refused at the boundary rather than stored.
 */
export const Blurhash = S.String.pipe(
  S.check(S.isMinLength(6)),
  S.check(S.isMaxLength(64)),
  S.check(S.isPattern(BLURHASH_PATTERN)),
)
export type Blurhash = typeof Blurhash.Type

/** The multipart `tagIds` field: a JSON array of Tag ids, filtered to the
 *  strings in it. A body that is not an array, or that parses to something
 *  else, is an upload with no tags rather than a failed upload — the picker's
 *  own state is the source of truth, and a tag the id does not resolve to is
 *  `InvalidInput` from the write path (ADR 0001). */
export const TagIdList = S.Array(S.String.pipe(S.check(S.isMaxLength(128)))).pipe(
  S.check(S.isMaxLength(32)),
)

/** What the upload answers with on a rejection. `message` is the operator's
 *  to read: an unsupported ratio names the measured frame, and a 500 says
 *  `internal error` and nothing more. */
export const UploadErrorBody = S.Struct({
  message: S.String,
})
export type UploadErrorBody = typeof UploadErrorBody.Type

/** What the upload answers with on a stored Photo. The three fields are the
 *  ones the Worker minted — the ULID, the slug it landed on, and the R2 key
 *  the original is under.
 *
 *  `renditionsPending` is E6's signal that a stored Photo still owes a
 *  Rendition, and the queue holds such a row at `processing` instead of
 *  publishing it. It is declared here rather than sniffed for because
 *  regeneration is not built yet (CONTEXT.md `Rendition`, #35), so the Worker
 *  always answers `false` — and a client that has to *guess* whether the field
 *  is there is a client whose guess is wrong the day the field first arrives. */
export const UploadSuccessBody = S.Struct({
  id: S.String,
  slug: S.String,
  r2Key: S.String,
  renditionsPending: S.Boolean,
})
export type UploadSuccessBody = typeof UploadSuccessBody.Type

/** The whole `POST /api/upload` response, either way. Decoding the union is
 *  how a caller tells a stored Photo from a rejection without inspecting the
 *  status code. */
export const UploadResponseBody = S.Union([UploadSuccessBody, UploadErrorBody])
export type UploadResponseBody = typeof UploadResponseBody.Type

/** Is this a rejection rather than a stored Photo? Narrowing helper for the
 *  union, so the two readers do not each re-spell `'message' in body`. */
export const isUploadError = (body: UploadResponseBody): body is UploadErrorBody =>
  'message' in body
