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

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = (bytes: Uint8Array, start: number, end: number): number => {
  let crc = 0xffffffff
  for (let i = start; i < end; i += 1)
    crc = (CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0
  return (crc ^ 0xffffffff) >>> 0
}

const adler32 = (bytes: Uint8Array): number => {
  let s1 = 1
  let s2 = 0
  for (let i = 0; i < bytes.length; i += 1) {
    s1 = (s1 + bytes[i]!) % 65521
    s2 = (s2 + s1) % 65521
  }
  return ((s2 << 16) | s1) >>> 0
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- globalThis.Buffer is Node-only, probe without tightening global type
  const g = globalThis as unknown as {
    Buffer?: { from(v: Uint8Array): { toString(e: string): string } }
  }
  if (g.Buffer !== undefined) return g.Buffer.from(bytes).toString('base64')
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

const rgbaToPngDataUrl = (
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray,
): string => {
  const rowBytes = width * 4
  const filtered = new Uint8Array(height * (1 + rowBytes))
  let off = 0
  for (let y = 0; y < height; y += 1) {
    filtered[off++] = 0
    filtered.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), off)
    off += rowBytes
  }
  const len = filtered.length
  const nlen = 0xffff ^ len
  const zlib = new Uint8Array(2 + 1 + 2 + 2 + len + 4)
  let p = 0
  zlib[p++] = 0x78
  zlib[p++] = 0x01
  zlib[p++] = 0x01
  zlib[p++] = len & 0xff
  zlib[p++] = (len >>> 8) & 0xff
  zlib[p++] = nlen & 0xff
  zlib[p++] = (nlen >>> 8) & 0xff
  zlib.set(filtered, p)
  p += len
  const adler = adler32(filtered)
  zlib[p++] = (adler >>> 24) & 0xff
  zlib[p++] = (adler >>> 16) & 0xff
  zlib[p++] = (adler >>> 8) & 0xff
  zlib[p++] = adler & 0xff

  const pngLen = 8 + (4 + 4 + 13 + 4) + (4 + 4 + zlib.length + 4) + (4 + 4 + 4)
  const png = new Uint8Array(pngLen)
  let o = 0
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], o)
  o += 8
  const writeChunk = (type: string, data: Uint8Array): void => {
    const t0 = type.charCodeAt(0)
    const t1 = type.charCodeAt(1)
    const t2 = type.charCodeAt(2)
    const t3 = type.charCodeAt(3)
    png[o++] = (data.length >>> 24) & 0xff
    png[o++] = (data.length >>> 16) & 0xff
    png[o++] = (data.length >>> 8) & 0xff
    png[o++] = data.length & 0xff
    const typeStart = o
    png[o++] = t0
    png[o++] = t1
    png[o++] = t2
    png[o++] = t3
    png.set(data, o)
    o += data.length
    const crc = crc32(png, typeStart, o)
    png[o++] = (crc >>> 24) & 0xff
    png[o++] = (crc >>> 16) & 0xff
    png[o++] = (crc >>> 8) & 0xff
    png[o++] = crc & 0xff
  }
  const ihdr = new Uint8Array(13)
  ihdr[0] = (width >>> 24) & 0xff
  ihdr[1] = (width >>> 16) & 0xff
  ihdr[2] = (width >>> 8) & 0xff
  ihdr[3] = width & 0xff
  ihdr[4] = (height >>> 24) & 0xff
  ihdr[5] = (height >>> 16) & 0xff
  ihdr[6] = (height >>> 8) & 0xff
  ihdr[7] = height & 0xff
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  writeChunk('IHDR', ihdr)
  writeChunk('IDAT', zlib)
  writeChunk('IEND', new Uint8Array(0))
  return `data:image/png;base64,${bytesToBase64(png)}`
}

/** Decode a blurhash to a small PNG data-URL for CSS background-image use.
 *  Memoized per hash — one decode per Photo, ever. Returns null for hashes
 *  the decoder rejects (not cached — failures are recomputed). */
export const placeholderDataUrl = (hash: string): string | null => {
  const cached = cache.get(hash)
  if (cached !== undefined) return cached
  try {
    const pixels = decode(hash, SAMPLE_SIZE, SAMPLE_SIZE)
    const rgba = new Uint8ClampedArray(pixels.length)
    rgba.set(pixels)
    let dataUrl: string | null = null
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = SAMPLE_SIZE
        canvas.height = SAMPLE_SIZE
        const context = canvas.getContext('2d')
        if (context !== null) {
          context.putImageData(new ImageData(rgba, SAMPLE_SIZE, SAMPLE_SIZE), 0, 0)
          dataUrl = canvas.toDataURL('image/png')
        }
      } catch {
        dataUrl = null
      }
    }
    if (dataUrl === null) dataUrl = rgbaToPngDataUrl(SAMPLE_SIZE, SAMPLE_SIZE, rgba)
    cache.set(hash, dataUrl)
    return dataUrl
  } catch {
    return null
  }
}
