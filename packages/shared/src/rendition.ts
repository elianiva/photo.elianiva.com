/**
 * The files a Photo is stored as, and where each one lives in R2.
 *
 * Three files, all produced in the browser before the upload (the Worker only
 * accepts and stores them):
 *
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

export type RenditionKind = 'small' | 'preview'

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
