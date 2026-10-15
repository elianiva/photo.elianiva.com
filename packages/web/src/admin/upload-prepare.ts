/**
 * Everything an upload needs that only the browser can make: the two WebP
 * renditions, the capture-time title and the Blurhash.
 *
 * Each queue item runs its own preparation inside its run fiber (see
 * `upload-run.ts`), so several items prepare while others upload, bounded by
 * the pipeline's worker semaphore.
 */

import { Effect, Option } from 'effect'
import { RENDITION_QUALITY, SMALL_LONG_EDGE, THUMB_LONG_EDGE, THUMB_QUALITY } from '@photo/shared'

import { encodeBlurhash } from '@/lib/blurhash'
import { titleFromExif } from '@/lib/exif-title'
import { ImagePipeline } from '@/lib/pipeline/service'
import type { RenditionSet } from '@/lib/pipeline/service'

export interface PreparedUpload {
  readonly renditions: RenditionSet
  /** The capture time, when the file has one. */
  readonly title: Option.Option<string>
  readonly blurhash: string | undefined
}

/** Where an Upload Item is in its pipeline, in order. `webp` covers the decode
 *  and both renditions, `blurhash` the placeholder, `upload` the request. */
export type UploadStage = 'webp' | 'blurhash' | 'upload'

/** Make everything the Worker will store. Interrupting the fiber running this
 *  terminates its Web Worker. `onStage` is told when the blurhash begins. */
export const prepare = Effect.fn('upload.prepare')(function* (
  file: File,
  onStage: (stage: UploadStage) => void,
) {
  const pipeline = yield* ImagePipeline
  // The title read is cheap and independent of the encode, so it overlaps it.
  const [renditions, title] = yield* Effect.all(
    [
      pipeline.renditions(file, {
        smallLongEdge: SMALL_LONG_EDGE,
        quality: RENDITION_QUALITY,
        thumbLongEdge: THUMB_LONG_EDGE,
        thumbQuality: THUMB_QUALITY,
      }),
      titleFromExif(file),
    ],
    { concurrency: 'unbounded' },
  )
  onStage('blurhash')
  // Hashed off the small rendition, so the original is not decoded again.
  const placeholder = yield* Effect.promise(() => encodeBlurhash(renditions.small))
  return { renditions, title, blurhash: placeholder?.blurhash } satisfies PreparedUpload
})
