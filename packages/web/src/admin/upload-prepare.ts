/**
 * Everything an upload needs that only the browser can make: the two WebP
 * renditions, the capture-time title and the Blurhash.
 *
 * Preparation is a job per queue item, run as a fiber of its own and held here
 * by item id. That is what lets the queue work ahead: while one photograph
 * uploads, the next few are already being decoded and encoded, bounded by the
 * pipeline's worker semaphore. The upload stream joins the item's fiber when it
 * gets there, and removing or cancelling an item interrupts it (which
 * terminates its Web Worker).
 */

import { Effect, Fiber, Option } from 'effect'
import { RENDITION_QUALITY, SMALL_LONG_EDGE } from '@photo/shared'

import { encodeBlurhash } from '@/lib/blurhash'
import { titleFromExif } from '@/lib/exif-title'
import { ImagePipeline } from '@/lib/pipeline/service'
import type { PipelineError, RenditionSet } from '@/lib/pipeline/service'

export interface PreparedUpload {
  readonly renditions: RenditionSet
  /** The capture time, when the file has one. */
  readonly title: Option.Option<string>
  readonly blurhash: string | undefined
}

const prepare = Effect.fn('upload.prepare')(function* (file: File) {
  const pipeline = yield* ImagePipeline
  // The title read is cheap and independent of the encode, so it overlaps it.
  const [renditions, title] = yield* Effect.all(
    [
      pipeline.renditions(file, { smallLongEdge: SMALL_LONG_EDGE, quality: RENDITION_QUALITY }),
      titleFromExif(file),
    ],
    { concurrency: 'unbounded' },
  )
  // Hashed off the small rendition, so the original is not decoded again.
  const placeholder = yield* Effect.promise(() => encodeBlurhash(renditions.small))
  return { renditions, title, blurhash: placeholder?.blurhash } satisfies PreparedUpload
})

const jobs = new Map<string, Fiber.Fiber<PreparedUpload, PipelineError>>()

/** Start preparing `file` unless it already is. Idempotent, so the queue can
 *  call it for every item it wants warm. */
export const startPrepare = (
  itemId: string,
  file: File,
): Fiber.Fiber<PreparedUpload, PipelineError> => {
  const existing = jobs.get(itemId)
  if (existing !== undefined) return existing
  const fiber = Effect.runFork(prepare(file).pipe(Effect.provide(ImagePipeline.layer)))
  jobs.set(itemId, fiber)
  return fiber
}

/** The item's prepared upload, starting the job if nothing has. A failure is
 *  forgotten, so `Retry` prepares again instead of replaying the error. */
export const awaitPrepared = (
  itemId: string,
  file: File,
): Effect.Effect<PreparedUpload, PipelineError> =>
  Effect.suspend(() => Fiber.join(startPrepare(itemId, file))).pipe(
    Effect.tapError(() => Effect.sync(() => jobs.delete(itemId))),
  )

/** Stop preparing an item: it was removed, or its upload finished. */
export const cancelPrepare = (itemId: string): void => {
  const fiber = jobs.get(itemId)
  if (fiber === undefined) return
  jobs.delete(itemId)
  Effect.runFork(Fiber.interrupt(fiber))
}
