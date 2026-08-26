import type { PhotoWithTags } from '@photo/shared'

const rawImageUrl = (r2Key: string): string => `/api/image/${encodeURIComponent(r2Key)}`

const transformedUrl = (r2Key: string, width: number): string =>
  `/cdn-cgi/image/width=${String(width)},format=auto${rawImageUrl(r2Key)}`

/** Original HD file — served straight from R2 (the lightbox target). */
export const originalUrl = (photo: PhotoWithTags): string => rawImageUrl(photo.r2Key)

/** Thumb URL: resized in prod via Cloudflare Images, raw in dev. */
export const thumbUrl = (photo: PhotoWithTags): string =>
  import.meta.env.DEV ? rawImageUrl(photo.r2Key) : transformedUrl(photo.r2Key, 400)

/** Full srcset for admin cards: 400/800/1200. */
export const srcSet = (photo: PhotoWithTags): string =>
  import.meta.env.DEV
    ? rawImageUrl(photo.r2Key)
    : [400, 800, 1200]
        .map((width) => `${transformedUrl(photo.r2Key, width)} ${String(width)}w`)
        .join(', ')

/** Sizes attribute for admin cards: justified rows inside a max-w-6xl
 *  container put a typical card near half the content width (≤ 552px). */
export const cardSizes = '(min-width: 1152px) 552px, 50vw'
