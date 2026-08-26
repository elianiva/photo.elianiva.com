/**
 * Blurhash helpers — encode in the Admin (browser can decode pixels; the
 * Worker cannot), decode in the Gallery for placeholder tiles.
 *
 * Matches len's parameters: 4×3 components from a ≤32px sample.
 */

import { decode, encode } from 'blurhash'

const SAMPLE_SIZE = 32
const COMPONENTS_X = 4
const COMPONENTS_Y = 3

/** Encode a File/ImageBitmapSource to a blurhash string. Resolves to null
 *  when the browser cannot decode the bytes or canvas is unavailable —
 *  uploads proceed without a placeholder. */
export const encodeBlurhash = async (source: ImageBitmapSource): Promise<string | undefined> => {
  try {
    const bitmap = await createImageBitmap(source, {
      resizeWidth: SAMPLE_SIZE,
      resizeHeight: SAMPLE_SIZE,
      resizeQuality: 'medium',
    })
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')
      if (context === null) return undefined
      context.drawImage(bitmap, 0, 0)
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
      return encode(data, bitmap.width, bitmap.height, COMPONENTS_X, COMPONENTS_Y)
    } finally {
      bitmap.close()
    }
  } catch {
    return undefined
  }
}

const cache = new Map<string, string>()

/** Decode a blurhash to a small PNG data-URL for CSS background-image use.
 *  Memoized per hash — one decode per Photo, ever. Returns null for hashes
 *  the decoder rejects (not cached — failures are recomputed). */
export const placeholderDataUrl = (hash: string): string | null => {
  const cached = cache.get(hash)
  if (cached !== undefined) return cached
  try {
    const pixels = decode(hash, SAMPLE_SIZE, SAMPLE_SIZE)
    // Copy into a plain ArrayBuffer-backed array — ImageData rejects
    // ArrayBufferLike views.
    const rgba = new Uint8ClampedArray(pixels.length)
    rgba.set(pixels)
    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE_SIZE
    canvas.height = SAMPLE_SIZE
    const context = canvas.getContext('2d')
    if (context === null) return null
    context.putImageData(new ImageData(rgba, SAMPLE_SIZE, SAMPLE_SIZE), 0, 0)
    const dataUrl = canvas.toDataURL('image/png')
    cache.set(hash, dataUrl)
    return dataUrl
  } catch {
    return null
  }
}
