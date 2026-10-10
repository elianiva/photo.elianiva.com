/**
 * The upload queue's concurrent runner.
 *
 * Every Upload Item that is `uploading` has one run fiber here, held by item
 * id: prepare (WebP renditions, Blurhash), then the multipart request. Runs are
 * module state rather than subscription state so that the subscription can be
 * reopened as the set of active items changes without aborting the ones still
 * going. `reconcileUploads` is the whole contract: start a run for every active
 * id that has none, interrupt every run whose id is no longer active (which
 * aborts its request and terminates its Web Worker).
 *
 * **`XMLHttpRequest`, not `fetch`.** `fetch` cannot report upload progress —
 * no event, no `ReadableStream` for a request body a browser will let you
 * observe — and the row's bar needs `upload.onprogress`. This is an API
 * limitation, not a library preference; do not "simplify" it back to `fetch`.
 */

import { Effect, Fiber, Option, Result, Schema as S } from 'effect'
import {
  UploadErrorBody,
  UploadSuccessBody,
  formatMeasuredRatio,
  nearestRatio,
} from '@photo/shared'

import { UPLOAD_PATH } from '@/lib/api'
import { ImagePipeline } from '@/lib/pipeline/service'

import { Message, fileStore } from './model'
import { prepare } from './upload-prepare'

export interface UploadRunOptions {
  readonly tagIds: ReadonlyArray<string>
  readonly takenAt: string
  readonly useExportDefaults: boolean
  readonly publishWhenReady: boolean
}

type Offer = (message: Message) => void

/** Frame as the detail line prints it: the snapped Ratio when one exists,
 *  otherwise the measured proportion. */
const ratioLabel = (width: number, height: number): string =>
  nearestRatio(width, height) ?? formatMeasuredRatio(width, height)

const parseJson = Option.liftThrowable((raw: string): unknown => JSON.parse(raw))

/** The upload route's body, decoded as the contract `@photo/shared` declares.
 *  `None` for a response that is not JSON or that the contract does not
 *  describe — an error page from something between here and the Worker. */
const decodeUploadBody = (
  xhr: XMLHttpRequest,
): Option.Option<typeof UploadSuccessBody.Type | typeof UploadErrorBody.Type> =>
  Option.flatMap(parseJson(xhr.responseText), (parsed) =>
    Option.orElse(S.decodeUnknownOption(UploadSuccessBody)(parsed), () =>
      S.decodeUnknownOption(UploadErrorBody)(parsed),
    ),
  )

/** E6's `processing` hold: a stored Photo that still owes a Rendition. */
const uploadSuccessIsPending = (xhr: XMLHttpRequest): boolean =>
  Option.filter(decodeUploadBody(xhr), S.is(UploadSuccessBody)).pipe(
    Option.map((body) => body.renditionsPending),
    Option.getOrElse(() => false),
  )

/** The Worker's own reason when it gave one, the bare status when it did not. */
const uploadErrorMessage = (xhr: XMLHttpRequest): string =>
  Option.filter(decodeUploadBody(xhr), S.is(UploadErrorBody)).pipe(
    Option.map((body) => body.message),
    Option.getOrElse(() => `upload failed (${String(xhr.status)})`),
  )

/** One POST as an effect: interrupting it aborts the request. */
const send = (
  form: FormData,
  onProgress: (loaded: number, total: number) => void,
): Effect.Effect<XMLHttpRequest, string> =>
  Effect.callback<XMLHttpRequest, string>((resume) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', UPLOAD_PATH)
    // Harmless in production, where this is a same-origin POST the browser
    // sends the Access cookie with either way. It earns its place on the dev
    // port pair, which is cross-origin.
    xhr.withCredentials = true
    xhr.upload.onprogress = (event): void => onProgress(event.loaded, event.total)
    xhr.onload = (): void => resume(Effect.succeed(xhr))
    xhr.onerror = (): void => resume(Effect.fail('upload failed'))
    xhr.send(form)
    return Effect.sync(() => xhr.abort())
  })

const runItem = (itemId: string, options: UploadRunOptions, offer: () => Offer | undefined) =>
  Effect.gen(function* () {
    const emit = (message: Message): void => offer()?.(message)
    const fail = (message: string): void => emit(Message.FailedUploadItem({ itemId, message }))
    const file = fileStore.get(itemId)
    if (file === undefined) return fail('uploaded bytes are gone')

    // Everything the Worker will store is made here, in this tab. The Worker
    // only accepts the files. A failed preparation is a failed row.
    const prepared = yield* prepare(file, (stage) =>
      emit(Message.UploadItemStage({ itemId, stage })),
    ).pipe(Effect.provide(ImagePipeline.layer), Effect.result)
    if (Result.isFailure(prepared)) return fail(prepared.failure.message)
    const { renditions, title, blurhash } = prepared.success
    emit(
      Message.UploadItemFacts({
        itemId,
        width: renditions.width,
        height: renditions.height,
        ratio: ratioLabel(renditions.width, renditions.height),
      }),
    )
    emit(Message.UploadItemStage({ itemId, stage: 'upload' }))

    const form = new FormData()
    form.set('file', file)
    form.set('small', renditions.small, 'small.webp')
    form.set('preview', renditions.preview, 'preview.webp')
    form.set(
      'title',
      Option.getOrElse(title, () => file.name.replace(/\.[^/.]+$/, '')),
    )
    form.set('tagIds', JSON.stringify([...options.tagIds]))
    form.set('publishWhenReady', options.publishWhenReady ? 'true' : 'false')
    form.set('useExportDefaults', options.useExportDefaults ? 'true' : 'false')
    if (blurhash !== undefined) form.set('blurhash', blurhash)
    if (options.takenAt !== '') form.set('takenAt', options.takenAt)
    const totalBytes = file.size + renditions.small.size + renditions.preview.size

    const sent = yield* send(form, (loaded) => {
      // `event.loaded` counts the whole multipart body; the bar names the
      // original's own bytes, scaled to how much of the body has gone.
      emit(
        Message.UploadProgress({
          itemId,
          loaded: Math.min(Math.round((loaded / totalBytes) * file.size), file.size),
        }),
      )
    }).pipe(Effect.result)
    if (Result.isFailure(sent)) return fail(sent.failure)
    const xhr = sent.success
    if (xhr.status >= 200 && xhr.status < 300) {
      emit(Message.SucceededUploadItem({ itemId, renditionsPending: uploadSuccessIsPending(xhr) }))
    } else {
      fail(uploadErrorMessage(xhr))
    }
  })

const runs = new Map<string, Fiber.Fiber<void>>()
let sink: Offer | undefined

/** Point the runs' messages at `offer` (the open subscription), returning the
 *  detach. A superseded subscription detaching late leaves the new sink alone. */
export const attachUploadSink = (offer: Offer): (() => void) => {
  sink = offer
  return () => {
    if (sink === offer) sink = undefined
  }
}

/** Make the running set equal `active`. Idempotent. */
export const reconcileUploads = (
  active: ReadonlyArray<string>,
  options: UploadRunOptions,
): void => {
  const wanted = new Set(active)
  for (const [id, fiber] of runs) {
    if (wanted.has(id)) continue
    runs.delete(id)
    Effect.runFork(Fiber.interrupt(fiber))
  }
  for (const id of active) {
    if (runs.has(id)) continue
    runs.set(id, Effect.runFork(runItem(id, options, () => sink)))
  }
}
