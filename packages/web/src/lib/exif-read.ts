/**
 * What the browser can read out of a dropped file's EXIF, for the upload row to
 * show as soon as the file lands. Unlike {@link titleFromExif} this keeps the
 * reason a read came back empty — a missing block and a parser that threw look
 * the same downstream, and the operator needs to tell them apart.
 */

import { Effect } from 'effect'
import { exifDetails } from '@photo/shared'

import { formatCaptureTitle } from './exif-title'

export interface ExifRead {
  /** `Camera X-T20`, `Aperture f/8`, … in reading order. Empty when nothing was read. */
  readonly facts: ReadonlyArray<string>
  /** Why `facts` is empty or short of a capture time: no EXIF block, or a thrown parse. */
  readonly problem?: string | undefined
}

const asDate = (value: unknown): Date | undefined =>
  value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' ? value : undefined

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

export const factsOfExif = (exif: Record<string, unknown> | undefined): ExifRead => {
  if (exif === undefined) return { facts: [], problem: 'No EXIF block in this file' }
  const taken = asDate(exif['DateTimeOriginal'])
  const day = taken === undefined ? undefined : formatCaptureTitle(taken)
  const rows = exifDetails({
    aperture: asNumber(exif['FNumber']),
    shutter: asNumber(exif['ExposureTime']),
    iso: asNumber(exif['ISO']),
    focalLength: asNumber(exif['FocalLength']),
    metadata: { camera: asString(exif['Model']), lens: asString(exif['LensModel']) },
  }).map(({ label, value }) => `${label} ${value}`)
  const facts = day === undefined ? rows : [...rows, `Taken ${day}`]
  return {
    facts,
    problem:
      taken === undefined
        ? exif['DateTimeOriginal'] === undefined
          ? 'No capture date (DateTimeOriginal) in EXIF'
          : `Capture date unreadable: ${JSON.stringify(exif['DateTimeOriginal'])}`
        : undefined,
  }
}

/** Total: a parser that throws is an `ExifRead` with a `problem`, never a failure. */
export const readExif = (file: Blob): Effect.Effect<ExifRead> =>
  Effect.tryPromise(async () => {
    const { default: exifr } = await import('exifr')
    const exif: Record<string, unknown> | undefined = await exifr.parse(file, [
      'DateTimeOriginal',
      'Model',
      'LensModel',
      'FNumber',
      'ExposureTime',
      'ISO',
      'FocalLength',
    ])
    return factsOfExif(exif)
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed<ExifRead>({
        facts: [],
        problem: `EXIF read failed: ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`,
      }),
    ),
  )
