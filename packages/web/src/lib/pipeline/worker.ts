/**
 * The Worker side: a request is decoded against `WorkerRequest`, run as an
 * Effect, and answered with a value that encodes against the job's response
 * schema — a result, or a typed failure.
 */

import { Effect, Match, Schema as S } from 'effect'
import { exportImage, makeRenditions } from './encode'
import { WorkerFailed, WorkerRequest, type PipelineError } from './schema'

const run = Match.type<WorkerRequest>().pipe(
  Match.tagsExhaustive({
    renditions: (request) =>
      makeRenditions(request.file, request.smallLongEdge, request.quality).pipe(
        Effect.map((result) => ({ _tag: 'success', result }) as const),
      ),
    export: (request) =>
      exportImage(request.file, request.settings).pipe(
        Effect.map((result) => ({ _tag: 'success', result }) as const),
      ),
  }),
)

const handle = Effect.fn('pipeline.worker')(function* (data: unknown) {
  const request = yield* S.decodeUnknownEffect(WorkerRequest)(data).pipe(
    Effect.mapError((cause) => new WorkerFailed({ message: `bad request: ${String(cause)}` })),
  )
  return yield* run(request)
})

const failure = (error: PipelineError) => ({ _tag: 'failure', error }) as const

self.onmessage = (event: MessageEvent<unknown>) => {
  void Effect.runPromise(
    handle(event.data).pipe(
      Effect.catch((error: PipelineError) => Effect.succeed(failure(error))),
      // A defect is a bug in a codec, not a failure the caller can act on, but
      // it still has to come back as an answer or the job would hang.
      Effect.catchCause((cause) =>
        Effect.succeed(failure(new WorkerFailed({ message: String(cause) }))),
      ),
    ),
  ).then((response) => self.postMessage(response))
}
