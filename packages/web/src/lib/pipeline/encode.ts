/**
 * Decode, resize, frame, border and encode — all of it in the browser, inside a
 * Web Worker (ported from imgutils). Nothing here touches the server.
 */

import { Effect, type Scope } from 'effect'
import encodeJpeg from '@jsquash/jpeg/encode'
import encodePng from '@jsquash/png/encode'
import resize from '@jsquash/resize'
import encodeWebp from '@jsquash/webp/encode'
import { outputGeometry, type Size } from './geometry'
import {
  DecodeFailed,
  EncodeFailed,
  type ExportResult,
  type ExportSettings,
  type OutputFormat,
  type RenditionSet,
} from './schema'

/** How far the browser's own scaler may shrink a photo before jsquash takes
 *  over: a 26 MP photo decoded straight to ImageData costs ~100 MB. */
const PRE_SHRINK = 2

interface Codec {
  readonly extension: string
  readonly type: string
  readonly encode: (data: ImageData, quality: number) => Promise<ArrayBuffer>
}

const CODECS: Record<OutputFormat, Codec> = {
  jpeg: {
    extension: 'jpg',
    type: 'image/jpeg',
    encode: (data, quality) =>
      encodeJpeg(data, { quality, progressive: true, optimize_coding: true, auto_subsample: true }),
  },
  webp: {
    extension: 'webp',
    type: 'image/webp',
    encode: (data, quality) => encodeWebp(data, { quality, method: 4 }),
  },
  png: { extension: 'png', type: 'image/png', encode: (data) => encodePng(data) },
}

/** The decoded bitmap, closed when the surrounding scope ends — success,
 *  failure or interruption — so a cancelled job never leaks a 100 MB frame. */
export const decode = (file: Blob): Effect.Effect<ImageBitmap, DecodeFailed, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => createImageBitmap(file, { imageOrientation: 'from-image' }),
      catch: () => new DecodeFailed({ message: 'This browser cannot decode the file' }),
    }),
    (bitmap) => Effect.sync(() => bitmap.close()),
  )

const drawToImageData = Effect.fn('pipeline.draw')(function* (
  bitmap: ImageBitmap,
  { width, height }: Size,
) {
  return yield* Effect.try({
    try: () => {
      const context = new OffscreenCanvas(width, height).getContext('2d', {
        willReadFrequently: true,
      })
      if (context === null) throw new Error('canvas unavailable')
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(bitmap, 0, 0, width, height)
      return context.getImageData(0, 0, width, height)
    },
    catch: (cause) => new EncodeFailed({ message: `draw: ${String(cause)}` }),
  })
})

/** The bitmap at `target`, sharp: the browser shrinks to at most 2× the target,
 *  then Lanczos finishes it. Skips both when the target is the source's size. */
const scaled = Effect.fn('pipeline.scale')(function* (
  bitmap: ImageBitmap,
  target: Size,
  method: ExportSettings['method'],
) {
  const shrink =
    Math.max(bitmap.width, bitmap.height) > Math.max(target.width, target.height) * PRE_SHRINK
  const data = yield* drawToImageData(
    bitmap,
    shrink ? { width: target.width * PRE_SHRINK, height: target.height * PRE_SHRINK } : target,
  )
  if (!shrink) return data
  return yield* Effect.tryPromise({
    try: () =>
      resize(data, {
        width: target.width,
        height: target.height,
        method,
        fitMethod: 'stretch',
        premultiply: true,
        linearRGB: true,
      }),
    catch: (cause) => new EncodeFailed({ message: `resize: ${String(cause)}` }),
  })
})

/** Paints the border band, then lays the frame over the middle of it. */
const compose = Effect.fn('pipeline.compose')(function* (
  image: ImageData,
  canvas: Size,
  border: number,
  colours: Pick<ExportSettings, 'background' | 'borderColor'>,
) {
  return yield* Effect.try({
    try: () => {
      const width = canvas.width + border * 2
      const height = canvas.height + border * 2
      const context = new OffscreenCanvas(width, height).getContext('2d', {
        willReadFrequently: true,
      })
      if (context === null) throw new Error('canvas unavailable')
      context.fillStyle = colours.borderColor
      context.fillRect(0, 0, width, height)
      if (border > 0) {
        context.fillStyle = colours.background
        context.fillRect(border, border, canvas.width, canvas.height)
      }
      context.putImageData(
        image,
        border + Math.round((canvas.width - image.width) / 2),
        border + Math.round((canvas.height - image.height) / 2),
      )
      return context.getImageData(0, 0, width, height)
    },
    catch: (cause) => new EncodeFailed({ message: `frame: ${String(cause)}` }),
  })
})

/** The Download panel's export: resize to a width, frame, border, encode. */
export const exportImage = Effect.fn('pipeline.export')(function* (
  file: Blob,
  settings: ExportSettings,
) {
  const bitmap = yield* decode(file)
  const { canvas, border, photo } = outputGeometry(bitmap, settings)
  const image = yield* scaled(bitmap, photo, settings.method)
  const framed =
    border > 0 || image.width !== canvas.width || image.height !== canvas.height
      ? yield* compose(image, canvas, border, settings)
      : image
  const codec = CODECS[settings.format]
  const buffer = yield* Effect.tryPromise({
    try: () => codec.encode(framed, settings.quality),
    catch: (cause) => new EncodeFailed({ message: `${codec.extension}: ${String(cause)}` }),
  })
  return {
    blob: new Blob([buffer], { type: codec.type }),
    extension: codec.extension,
    width: framed.width,
    height: framed.height,
  } satisfies ExportResult
}, Effect.scoped)

/** The two stored WebP renditions from one decode: `small` capped at
 *  `smallLongEdge` on its long edge, `preview` at the source's own size. */
export const makeRenditions = Effect.fn('pipeline.renditions')(function* (
  file: Blob,
  smallLongEdge: number,
  quality: number,
) {
  const bitmap = yield* decode(file)
  const { width, height } = bitmap
  const k = Math.min(1, smallLongEdge / Math.max(width, height))
  const small = yield* scaled(
    bitmap,
    { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) },
    'lanczos3',
  )
  const preview = yield* drawToImageData(bitmap, bitmap)
  const [smallBytes, previewBytes] = yield* Effect.tryPromise({
    try: () =>
      Promise.all([CODECS.webp.encode(small, quality), CODECS.webp.encode(preview, quality)]),
    catch: (cause) => new EncodeFailed({ message: `webp: ${String(cause)}` }),
  })
  return {
    small: new Blob([smallBytes], { type: CODECS.webp.type }),
    preview: new Blob([previewBytes], { type: CODECS.webp.type }),
    width,
    height,
  } satisfies RenditionSet
}, Effect.scoped)
