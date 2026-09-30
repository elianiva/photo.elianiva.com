/**
 * Shared seeding vocabulary for the service tests. Everything here goes through
 * the live services or through the migrated fake, so a fixture can never drift
 * from the schema it writes into.
 */

import { Effect } from 'effect'
import type { PhotoPresentation, PhotoStatus, SettingsInput } from '@photo/shared'
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

/**
 * What migration 0004 gives a Photo nobody has edited, written out once. Both
 * the service and the RPC handler answer for an unedited row, and a second
 * hand-copy of these fifteen numbers is a second thing to forget to update when
 * the migration changes.
 */
export const PRESENTATION_DEFAULTS = {
  cropX: 0,
  cropY: 0,
  cropScale: 1,
  cropFlipX: false,
  level: null,
  borderEnabled: false,
  borderStyle: null,
  borderColour: null,
  borderWidth: null,
  previewLongEdge: 1200,
  previewFormat: 'avif',
  previewQuality: 82,
  fullQuality: 92,
  keepExif: true,
  removeGps: true,
} as const satisfies PhotoPresentation

/** The migration 0005 column defaults — what the Settings row holds before any
 *  save. `photo-service.test.ts` and `settings.test.ts` both read them off a
 *  freshly migrated database, so they are written once, here. */
export const SETTINGS_DEFAULTS = {
  defaultPreviewLongEdge: 1200,
  defaultPreviewFormat: 'avif',
  defaultPreviewQuality: 82,
  defaultFullQuality: 92,
  watermarkEnabled: false,
  watermarkColour: 'white',
  watermarkPosition: 'bottom-right',
  defaultKeepExif: true,
  defaultRemoveGps: true,
  retainForever: true,
} as const satisfies SettingsInput
