/**
 * A real EXIF segment, built here rather than checked in as a binary: the
 * extraction is a mapping from the tags `exifr` names, and the only way to
 * prove the mapping is to hand `exifr` a file that carries the tags.
 *
 * The bytes are a 400×200 baseline JPEG (SOI, APP1, SOF0, EOI) with a
 * big-endian TIFF header in APP1: IFD0 holds Make / Model / ExifIFD, and the
 * Exif IFD holds the exposure tags. An absent tag is simply not written, which
 * is what patchy EXIF coverage in a consumer JPEG looks like.
 */

export interface ExifTags {
  readonly make?: string | undefined
  readonly model?: string | undefined
  readonly dateTimeOriginal?: string | undefined
  readonly exposureTime?: readonly [number, number] | undefined
  readonly fNumber?: readonly [number, number] | undefined
  readonly iso?: number | undefined
  readonly focalLength?: readonly [number, number] | undefined
}

const ASCII = 2
const SHORT = 3
const LONG = 4
const RATIONAL = 5

const TAG = {
  make: 0x010f,
  model: 0x0110,
  exposureTime: 0x829a,
  fNumber: 0x829d,
  iso: 0x8827,
  dateTimeOriginal: 0x9003,
  focalLength: 0x920a,
  exifIfd: 0x8769,
} as const

type Entry = readonly [tag: number, type: number, count: number, value: number]

const WIDTH = 400
const HEIGHT = 200

/** Big-endian TIFF. Layout is fixed so the pointers below are literals. */
export const exifSegment = (tags: ExifTags): Uint8Array => {
  const ifd0: Array<Entry> = []
  if (tags.make !== undefined) ifd0.push([TAG.make, ASCII, tags.make.length + 1, 50])
  if (tags.model !== undefined) ifd0.push([TAG.model, ASCII, tags.model.length + 1, 59])
  ifd0.push([TAG.exifIfd, LONG, 1, 65])

  const exif: Array<Entry> = []
  if (tags.exposureTime !== undefined) exif.push([TAG.exposureTime, RATIONAL, 1, 131])
  if (tags.fNumber !== undefined) exif.push([TAG.fNumber, RATIONAL, 1, 139])
  if (tags.iso !== undefined) exif.push([TAG.iso, SHORT, 1, tags.iso])
  if (tags.focalLength !== undefined) exif.push([TAG.focalLength, RATIONAL, 1, 147])
  if (tags.dateTimeOriginal !== undefined) {
    exif.push([TAG.dateTimeOriginal, ASCII, 20, 155])
  }

  const view = new DataView(new ArrayBuffer(175))
  const u16 = (at: number, value: number): void => view.setUint16(at, value)
  const u32 = (at: number, value: number): void => view.setUint32(at, value)
  const ascii = (at: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1)
      view.setUint8(at + index, text.charCodeAt(index))
    view.setUint8(at + text.length, 0)
  }

  u16(0, 0x4d4d) // "MM", big-endian
  u16(2, 0x002a)
  u32(4, 8) // IFD0 at 8

  const writeIfd = (at: number, entries: ReadonlyArray<Entry>): void => {
    u16(at, entries.length)
    entries.forEach((entry, index) => {
      const at0 = at + 2 + index * 12
      u16(at0, entry[0])
      u16(at0 + 2, entry[1])
      u32(at0 + 4, entry[2])
      // A SHORT is left-aligned in the value field, everything else is a pointer.
      if (entry[1] === SHORT) u16(at0 + 8, entry[3])
      else u32(at0 + 8, entry[3])
    })
    u32(at + 2 + entries.length * 12, 0)
  }

  writeIfd(8, ifd0)
  writeIfd(65, exif)
  if (tags.make !== undefined) ascii(50, tags.make)
  if (tags.model !== undefined) ascii(59, tags.model)
  if (tags.exposureTime !== undefined) {
    u32(131, tags.exposureTime[0])
    u32(135, tags.exposureTime[1])
  }
  if (tags.fNumber !== undefined) {
    u32(139, tags.fNumber[0])
    u32(143, tags.fNumber[1])
  }
  if (tags.focalLength !== undefined) {
    u32(147, tags.focalLength[0])
    u32(151, tags.focalLength[1])
  }
  if (tags.dateTimeOriginal !== undefined) ascii(155, tags.dateTimeOriginal)

  return new Uint8Array(view.buffer)
}

/** A decodable 400x200 baseline JPEG carrying `exif` in an APP1 segment: SOI,
 *  APP1, SOF0, EOI. `tags` empty is an EXIF block with nothing in it, which is
 *  what a stripped consumer JPEG looks like. */
export const jpegWith = (tags: ExifTags): ArrayBuffer => {
  const exif = exifSegment(tags)
  const be16 = (value: number): ReadonlyArray<number> => [value >> 8, value & 0xff]
  const bytes: Array<number> = [0xff, 0xd8]

  // The length counts itself, the six identifier bytes, and the TIFF block.
  bytes.push(0xff, 0xe1, ...be16(2 + 6 + exif.length), 0x45, 0x78, 0x69, 0x66, 0x00, 0x00)
  bytes.push(...exif)

  bytes.push(0xff, 0xc0, ...be16(17), 0x08, ...be16(HEIGHT), ...be16(WIDTH), 0x03)
  for (let component = 0; component < 3; component += 1) bytes.push(component + 1, 0x11, 0x00)
  bytes.push(0xff, 0xd9)

  return new Uint8Array(bytes).buffer
}
