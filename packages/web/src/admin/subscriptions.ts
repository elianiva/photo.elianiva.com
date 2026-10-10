/**
 * Admin Subscriptions — app-lifecycle listeners declared on the Model.
 *
 * The Editor's two listeners run only while the Editor is on screen, and
 * `Escape` is answered only when nothing else is holding it — the leave guard
 * is a Dialog, and a Dialog's own Escape is a close. So the guard's own key
 * handling is not raced by a second request to leave.
 *
 * The search shortcut is a document listener for the lifetime of the app:
 * `⌘K` (or `Ctrl K` off a Mac) focuses the Page Head's search field. It is a
 * shortcut to a control, not a command palette — no list of pages or Photos
 * opens behind it. The `Search` atom draws the keycap and this listener keeps
 * the promise it makes, and the two live on opposite sides of that boundary on
 * purpose: the atom draws, the page owns the shortcut.
 *
 * The shortcut emits no Message. There is nothing in the Model to learn from a
 * keypress — it moves focus in the DOM, which is a browser fact and not an
 * application one — so the listener does its work inside the filter and stays
 * silent. Doing it there rather than downstream is also what makes
 * `preventDefault` take effect: the mapper runs inside the event's own
 * dispatch, before the browser has already acted on the key.
 */

import { Effect, Option, Queue, Result, Schema as S, Stream } from 'effect'
import { Subscription } from 'foldkit'
import {
  PhotoId,
  UploadErrorBody,
  UploadSuccessBody,
  formatMeasuredRatio,
  nearestRatio,
} from '@photo/shared'

import { UPLOAD_PATH, apiUrl } from '@/lib/api'
import { compositionSource, encodeCompositionBlurhash } from '@/lib/blurhash'
import { CompositionSpec } from '@/lib/blurhash'
import { smallUrl } from '@/lib/image'

import { Message, fileStore } from './model'
import type { Model } from './model'
import { blurhashSignature, isEditorDirty } from './editor'
import { awaitPrepared, startPrepare } from './upload-prepare'

/** The id the Page Head's search input carries, and therefore the element the
 *  shortcut reaches for. Declared here and read by `views/page-head.ts` so the
 *  two cannot name different fields. */
export const SEARCH_INPUT_ID = 'admin-search'

/** The keycap the Page Head prints. The design's is the Mac one; printing it
 *  on a PC keyboard would name a key the operator does not have, so the Mac
 *  branch prints `⌘K` and every other platform prints `Ctrl K`. */
export const searchShortcutLabel = (): string =>
  typeof navigator === 'undefined' || !/Mac|iPhone|iPad|iPod/.test(navigator.platform)
    ? 'Ctrl K'
    : '⌘K'

/** Is this keydown the search shortcut? `metaKey` or `ctrlKey` with `k`, and
 *  never while the operator is typing into some other field — except the search
 *  field itself, where re-focusing is a harmless no-op. */
const isSearchShortcut = (event: KeyboardEvent): boolean => {
  if (event.key.toLowerCase() !== 'k') return false
  if (!event.metaKey && !event.ctrlKey) return false
  const target: unknown = event.target
  if (typeof target !== 'object' || target === null) return true
  if (!(target instanceof HTMLElement)) return true
  if (target.id === SEARCH_INPUT_ID) return true
  return !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

const focusSearch = (): void => {
  const field = document.getElementById(SEARCH_INPUT_ID)
  // The Page Head draws the field on some routes and not others, so a shortcut
  // with nothing to focus is a no-op rather than an error.
  if (field instanceof HTMLInputElement) field.focus()
}

/** The queue item that is in flight, or None. This is the subscription's own
 *  gate: an item at `uploading` is exactly one stream's worth of work, and the
 *  chain advances by marking the next item `uploading`, so one change of this
 *  value tears the old stream down and starts the next. */
const inFlightUploadId = (model: Model): Option.Option<string> =>
  Option.fromUndefinedOr(model.queue.find((item) => item.status === 'uploading')?.id)

/** The frame as the detail line prints it: the snapped Ratio when one exists,
 *  otherwise the measured proportion (so a 1:1 the server will refuse still
 *  reads `1:1` while it uploads). */
const ratioLabel = (width: number, height: number): string =>
  nearestRatio(width, height) ?? formatMeasuredRatio(width, height)

/** `JSON.parse` as a total function: `None` for a response body that is not
 *  JSON at all. The parsed value is `unknown`; the shape is the contract's
 *  job, so parse and validate stay two separable steps. */
const parseJson = Option.liftThrowable((raw: string): unknown => JSON.parse(raw))

/** The upload route's body, decoded as the contract `@photo/shared` declares.
 *  `None` for a response that is not JSON, or is JSON the contract does not
 *  describe — an error page from something between here and the Worker, most
 *  often, which carries no message the operator could act on. */
const decodeUploadBody = (
  xhr: XMLHttpRequest,
): Option.Option<typeof UploadSuccessBody.Type | typeof UploadErrorBody.Type> =>
  Option.flatMap(parseJson(xhr.responseText), (parsed) =>
    Option.orElse(S.decodeUnknownOption(UploadSuccessBody)(parsed), () =>
      S.decodeUnknownOption(UploadErrorBody)(parsed),
    ),
  )

/** E6's `processing` hold: a stored Photo that still owes a Rendition is not
 *  published yet. Read off the declared field rather than sniffed for, so a
 *  Worker that starts sending it is honoured the day it does. */
const uploadSuccessIsPending = (xhr: XMLHttpRequest): boolean =>
  Option.filter(decodeUploadBody(xhr), S.is(UploadSuccessBody)).pipe(
    Option.map((body) => body.renditionsPending),
    Option.getOrElse(() => false),
  )

/** What the failed Upload Item prints: the Worker's own reason when it gave
 *  one, and the bare status when it did not. */
const uploadErrorMessage = (xhr: XMLHttpRequest): string =>
  Option.filter(decodeUploadBody(xhr), S.is(UploadErrorBody)).pipe(
    Option.map((body) => body.message),
    Option.getOrElse(() => `upload failed (${String(xhr.status)})`),
  )

/**
 * One queue item's upload, as a stream of Messages: the decoded frame, a
 * Message per `upload.onprogress` tick, then exactly one terminal Message.
 *
 * **`XMLHttpRequest`, not `fetch`.** `fetch` cannot report upload progress —
 * no event, no `ReadableStream` for a request body a browser will let you
 * observe — and the design's filled bar needs `upload.onprogress`. This is an
 * API limitation, not a library preference; do not "simplify" it back to
 * `fetch`.
 *
 * The stream outlives its own success: the run is torn down by the Model
 * (the item leaves `uploading`) rather than by the stream ending, which is
 * what lets the scope's release abort an in-flight request when the operator
 * cancels.
 */
const uploadStream = (
  itemId: string,
  options: Readonly<{
    tagIds: ReadonlyArray<string>
    takenAt: string
    useExportDefaults: boolean
    publishWhenReady: boolean
    /** The next items in line, kept warm while this one uploads. */
    upcoming: ReadonlyArray<string>
  }>,
): Stream.Stream<Message> =>
  Stream.callback<Message>(
    Effect.fn('upload.run')(function* (queue) {
      const offer = (message: Message): void => {
        Queue.offerUnsafe(queue, message)
      }
      const fail = (message: string): void => {
        offer(Message.FailedUploadItem({ itemId, message }))
      }
      const file = fileStore.get(itemId)
      if (file === undefined) return fail('uploaded bytes are gone')

      // Work ahead: the next items decode and encode while this one uploads.
      for (const id of options.upcoming) {
        const upcoming = fileStore.get(id)
        if (upcoming !== undefined) startPrepare(id, upcoming)
      }

      // Everything the Worker will store is made here, in this tab. The Worker
      // only accepts the files. A failed preparation is a failed row.
      const prepared = yield* awaitPrepared(itemId, file).pipe(Effect.result)
      if (Result.isFailure(prepared)) return fail(prepared.failure.message)
      const { renditions, title, blurhash } = prepared.success
      offer(
        Message.UploadItemFacts({
          itemId,
          width: renditions.width,
          height: renditions.height,
          ratio: ratioLabel(renditions.width, renditions.height),
        }),
      )

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

      // The request is a scoped resource: the stream's scope closing — the item
      // left `uploading`, the dialog was cancelled — aborts it.
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const xhr = new XMLHttpRequest()
          xhr.open('POST', apiUrl(UPLOAD_PATH))
          // Harmless in production, where this is a same-origin POST the
          // browser sends the Access cookie with either way. It earns its place
          // on the dev port pair, which is cross-origin.
          xhr.withCredentials = true
          xhr.upload.onprogress = (event): void => {
            // `event.loaded` counts the whole multipart body; the bar names the
            // original's own bytes, scaled to how much of the body has gone.
            offer(
              Message.UploadProgress({
                itemId,
                loaded: Math.min(Math.round((event.loaded / totalBytes) * file.size), file.size),
              }),
            )
          }
          xhr.onload = (): void => {
            if (xhr.status >= 200 && xhr.status < 300) {
              offer(
                Message.SucceededUploadItem({
                  itemId,
                  renditionsPending: uploadSuccessIsPending(xhr),
                }),
              )
            } else {
              fail(uploadErrorMessage(xhr))
            }
          }
          xhr.onerror = (): void => fail('upload failed')
          xhr.send(form)
          return xhr
        }),
        (xhr) => Effect.sync(() => xhr.abort()),
      )
    }, Effect.andThen(Effect.never)),
  )

/** How many items past the one uploading are prepared ahead of time. */
const UPLOAD_PREFETCH = 2

/** The run's options, read once when the stream opens. They are dependencies
 *  so `update` can change them before a run, but the keep-alive below ignores
 *  them: a Toggle flipped mid-run must not restart an in-flight request. */
interface UploadDependencies {
  readonly itemId: Option.Option<string>
  readonly tagIds: ReadonlyArray<string>
  readonly takenAt: string
  readonly useExportDefaults: boolean
  readonly publishWhenReady: boolean
  readonly upcoming: ReadonlyArray<string>
}

/** The Stage frame the crop is authored through, when the event landed in it.
 *  The gesture listeners are on `window` so a pan survives the pointer leaving
 *  the frame, which is why every one of them filters on this rather than on
 *  which element owns the listener. */
const cropFrameRect = (target: EventTarget | null): DOMRect | null => {
  if (!(target instanceof Element)) return null
  const frame = target.closest('[data-crop-frame]')
  return frame instanceof HTMLElement ? frame.getBoundingClientRect() : null
}

/** One composition's re-encode, as a Message: decode the original once, draw
 *  the crop and Mat into a 32×32 canvas, encode, and answer with the hash.
 *  Nothing is emitted when the bytes are unreachable or the browser cannot
 *  decode them — a placeholder that cannot be made is not an error the Editor
 *  has to report, and the stored hash stands.
 *
 *  The Bitmap is the cached one `compositionSource` keeps, so repeated
 *  re-encodes never re-fetch or re-decode the original. */
const blurhashStream = (id: string, sourceUrl: string, signature: string): Stream.Stream<Message> =>
  Stream.fromEffect(
    Effect.gen(function* () {
      const source = yield* compositionSource(sourceUrl)
      if (Option.isNone(source)) return undefined
      // The signature came back out of the Model as text, so it is decoded
      // rather than trusted: a spec that does not match what the Encoder writes
      // is a re-encode that is skipped, not a canvas handed nonsense.
      const spec = S.decodeUnknownOption(CompositionSpec)(signature)
      if (Option.isNone(spec)) return undefined
      return encodeCompositionBlurhash(source.value, spec.value)
    }),
  ).pipe(
    Stream.flatMap((blurhash) =>
      blurhash === undefined
        ? Stream.empty
        : Stream.succeed(
            Message.ReencodedEditorBlurhash({
              id: PhotoId.make(id),
              signature,
              blurhash,
            }),
          ),
    ),
  )

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  // `Escape` leaves the Editor, through the same guard as `← Library` and a
  // Back press: ask when the draft is dirty, go when it is not. It names no
  // URL, because it has none of its own — the Model answers "back" with the
  // route the Editor was opened from.
  editorKeys: entry(
    { onEditor: S.Boolean },
    {
      modelToDependencies: (model) => ({
        onEditor: model.route._tag === 'Photo' && !model.editor.leaveDialog.isOpen,
      }),
      dependenciesToStream: ({ onEditor }) =>
        Stream.when(
          Subscription.fromEventFilterMap({
            target: window,
            type: 'keydown',
            filterMapEvent: (event) =>
              event.key === 'Escape' ? Option.some(Message.RequestLeaveEditor({})) : Option.none(),
          }),
          Effect.sync(() => onEditor),
        ),
    },
  ),
  // The Stage's direct manipulation. A drag on the photograph pans the crop and
  // a platform-modified wheel zooms it. Both listeners are on `window` so a
  // gesture that leaves the frame still tracks and still ends, and both filter
  // on the frame, so a drag on the Inspector or the Stage Bar is not a crop
  // gesture. The wheel cancels its default so a modified notch does not also
  // scroll the Canvas; an unmodified one is left alone and scrolls as usual.
  editorCropPan: entry(
    { onEditor: S.Boolean, dragging: S.Boolean },
    {
      modelToDependencies: (model) => ({
        onEditor: model.route._tag === 'Photo',
        dragging: model.editor.cropDrag !== undefined,
      }),
      dependenciesToStream: ({ onEditor, dragging }) =>
        Stream.merge(
          Stream.merge(
            Stream.when(
              Subscription.fromEventFilterMapPreventDefault({
                target: window,
                type: 'pointerdown',
                filterMapEvent: (event) => {
                  if (event.button !== 0) return Option.none()
                  const rect = cropFrameRect(event.target)
                  if (rect === null) return Option.none()
                  return Option.some(
                    Message.StartedEditorCropDrag({
                      x: event.clientX,
                      y: event.clientY,
                      width: rect.width,
                      height: rect.height,
                    }),
                  )
                },
              }),
              Effect.sync(() => onEditor),
            ),
            Stream.when(
              Subscription.fromEventFilterMap({
                target: window,
                type: 'pointermove',
                filterMapEvent: (event) =>
                  Option.some(Message.DraggedEditorCrop({ x: event.clientX, y: event.clientY })),
              }),
              Effect.sync(() => dragging),
            ),
          ),
          Stream.when(
            Subscription.fromEventFilterMap({
              target: window,
              type: 'pointerup',
              filterMapEvent: () => Option.some(Message.EndedEditorCropDrag()),
            }),
            Effect.sync(() => dragging),
          ),
        ),
    },
  ),
  editorCropZoom: entry(
    { onEditor: S.Boolean },
    {
      modelToDependencies: (model) => ({ onEditor: model.route._tag === 'Photo' }),
      dependenciesToStream: ({ onEditor }) =>
        Stream.when(
          Subscription.fromEventFilterMapPreventDefault({
            target: window,
            type: 'wheel',
            filterMapEvent: (event) => {
              if (!event.metaKey && !event.ctrlKey) return Option.none()
              if (cropFrameRect(event.target) === null) return Option.none()
              return Option.some(Message.ZoomedEditorCrop({ deltaY: event.deltaY }))
            },
          }),
          Effect.sync(() => onEditor),
        ),
    },
  ),
  // The Editor's Blurhash, re-encoded from the composed crop and Mat on every
  // committed change (CONTEXT.md, Blurhash). The dependency *is* the
  // composition: an equal signature leaves the stream alone, so an Export
  // control that cannot move a pixel — quality, format, an EXIF policy — never
  // triggers one, and a pan in flight is excluded by `blurhashSignature`
  // until the operator releases it. The encode is a 32×32 draw against a
  // cached original, so a crop nudge costs no network.
  editorBlurhash: entry(
    { photoId: S.Option(S.String), sourceUrl: S.String, composition: S.String },
    {
      modelToDependencies: (model) => {
        if (model.route._tag !== 'Photo' || model.photo === undefined) {
          return { photoId: Option.none(), sourceUrl: '', composition: '' }
        }
        const composition = blurhashSignature(model.photo, model.editor)
        return {
          photoId: Option.some(String(model.route.id)),
          sourceUrl: composition === '' ? '' : smallUrl(model.photo),
          composition,
        }
      },
      dependenciesToStream: ({ photoId, sourceUrl, composition }) =>
        Option.match(photoId, {
          onNone: () => Stream.empty,
          onSome: (id) =>
            composition === '' ? Stream.empty : blurhashStream(id, sourceUrl, composition),
        }),
    },
  ),
  // The browser's own ways out — a tab closed, a reload, a link to another
  // origin — are same-document-agnostic and never reach the Model, so the
  // Editor's unsaved changes are guarded here. `beforeunload` is the one hook
  // a browser offers for it; the dialog text is the browser's, not ours, and
  // the operator's only real choice is Stay.
  editorUnloadGuard: entry(
    { dirty: S.Boolean },
    {
      modelToDependencies: (model) => ({
        dirty: model.route._tag === 'Photo' && isEditorDirty(model.editor),
      }),
      dependenciesToStream: ({ dirty }) =>
        Stream.when(
          Subscription.fromEventFilterMap({
            target: window,
            type: 'beforeunload',
            filterMapEvent: (event) => {
              event.preventDefault()
              // Browsers ignore the string and show their own copy; assigning
              // `returnValue` is what makes any of them ask at all.
              event.returnValue = ''
              return Option.none()
            },
          }),
          Effect.sync(() => dirty),
        ),
    },
  ),
  // The upload run: one stream drives the one item at `uploading`, emits each
  // progress tick, and is torn down the moment the item leaves that state.
  uploadRun: entry(
    {
      itemId: S.Option(S.String),
      tagIds: S.Array(S.String),
      takenAt: S.String,
      useExportDefaults: S.Boolean,
      publishWhenReady: S.Boolean,
      upcoming: S.Array(S.String),
    },
    {
      modelToDependencies: (model): UploadDependencies => ({
        itemId: inFlightUploadId(model),
        tagIds: model.uploadTagIds,
        takenAt: model.uploadTakenAt,
        useExportDefaults: model.uploadUseExportDefaults,
        publishWhenReady: model.uploadPublishWhenReady,
        upcoming: model.queue
          .filter((item) => item.status === 'pending')
          .slice(0, UPLOAD_PREFETCH)
          .map((item) => item.id),
      }),
      // Only a change of item restarts the stream. Progress messages update the
      // Model dozens of times a second; without this, every one would abort and
      // restart the request.
      keepAliveEquivalence: (a: UploadDependencies, b: UploadDependencies) =>
        Option.getOrNull(a.itemId) === Option.getOrNull(b.itemId),
      dependenciesToStream: ({
        itemId,
        tagIds,
        takenAt,
        useExportDefaults,
        publishWhenReady,
        upcoming,
      }: UploadDependencies) =>
        Option.match(itemId, {
          onNone: () => Stream.empty,
          onSome: (id) =>
            uploadStream(id, { tagIds, takenAt, useExportDefaults, publishWhenReady, upcoming }),
        }),
    },
  ),
  // Nothing in the Model changes this listener's lifetime, so it is
  // `persistent`: the shortcut is the same on every route, and tearing it down
  // and back up on each Model write would be churn for nothing. `target` is a
  // thunk because a `persistent` entry's stream is built with the record rather
  // than when the listener's scope opens, and this module is imported by tests
  // that never open one.
  searchShortcut: Subscription.persistent(
    Subscription.fromEventFilterMap({
      target: () => window,
      type: 'keydown',
      filterMapEvent: (event) => {
        if (!isSearchShortcut(event)) return Option.none()
        event.preventDefault()
        focusSearch()
        return Option.none()
      },
    }),
  ),
}))
