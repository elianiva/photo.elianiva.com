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
 * So every image is served as the original it is, straight out of R2 through
 * the Worker's own proxy. The trade is honest and worth naming: a grid of
 * forty plates asks for forty originals. The designed answer is stored
 * Renditions (CONTEXT.md, `Rendition`; regeneration is #35), and until those
 * exist this is what a Free-plan zone can serve. Upgrading the zone would
 * bring the resizer back; that is a plan decision, not a code one.
 */

import type { PhotoWithTags } from '@photo/shared'
import { IMAGE_PATH, apiOrigin } from './api'

/** The original's bytes, via the R2 proxy. */
export const originalUrl = (photo: PhotoWithTags): string => imageUrl(photo.r2Key)

/** By key rather than by Photo, for a view holding only what it needs. */
export const imageUrl = (r2Key: string): string =>
  `${apiOrigin()}${IMAGE_PATH}/${encodeURIComponent(r2Key)}`

/** Sizes attribute for admin cards: justified rows inside a max-w-6xl
 *  container put a typical card near half the content width (≤ 552px). */
export const cardSizes = '(min-width: 1152px) 552px, 50vw'
