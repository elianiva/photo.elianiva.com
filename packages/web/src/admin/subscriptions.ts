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
import { formatMeasuredRatio, nearestRatio } from '@photo/shared'

import { apiUrl } from '@/lib/api'
import { encodeBlurhash } from '@/lib/blurhash'

import { Message, fileStore } from './model'
import type { Model } from './model'
import { isEditorDirty } from './editor'

/** The id the Page Head's search input carries, and therefore the element the
 *  shortcut reaches for. Declared here and read by `views/page-head.ts` so the
 *  two cannot name different fields. */
export const SEARCH_INPUT_ID = 'admin-search'

/** The keycap the Page Head prints. The design's is the Mac one; printing it
 *  on a PC keyboard would name a key the operator does not have. */
export const searchShortcutLabel = (): string =>
  typeof navigator === 'undefined' || /Mac|iPhone|iPad|iPod/.test(navigator.platform)
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

const uploadSuccessIsPending = (xhr: XMLHttpRequest): boolean => {
  try {
    const parsed: { renditionsPending?: unknown } = JSON.parse(xhr.responseText)
    return parsed.renditionsPending === true
  } catch {
    return false
  }
}

const uploadErrorMessage = (xhr: XMLHttpRequest): string => {
  let message: string | undefined
  try {
    const parsed: { message?: unknown } = JSON.parse(xhr.responseText)
    if (typeof parsed.message === 'string') message = parsed.message
  } catch {
    message = undefined
  }
  return message ?? `upload failed (${String(xhr.status)})`
}

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
  }>,
): Stream.Stream<Message> =>
  Stream.callback<Message>((queue) =>
    Effect.acquireRelease(
      Effect.promise(async () => {
        const file = fileStore.get(itemId)
        if (file === undefined) {
          Queue.offerUnsafe(
            queue,
            Message.FailedUploadItem({ itemId, message: 'uploaded bytes are gone' }),
          )
          return { xhr: undefined }
        }
        try {
          // One decode for the detail line's dimensions and the stored
          // placeholder. Absent when the browser cannot decode the bytes —
          // the upload proceeds without either.
          const decoded = await encodeBlurhash(file)
          if (decoded !== undefined) {
            Queue.offerUnsafe(
              queue,
              Message.UploadItemFacts({
                itemId,
                width: decoded.width,
                height: decoded.height,
                ratio: ratioLabel(decoded.width, decoded.height),
              }),
            )
          }
          const form = new FormData()
          form.set('file', file)
          form.set('title', file.name.replace(/\.[^/.]+$/, ''))
          form.set('tagIds', JSON.stringify([...options.tagIds]))
          form.set('publishWhenReady', options.publishWhenReady ? 'true' : 'false')
          form.set('useExportDefaults', options.useExportDefaults ? 'true' : 'false')
          if (decoded?.blurhash !== undefined) form.set('blurhash', decoded.blurhash)
          if (options.takenAt !== '') form.set('takenAt', options.takenAt)

          const xhr = new XMLHttpRequest()
          xhr.open('POST', apiUrl('/upload'))
          xhr.withCredentials = true
          xhr.upload.onprogress = (event): void => {
            // `event.loaded` counts the multipart body, not just the file, so it
            // can pass `file.size` by the boundary bytes at the very end. The
            // readout names the file's own bytes, never more than it has.
            Queue.offerUnsafe(
              queue,
              Message.UploadProgress({ itemId, loaded: Math.min(event.loaded, file.size) }),
            )
          }
          xhr.onload = (): void => {
            if (xhr.status >= 200 && xhr.status < 300) {
              Queue.offerUnsafe(
                queue,
                Message.SucceededUploadItem({
                  itemId,
                  renditionsPending: uploadSuccessIsPending(xhr),
                }),
              )
            } else {
              Queue.offerUnsafe(
                queue,
                Message.FailedUploadItem({ itemId, message: uploadErrorMessage(xhr) }),
              )
            }
          }
          xhr.onerror = (): void => {
            Queue.offerUnsafe(
              queue,
              Message.FailedUploadItem({ itemId, message: 'upload failed' }),
            )
          }
          xhr.send(form)
          return { xhr }
        } catch {
          Queue.offerUnsafe(
            queue,
            Message.FailedUploadItem({ itemId, message: 'upload failed' }),
          )
          return { xhr: undefined }
        }
      }),
      ({ xhr }) => Effect.sync(() => xhr?.abort()),
    ).pipe(Effect.flatMap(() => Effect.never)),
  )

/** The run's options, read once when the stream opens. They are dependencies
 *  so `update` can change them before a run, but the keep-alive below ignores
 *  them: a Toggle flipped mid-run must not restart an in-flight request. */
interface UploadDependencies {
  readonly itemId: Option.Option<string>
  readonly tagIds: ReadonlyArray<string>
  readonly takenAt: string
  readonly useExportDefaults: boolean
  readonly publishWhenReady: boolean
}

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
    },
    {
      modelToDependencies: (model): UploadDependencies => ({
        itemId: inFlightUploadId(model),
        tagIds: model.uploadTagIds,
        takenAt: model.uploadTakenAt,
        useExportDefaults: model.uploadUseExportDefaults,
        publishWhenReady: model.uploadPublishWhenReady,
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
      }: UploadDependencies) =>
        Option.match(itemId, {
          onNone: () => Stream.empty,
          onSome: (id) =>
            uploadStream(id, { tagIds, takenAt, useExportDefaults, publishWhenReady }),
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
