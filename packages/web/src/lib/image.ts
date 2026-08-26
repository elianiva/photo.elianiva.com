import type { PhotoWithTags } from '@photo/shared'

const rawImageUrl = (r2Key: string): string => `/api/image/${encodeURIComponent(r2Key)}`

const transformedUrl = (r2Key: string, width: number): string =>
  `/cdn-cgi/image/width=${String(width)},format=auto${rawImageUrl(r2Key)}`

/** Thumb URL: resized in prod via Cloudflare Images, raw in dev. */
export const thumbUrl = (photo: PhotoWithTags): string =>
  import.meta.env.DEV ? rawImageUrl(photo.r2Key) : transformedUrl(photo.r2Key, 400)

/** Full srcset for gallery/admin cards: 400/800/1200. */
export const srcSet = (photo: PhotoWithTags): string =>
  import.meta.env.DEV
    ? rawImageUrl(photo.r2Key)
    : [400, 800, 1200].map((width) => `${transformedUrl(photo.r2Key, width)} ${String(width)}w`).join(', ')

/** Sizes attribute for masonry/grid cards. */
export const cardSizes =
  '(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw'

/** Public gallery hero sizes: full-width cards. */
export const gallerySizes =
  '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw'
