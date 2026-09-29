/**
 * The Exif line — the one string under a public plate that names how the Photo
 * was made: `X-T20 · 25MM · F/8 · 1/1000 · ISO 200 · 31 AUG`
 *
 * Pure and total. A fact the Photo does not carry is a segment that is not
 * printed: never a `0`, never a placeholder, never an empty gap between two
 * separators. A Photo with nothing to say yields `null` so the caller omits
 * the element instead of rendering an empty one.
 *
 * The camera body is read out of the `metadata` blob rather than a column
 * (CONTEXT.md) — the four numbers beside it are columns. `PhotoWithTags`
 * satisfies this shape structurally, so a view hands a Photo straight in.
 */

import { DateTime, Option as Opt } from 'effect'

export interface ExifFacts {
  readonly takenAt?: string | null | undefined
  readonly aperture?: number | null | undefined
  readonly shutter?: number | null | undefined
  readonly iso?: number | null | undefined
  readonly focalLength?: number | null | undefined
  readonly metadata?: { readonly camera?: string | null | undefined } | null | undefined
}

const SEPARATOR = ' · '

const isText = (value: string | undefined): value is string => value !== undefined

/** Absent rather than empty, and absent rather than a crash: a blob edited by
 *  hand can hold a number where a string is typed. A blank or non-string
 *  segment is a dangling separator. */
const text = (value: string | null | undefined): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** A fact worth printing, or nothing. Zero and negatives are how a stripped
 *  header or a hand-edited row reach a column, and `F/0` would be a lie. A value
 *  that `String` renders in exponent notation is 20-odd orders of magnitude
 *  outside anything a camera records, and is dropped rather than printed as
 *  `F/1E+21`. */
const positive = (value: number | null | undefined): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return String(value).includes('e') ? undefined : value
}

/** A camera number as a photographer writes it: `2`, `1.8`, `0.95`, `125` —
 *  never `2.0`, because no lens is marked f/2.0, and never rounded past its own
 *  magnitude, because a 0.95 lens is not a 1.0 lens. */
const number = (value: number): string => String(Math.round(value * 100) / 100)

/** `2S` at or above a second; below one, the fraction a camera is marked with
 *  (`1/1000`). A time no shutter is marked with is not written as a fraction:
 *  0.7s is `0.7S`, not `1/1.4` — which would read as an aperture and sit in
 *  the line beside the real one. */
const shutterSpeed = (seconds: number): string => {
  if (seconds >= 1) return `${number(seconds)}S`
  const denominator = 1 / seconds
  const whole = Math.round(denominator)
  const marked = whole >= 2 && Math.abs(whole - denominator) < 0.05
  return marked ? `1/${String(whole)}` : `${number(seconds)}S`
}

/** `31 AUG` — two-digit day, three-letter month, no year. `takenAt` is the
 *  `YYYY-MM-DD` day the schema stores, so only the date part is read and the
 *  day is read back out of the input rather than recomputed: no zone, no clock,
 *  nothing for a Worker's locale to move. A calendar-invalid day such as
 *  `2025-02-30` is dropped rather than rolled forward into an invented date. */
const dayMonth = (takenAt: string | null | undefined): string | undefined => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(takenAt?.trim() ?? '')
  if (parts === null) return undefined
  const [, year, month, day] = parts
  if (year === undefined || month === undefined || day === undefined) return undefined
  const stated = `${year}-${month}-${day}`
  const parsed = DateTime.make(stated)
  if (Opt.isNone(parsed)) return undefined
  if (DateTime.formatIsoDateUtc(parsed.value) !== stated) return undefined
  return `${day} ${DateTime.formatUtc(parsed.value, { month: 'short', locale: 'en-US' })}`
}

/** The Exif line, or `null` when the Photo carries none of its facts. */
export const formatExifLine = (photo: ExifFacts): string | null => {
  const aperture = positive(photo.aperture)
  const shutter = positive(photo.shutter)
  const iso = positive(photo.iso)
  const focalLength = positive(photo.focalLength)

  const segments: ReadonlyArray<string | undefined> = [
    text(photo.metadata?.camera),
    focalLength === undefined ? undefined : `${number(focalLength)}MM`,
    aperture === undefined ? undefined : `F/${number(aperture)}`,
    shutter === undefined ? undefined : shutterSpeed(shutter),
    iso === undefined ? undefined : `ISO ${number(iso)}`,
    dayMonth(photo.takenAt),
  ]

  const line = segments.filter(isText).join(SEPARATOR)
  return line === '' ? null : line.toUpperCase()
}
