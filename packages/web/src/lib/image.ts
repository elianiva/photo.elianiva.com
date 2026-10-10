/**
 * Image URLs, and why there is only one of them.
 *
 * There is a second, shorter way to spell these URLs — Cloudflare's
 * `/cdn-cgi/image/width=…` zone resizer — and it is gone on purpose. Image
 * Resizing is plan-gated: this zone is on the Free plan, where the
 * `image_resizing` setting reports `editable: false`, so every request to
 * `/cdn-cgi/image` answers 404 no matter what is asked of it. A URL builder for
 * a delivery path that cannot work is worse than no URL builder, because the
 * 404 surfaces as a missing photograph rather than as a mistake.
 *
 * So every image is a stored file served straight out of R2 through the
 * Worker's own proxy: the `small` and `preview` WebP renditions the browser made
 * at upload (CONTEXT.md, `Rendition`), or the original JPEG for a download.
 */

import { renditionKey, type PhotoWithTags, type RenditionKind } from '@photo/shared'
import { IMAGE_PATH, apiOrigin } from './api'

/** A stored WebP rendition (`small`: 1600px long edge; `preview`: full size),
 *  via the R2 proxy. The browser produces both at upload, so every Photo has
 *  them. */
export const renditionUrl = (photoId: string, kind: RenditionKind): string =>
  imageUrl(renditionKey(photoId, kind))

/** The grids, the Library and the frontpage. */
export const smallUrl = (photo: Pick<PhotoWithTags, 'id'>): string =>
  renditionUrl(photo.id, 'small')

/** What a click opens: the original's pixel size, as WebP. */
export const previewUrl = (photo: Pick<PhotoWithTags, 'id'>): string =>
  renditionUrl(photo.id, 'preview')

/** The original JPEG's bytes, via the R2 proxy. The download's source. */
export const originalUrl = (photo: PhotoWithTags): string => imageUrl(photo.r2Key)

/** By key rather than by Photo, for a view holding only what it needs. */
export const imageUrl = (r2Key: string): string =>
  `${apiOrigin()}${IMAGE_PATH}/${encodeURIComponent(r2Key)}`

/** Sizes attribute for admin cards: justified rows inside a max-w-6xl
 *  container put a typical card near half the content width (≤ 552px). */
export const cardSizes = '(min-width: 1152px) 552px, 50vw'
