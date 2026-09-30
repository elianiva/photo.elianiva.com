/**
 * Image metadata extraction (server-side, per the Admin design): width,
 * height, capture date, camera/lens, and the four EXIF facts the public Exif
 * line prints, straight from the uploaded bytes.
 *
 * `exifr` and `image-size` are pure JS and Worker-safe — no native deps.
 * Resizing stays with the Cloudflare Images binding at delivery time
 * (ADR 0002); sharp-class native tools cannot run in Workers anyway.
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
  /** f-number, as written on the barrel: 8, 5.6, 1.8. */
  readonly aperture?: number | undefined
  /** ExposureTime in seconds, as the file states it: 0.001, 1/60 as 0.0166. */
  readonly shutter?: number | undefined
  readonly iso?: number | undefined
  /** Focal length in millimetres, not the 35mm-equivalent. */
  readonly focalLength?: number | undefined
}

/** EXIF coverage in consumer JPEGs is patchy and a stripped tag reads as 0 or
 *  as a nonsense string. Only a positive finite number is a fact worth storing;
 *  anything else stays out of the column so the Exif line can omit it rather
 *  than print `F/0`. */
const exifNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined

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
          pick: [
            'DateTimeOriginal',
            'Model',
            'LensModel',
            'FNumber',
            'ExposureTime',
            'ISO',
            'FocalLength',
          ],
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

    const aperture = exifNumber(exif?.['FNumber'])
    const shutter = exifNumber(exif?.['ExposureTime'])
    const iso = exifNumber(exif?.['ISO'])
    const focalLength = exifNumber(exif?.['FocalLength'])

    return {
      width: dimensions.width,
      height: dimensions.height,
      ...(takenAt !== undefined && { takenAt }),
      ...(typeof exif?.['Model'] === 'string' && { camera: exif['Model'] }),
      ...(typeof exif?.['LensModel'] === 'string' && { lens: exif['LensModel'] }),
      ...(aperture !== undefined && { aperture }),
      ...(shutter !== undefined && { shutter }),
      ...(iso !== undefined && { iso }),
      ...(focalLength !== undefined && { focalLength }),
    }
  })
