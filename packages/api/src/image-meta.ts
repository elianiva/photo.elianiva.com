/**
 * Image metadata extraction (server-side, per the Admin design): width,
 * height, capture date, and camera/lens straight from the uploaded bytes.
 *
 * `exifr` and `image-size` are pure JS and Worker-safe — no native deps.
 * Resizing stays with the Cloudflare Images binding at delivery time
 * (ADR 0005); sharp-class native tools cannot run in Workers anyway.
 */

import { DateTime, Option as Opt, Effect } from 'effect'
import { imageSize } from 'image-size'
import exifr from 'exifr'
import { StorageError, describeCause } from '@photo/shared'

export interface ImageMeta {
  readonly width: number
  readonly height: number
  /** Capture date as YYYY-MM-DD, when EXIF carries one. */
  readonly takenAt?: string | undefined
  readonly camera?: string | undefined
  readonly lens?: string | undefined
}

/** EXIF timestamps → YYYY-MM-DD via the effect DateTime module. */
const isoDayOf = (input: Date | string): string | undefined => {
  const parsed = DateTime.make(input)
  if (Opt.isNone(parsed)) return undefined
  return DateTime.formatIsoDateUtc(parsed.value)
}

/** Decode header/EXIF metadata from image bytes. Fails only when the bytes
 *  are not a decodable image. */
export const extractImageMeta = (bytes: ArrayBuffer): Effect.Effect<ImageMeta, StorageError> =>
  Effect.gen(function* () {
    const dimensions = yield* Effect.try({
      try: () => imageSize(new Uint8Array(bytes)),
      catch: (cause) =>
        new StorageError({ message: 'Not a readable image', cause: describeCause(cause) }),
    })
    if (typeof dimensions.width !== 'number' || typeof dimensions.height !== 'number') {
      return yield* new StorageError({ message: 'Image has no dimensions' })
    }

    // EXIF is best-effort: formats without it (PNG scans etc.) just omit fields.
    const exif = yield* Effect.tryPromise({
      try: async () => {
        const parsed: Record<string, unknown> | undefined = await exifr.parse(bytes, {
          pick: ['DateTimeOriginal', 'Model', 'LensModel'],
          tiff: true,
          exif: true,
          translateValues: false,
        })
        return parsed
      },
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => undefined))

    const takenAtRaw: unknown = exif?.['DateTimeOriginal']
    const takenAt =
      takenAtRaw instanceof Date
        ? isoDayOf(takenAtRaw)
        : typeof takenAtRaw === 'string'
          ? isoDayOf(takenAtRaw)
          : undefined

    return {
      width: dimensions.width,
      height: dimensions.height,
      ...(takenAt !== undefined && { takenAt }),
      ...(typeof exif?.['Model'] === 'string' && { camera: exif['Model'] }),
      ...(typeof exif?.['LensModel'] === 'string' && { lens: exif['LensModel'] }),
    }
  })
