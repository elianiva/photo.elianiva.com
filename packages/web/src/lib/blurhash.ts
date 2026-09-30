/**
 * Blurhash helpers — encode in the Admin (browser can decode pixels; the
 * Worker cannot), decode in the Admin grid for placeholder tiles.
 *
 * The component count is the design's (`image.blurhash.x` / `.y`), read from
 * the generated token module rather than restated here.
 */

import { decode, encode } from 'blurhash'

import { imageBlurhashX, imageBlurhashY } from './design-tokens'

/** The long edge the encoder samples down to. A local constant, not a
 *  catalog token: the design fixes the component count (`4 × 3 · 31 chars`)
 *  and says nothing about the sample, so there is nothing to bind to. */
const SAMPLE_SIZE = 32
const COMPONENTS_X = imageBlurhashX
const COMPONENTS_Y = imageBlurhashY

/** Encode a File/ImageBitmapSource to a blurhash string, decoded once. Resolves
 *  to undefined when the browser cannot decode the bytes or canvas is
 *  unavailable — uploads proceed without a placeholder. The pixel dimensions
 *  ride back with the hash because the upload's detail line prints them and
 *  only the decode that produced the hash actually knows them. */
export interface DecodedPlaceholder {
  readonly blurhash: string | undefined
  readonly width: number
  readonly height: number
}

export const encodeBlurhash = async (
  source: ImageBitmapSource,
): Promise<DecodedPlaceholder | undefined> => {
  try {
    const bitmap = await createImageBitmap(source)
    try {
      const { width, height } = bitmap
      const canvas = new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE)
      const context = canvas.getContext('2d')
      if (context === null) return undefined
      // Sample the full frame down to the 32×32 the encoder hashes, so the
      // bitmap can be closed immediately and only 4 KiB of pixels is held.
      context.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      return {
        blurhash: encode(data, SAMPLE_SIZE, SAMPLE_SIZE, COMPONENTS_X, COMPONENTS_Y),
        width,
        height,
      }
    } finally {
      bitmap.close()
    }
  } catch {
    return undefined
  }
}

/** `4 × 3` — the component count the design prints beside `BLURHASH`, read
 *  off the same two tokens the encoder uses. A readout, not a stored
 *  dimension: the design's own `4 × 3` is `image.blurhash.x` / `.y`. */
export const blurhashComponentLabel = (): string => `${imageBlurhashX} × ${imageBlurhashY}`

/** The composition a Blurhash is encoded from, in the terms the Stage draws
 *  it: the frame's proportion, the source's pan and zoom inside it, the
 *  straighten and the mirror, and the Mat around it. It is deliberately not a
 *  `PhotoPresentation` — the delivery facts (quality, format, EXIF policy)
 *  cannot change the pixels, so they are not here, and the readout does not
 *  re-encode when one of them moves. */
export interface CompositionSpec {
  readonly source: { readonly width: number; readonly height: number }
  /** The frame's proportion, width / height — the authored Ratio or the
   *  source's own when none is stored. */
  readonly frameAspect: number
  /** The source's position inside the frame, as the `object-position`
   *  percentages the Stage uses: `50` is centred. */
  readonly panX: number
  readonly panY: number
  /** The crop zoom, with the straighten's own cover scale already folded in. */
  readonly scale: number
  /** The straighten angle, in degrees. */
  readonly rotation: number
  readonly flipX: boolean
  /** The Mat, when the draft has one. `side` is the top/left/right thickness
   *  and `foot` the bottom, both as fractions of the frame's width. */
  readonly mat?: {
    readonly colour: 'white' | 'paper' | 'ink'
    readonly side: number
    readonly foot: number
  }
}

/** Where one composition's parts land in an output box, and the transform its
 *  source is drawn with. Pure, so the geometry the canvas draws and the
 *  geometry a test checks are the same function. */
export interface CompositionLayout {
  /** The inner frame, in output pixels. */
  readonly frame: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  /** The source image's destination rect before the transform. */
  readonly image: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  /** Applied about the frame's centre, in the order the Stage composes it:
   *  `scale(s) rotate(θ) scaleX(flip)`. */
  readonly transform: {
    readonly scale: number
    readonly rotation: number
    readonly flipX: boolean
    readonly originX: number
    readonly originY: number
  }
}

/** Normalise the composition into an `outputW × outputH` box: the Mat is a
 *  fraction of the frame's width, so the frame is laid out in frame-width
 *  units and scaled to the box. The box may be non-square — the encoder
 *  stretches the composition into it, exactly as the upload's own encode
 *  does — which keeps the readout independent of the frame's proportion. */
const compositionLayout = (
  spec: CompositionSpec,
  outputW: number,
  outputH: number,
): CompositionLayout => {
  const frameW = 1
  const frameH = 1 / spec.frameAspect
  const side = spec.mat?.side ?? 0
  const foot = spec.mat?.foot ?? 0
  const totalW = frameW + 2 * side
  const totalH = frameH + side + foot
  const kx = outputW / totalW
  const ky = outputH / totalH
  const x = side * kx
  const y = side * ky
  const width = frameW * kx
  const height = frameH * ky
  const { width: iw, height: ih } = spec.source
  // `object-fit: cover`: the source covers the frame, then `object-position`
  // pans the overflow that leaves.
  const cover = Math.max(width / iw, height / ih)
  const drawnW = iw * cover
  const drawnH = ih * cover
  return {
    frame: { x, y, width, height },
    image: {
      x: x + (width - drawnW) * (spec.panX / 100),
      y: y + (height - drawnH) * (spec.panY / 100),
      width: drawnW,
      height: drawnH,
    },
    transform: {
      scale: spec.scale,
      rotation: spec.rotation,
      flipX: spec.flipX,
      originX: x + width / 2,
      originY: y + height / 2,
    },
  }
}

/** The Mat's colour as the canvas can paint it. The broadsheet token is read
 *  at runtime — the same colour the Stage's `bg-role-mat-*` class paints —
 *  with the catalog's value as the fallback for a document that has no styles
 *  yet (this module is outside the Desk's colour-literal guard on purpose). */
const matColourCSS = (colour: 'white' | 'paper' | 'ink'): string => {
  const fallback: Record<'white' | 'paper' | 'ink', string> = {
    white: '#ffffff',
    paper: '#f3f0e8',
    ink: '#111111',
  }
  if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(`--role-mat-${colour}`)
      .trim()
    if (value !== '') return value
  }
  return fallback[colour]
}

type TwoDContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

/** An offscreen box of the given size. `OffscreenCanvas` where the platform
 *  has it, a detached `<canvas>` otherwise — the old encoder's assumption.
 *  The HTML path sets its own dimensions: a fresh element is 300×150. */
const createCanvas = (width: number, height: number): OffscreenCanvas | HTMLCanvasElement => {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

const context2d = (canvas: OffscreenCanvas | HTMLCanvasElement): TwoDContext | null =>
  canvas.getContext('2d')

/** Draw one composition into a fresh `size × size` canvas and read the pixels
 *  back for the encoder. The Mat is a solid fill behind the frame; the source
 *  is clipped to the frame, covered, panned, then scaled, rotated and mirrored
 *  about the frame's centre — the same order `editor.ts`'s `cropStyle` spells
 *  for the Stage.
 *
 *  The bitmap is drawn as-is and never closed: `compositionSource` caches it
 *  for the whole session, so closing it here would break the next encode. */
export const drawCompositionPixels = (
  bitmap: ImageBitmap,
  spec: CompositionSpec,
  size: number = SAMPLE_SIZE,
): ImageData | undefined => {
  try {
    const canvas = createCanvas(size, size)
    const ctx = context2d(canvas)
    if (ctx === null) return undefined
    if (spec.mat !== undefined) {
      ctx.fillStyle = matColourCSS(spec.mat.colour)
      ctx.fillRect(0, 0, size, size)
    }
    const { frame, image, transform } = compositionLayout(spec, size, size)
    ctx.save()
    ctx.beginPath()
    ctx.rect(frame.x, frame.y, frame.width, frame.height)
    ctx.clip()
    ctx.translate(transform.originX, transform.originY)
    ctx.scale(transform.scale, transform.scale)
    ctx.rotate((transform.rotation * Math.PI) / 180)
    if (transform.flipX) ctx.scale(-1, 1)
    ctx.translate(-transform.originX, -transform.originY)
    ctx.drawImage(bitmap, image.x, image.y, image.width, image.height)
    ctx.restore()
    return ctx.getImageData(0, 0, size, size)
  } catch {
    return undefined
  }
}

/** The decoded originals this module has already fetched, keyed by URL, so a
 *  re-encode after every committed crop change costs one draw and no network.
 *  The bitmap is deliberately never closed: it is shared by every encode in
 *  the session, and the browser evicts it with the page. */
const sources = new Map<string, Promise<ImageBitmap | undefined>>()

/** Fetch and decode an original once. Resolves to undefined when the bytes are
 *  unreachable or the browser cannot decode them, which is a re-encode that is
 *  skipped rather than a failure the Editor has to report. */
export const compositionSource = (url: string): Promise<ImageBitmap | undefined> => {
  const cached = sources.get(url)
  if (cached !== undefined) return cached
  const loaded = fetch(url, { credentials: 'include' })
    .then((response) => (response.ok ? response.blob() : undefined))
    .then((blob) => (blob === undefined ? undefined : createImageBitmap(blob)))
    .catch(() => undefined)
  sources.set(url, loaded)
  return loaded
}

/** Encode a composition's Blurhash from an already-decoded original. */
export const encodeCompositionBlurhash = (
  bitmap: ImageBitmap,
  spec: CompositionSpec,
): string | undefined => {
  const pixels = drawCompositionPixels(bitmap, spec)
  if (pixels === undefined) return undefined
  try {
    return encode(pixels.data, SAMPLE_SIZE, SAMPLE_SIZE, COMPONENTS_X, COMPONENTS_Y)
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
