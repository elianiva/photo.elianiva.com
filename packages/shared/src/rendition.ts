/**
 * The files a Photo is stored as, and where each one lives in R2.
 *
 * Four files, all produced in the browser (the Worker only accepts and stores
 * them):
 *
 * - `thumb`   — WebP, long edge capped at {@link THUMB_LONG_EDGE}. What the
 *               grids and the Library draw. Optional: older Photos have none.
 * - `small`   — WebP, long edge capped at {@link SMALL_LONG_EDGE}. The grids,
 *               the Library and the public frontpage.
 * - `preview` — WebP at the original's own pixel size. What a click opens.
 * - `full`    — the original JPEG, byte for byte. The one a download serves.
 *
 * The two WebP keys are derived from the Photo's id rather than stored, so
 * there is no column that can disagree with the object.
 */

export const SMALL_LONG_EDGE = 1600
export const RENDITION_QUALITY = 90

/** The grid's file: the long edge a justified row ever draws a frame at, with
 *  headroom for a 2x screen, and a quality the eye cannot tell from 90 at
 *  that size. A photograph uploaded before `thumb` existed has none until the
 *  Library's backfill makes it (`photos.thumb` says which). */
export const THUMB_LONG_EDGE = 640
export const THUMB_QUALITY = 80

export type RenditionKind = 'small' | 'preview' | 'thumb'

export const RENDITION_PREFIX = 'renditions/'
export const ORIGINAL_PREFIX = 'originals/'

export const renditionKey = (photoId: string, kind: RenditionKind): string =>
  `${RENDITION_PREFIX}${photoId}/${kind}.webp`

/** Every key the proxy may serve: an original or a rendition, nothing else. */
export const isServableKey = (key: string): boolean =>
  key.startsWith(ORIGINAL_PREFIX) || key.startsWith(RENDITION_PREFIX)

/** `RIFF....WEBP`. The bytes' own header, because a declared type is not proof. */
export const hasWebpMagic = (bytes: Uint8Array): boolean =>
  bytes.length >= 12 &&
  bytes[0] === 0x52 &&
  bytes[1] === 0x49 &&
  bytes[2] === 0x46 &&
  bytes[3] === 0x46 &&
  bytes[8] === 0x57 &&
  bytes[9] === 0x45 &&
  bytes[10] === 0x42 &&
  bytes[11] === 0x50
