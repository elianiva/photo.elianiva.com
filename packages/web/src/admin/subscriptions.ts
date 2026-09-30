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

import { Effect, Option, Schema as S, Stream } from 'effect'
import { Subscription } from 'foldkit'

import { Message } from './model'
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

/** The Stage frame the crop is authored through, when the event landed in it.
 *  The gesture listeners are on `window` so a pan survives the pointer leaving
 *  the frame, which is why every one of them filters on this rather than on
 *  which element owns the listener. */
const cropFrameRect = (target: EventTarget | null): DOMRect | null => {
  if (!(target instanceof Element)) return null
  const frame = target.closest('[data-crop-frame]')
  return frame instanceof HTMLElement ? frame.getBoundingClientRect() : null
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
