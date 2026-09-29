/**
 * Shared seeding vocabulary for the service tests. Everything here goes through
 * the live services or through the migrated fake, so a fixture can never drift
 * from the schema it writes into.
 */

import { Effect } from 'effect'
import type { PhotoStatus } from '@photo/shared'
import type { CreatePhotoInput } from '../photo'
import { PhotoService } from '../photo'
import { TagService } from '../tag'
import { withTestServices, type TestHarness } from './harness'

export const JPEG_BYTES = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(4)
  new Uint8Array(buffer).set([0xff, 0xd8, 0xff, 0xdb])
  return buffer
}

export interface PhotoSeed {
  readonly slug: string
  readonly title: string
  readonly r2Key?: string
  readonly takenAt?: string
  /** The four EXIF facts `extractImageMeta` reads off the original. */
  readonly aperture?: number
  readonly shutter?: number
  readonly iso?: number
  readonly focalLength?: number
  readonly metadata?: string
  readonly blurhash?: string
  readonly contentType?: string
  readonly width?: number
  readonly height?: number
  readonly tagIds?: ReadonlyArray<string>
}

const toCreateInput = (seed: PhotoSeed): CreatePhotoInput => ({
  slug: seed.slug,
  title: seed.title,
  r2Key: seed.r2Key ?? `originals/${seed.slug}.jpg`,
  width: seed.width ?? 1200,
  height: seed.height ?? 800,
  takenAt: seed.takenAt,
  aperture: seed.aperture,
  shutter: seed.shutter,
  iso: seed.iso,
  focalLength: seed.focalLength,
  metadata: seed.metadata ?? '{}',
  blurhash: seed.blurhash,
  contentType: seed.contentType ?? 'image/jpeg',
  bytes: JPEG_BYTES(),
  tagIds: seed.tagIds ?? [],
})

export const createTag = (harness: TestHarness, slug: string, label: string) =>
  Effect.runPromise(
    withTestServices(
      TagService.use((service) => service.create({ slug, label })),
      harness,
    ),
  )

/** The SITE copy on the Settings row, in the shape `readSiteCopy` reads. No
 *  settings service exists yet, so this writes the migrated row directly
 *  rather than inventing a second way to reach it. */
export const setSiteCopy = (
  harness: TestHarness,
  copy: {
    volume?: string
    motto?: string | null
    aboutCopy?: string | null
    sections?: string | null
  },
): Promise<unknown> => {
  const fields: Array<string> = []
  const binds: Array<string | null> = []
  if (copy.volume !== undefined) {
    fields.push('volume = ?')
    binds.push(copy.volume)
  }
  for (const column of ['motto', 'aboutCopy', 'sections'] as const) {
    if (copy[column] !== undefined) {
      fields.push(`${column} = ?`)
      binds.push(copy[column])
    }
  }
  if (fields.length === 0) return Promise.resolve(undefined)
  return harness.db
    .prepare(`UPDATE settings SET ${fields.join(', ')} WHERE id = 1`)
    .bind(...binds)
    .run()
}

export const createPhoto = (harness: TestHarness, seed: PhotoSeed) =>
  Effect.runPromise(
    withTestServices(
      PhotoService.use((service) => service.create(toCreateInput(seed))),
      harness,
    ),
  )

/** Resolve the failure channel so a typed error can be asserted as a value. */
export const fail = <E>(effect: Effect.Effect<unknown, E>): Promise<E> =>
  Effect.runPromise(effect.pipe(Effect.flip))

export const setPhotoStatus = (harness: TestHarness, id: string, status: PhotoStatus) =>
  Effect.runPromise(
    withTestServices(
      PhotoService.use((service) => service.setStatus(id, status)),
      harness,
    ),
  )

export const trashPhoto = (harness: TestHarness, id: string) =>
  Effect.runPromise(
    withTestServices(
      PhotoService.use((service) => service.trash(id)),
      harness,
    ),
  )
