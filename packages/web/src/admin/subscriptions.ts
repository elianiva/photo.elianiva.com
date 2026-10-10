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

import { Effect, Option, Queue, Schema as S, Stream } from 'effect'
import { Subscription } from 'foldkit'
import { PhotoId } from '@photo/shared'

import { compositionSource, encodeCompositionBlurhash } from '@/lib/blurhash'
import { CompositionSpec } from '@/lib/blurhash'
import { smallUrl } from '@/lib/image'

import { Message } from './model'
import type { Model } from './model'
import { blurhashSignature, isEditorDirty } from './editor'
import { attachUploadSink, reconcileUploads } from './upload-run'
import type { UploadRunOptions } from './upload-run'

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

/** The queue items that are in flight: each is one run in `upload-run.ts`, and
 *  the chain advances by marking more items `uploading`. */
const inFlightUploadIds = (model: Model): ReadonlyArray<string> =>
  model.queue.filter((item) => item.status === 'uploading').map((item) => item.id)

/** The runs live in `upload-run.ts`, so reopening this stream when the active
 *  set changes never aborts a request that is still going. Opening it
 *  reconciles the runs with the set; closing it only detaches the messages. */
const uploadStream = (
  ids: ReadonlyArray<string>,
  options: UploadRunOptions,
): Stream.Stream<Message> =>
  Stream.callback<Message>(
    Effect.fn('upload.run')(function* (queue) {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const detach = attachUploadSink((message) => {
            Queue.offerUnsafe(queue, message)
          })
          reconcileUploads(ids, options)
          return detach
        }),
        (detach) => Effect.sync(detach),
      )
    }, Effect.andThen(Effect.never)),
  )

/** The run's options, read once when the stream opens. They are dependencies
 *  so `update` can change them before a run, but the keep-alive below ignores
 *  them: a Toggle flipped mid-run must not restart an in-flight request. */
interface UploadDependencies {
  readonly ids: ReadonlyArray<string>
  readonly tagIds: ReadonlyArray<string>
  readonly takenAt: string
  readonly useExportDefaults: boolean
  readonly publishWhenReady: boolean
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
  // The upload run: a stream reconciles the runs with the items at `uploading` and
  // carries their progress. It reopens when that set changes.
  uploadRun: entry(
    {
      ids: S.Array(S.String),
      tagIds: S.Array(S.String),
      takenAt: S.String,
      useExportDefaults: S.Boolean,
      publishWhenReady: S.Boolean,
    },
    {
      modelToDependencies: (model): UploadDependencies => ({
        ids: inFlightUploadIds(model),
        tagIds: model.uploadTagIds,
        takenAt: model.uploadTakenAt,
        useExportDefaults: model.uploadUseExportDefaults,
        publishWhenReady: model.uploadPublishWhenReady,
      }),
      // Only a change of item restarts the stream. Progress messages update the
      // Model dozens of times a second; without this, every one would abort and
      // restart the request.
      keepAliveEquivalence: (a: UploadDependencies, b: UploadDependencies) =>
        a.ids.length === b.ids.length && a.ids.every((id, index) => id === b.ids[index]),
      dependenciesToStream: ({
        ids,
        tagIds,
        takenAt,
        useExportDefaults,
        publishWhenReady,
      }: UploadDependencies) =>
        uploadStream(ids, { tagIds, takenAt, useExportDefaults, publishWhenReady }),
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
