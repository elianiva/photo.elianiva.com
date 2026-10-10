/**
 * The default title of an uploaded photo: when it was taken, read from the
 * file's EXIF in the browser (`2026-08-31 14.22.05`). A file with no capture
 * time keeps its filename; either way the title is the operator's to change
 * afterwards.
 */

import { Effect, Option } from 'effect'

const pad = (n: number): string => String(n).padStart(2, '0')

export const formatCaptureTitle = (date: Date): string =>
  `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
  `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`

/** The capture time as a title, or `None`. Total: an unreadable EXIF block is
 *  a photo without a capture time, not a failed upload. */
export const titleFromExif = (file: Blob): Effect.Effect<Option.Option<string>> =>
  Effect.tryPromise(async () => {
    const { default: exifr } = await import('exifr')
    const exif: { DateTimeOriginal?: unknown } | undefined = await exifr.parse(file, [
      'DateTimeOriginal',
    ])
    return exif?.DateTimeOriginal
  }).pipe(
    Effect.map((taken) =>
      taken instanceof Date && !Number.isNaN(taken.getTime())
        ? Option.some(formatCaptureTitle(taken))
        : Option.none(),
    ),
    Effect.orElseSucceed(() => Option.none()),
  )
