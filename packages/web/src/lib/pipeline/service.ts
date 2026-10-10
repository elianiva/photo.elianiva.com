/**
 * The image pipeline as an Effect service.
 *
 * Each job runs in its own short-lived Web Worker, so a decoded 26 MP frame is
 * freed the moment the job ends. A semaphore bounds how many workers are alive
 * at once (each can hold a decoded frame): jobs beyond the bound wait in line,
 * and an interrupted job — a cancelled upload, a closed dialog — terminates its
 * worker. The layer is shared between every `provide`, so the bound is one for
 * the whole tab.
 */

import { Context, Effect, Layer, Schema as S, Semaphore } from 'effect'
import {
  ExportAnswer,
  RenditionsAnswer,
  WorkerFailed,
  type Answer,
  type ExportSettings,
  type WorkerRequest,
} from './schema'

/** One worker per core minus one, up to three — the same bound imgutils uses. */
const concurrency = Math.max(1, Math.min(3, (globalThis.navigator?.hardwareConcurrency ?? 4) - 1))

export class ImagePipeline extends Context.Service<ImagePipeline>()('photo/ImagePipeline', {
  make: Effect.gen(function* () {
    const permits = yield* Semaphore.make(concurrency)

    /** One request in a fresh Worker, its answer decoded against `result`. */
    const job = <A>(request: WorkerRequest, response: S.Codec<Answer<A>, unknown>) =>
      Effect.callback<unknown, WorkerFailed>((resume) => {
        const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<unknown>) => {
          worker.terminate()
          resume(Effect.succeed(event.data))
        }
        worker.onerror = () => {
          worker.terminate()
          resume(Effect.fail(new WorkerFailed({ message: 'image worker failed' })))
        }
        worker.postMessage(request)
        // Interruption: the job's fiber is gone, so the worker goes with it.
        return Effect.sync(() => worker.terminate())
      }).pipe(
        Effect.timeoutOrElse({
          duration: '3 minutes',
          orElse: () => Effect.fail(new WorkerFailed({ message: 'image worker timed out' })),
        }),
        Effect.flatMap((data) =>
          S.decodeUnknownEffect(response)(data).pipe(
            Effect.mapError(
              (cause) => new WorkerFailed({ message: `bad answer: ${String(cause)}` }),
            ),
          ),
        ),
        Effect.flatMap((answer) =>
          answer._tag === 'success' ? Effect.succeed(answer.result) : Effect.fail(answer.error),
        ),
        permits.withPermits(1),
      )

    return {
      /** The `small` and `preview` WebP files, from one decode of the original. */
      renditions: Effect.fn('ImagePipeline.renditions')(function* (
        file: Blob,
        options: { readonly smallLongEdge: number; readonly quality: number },
      ) {
        return yield* job({ _tag: 'renditions', file, ...options }, RenditionsAnswer)
      }),
      /** Resize, frame, border and re-encode, for the Download panel. */
      export: Effect.fn('ImagePipeline.export')(function* (file: Blob, settings: ExportSettings) {
        return yield* job({ _tag: 'export', file, settings }, ExportAnswer)
      }),
    }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}

export type { ExportResult, ExportSettings, PipelineError, RenditionSet } from './schema'
