/**
 * Admin Subscriptions — app-lifecycle listeners declared on the Model.
 *
 * Two listeners, and neither of them is about the Model.
 *
 * The lightbox keys only run while the lightbox is open: Escape closes, ←/→
 * step through the loaded photos, and changing `selectedId` tears the listener
 * down (close) or brings it up (open).
 *
 * The search shortcut is a document listener for the lifetime of the app:
 * `⌘K` (or `Ctrl K` off a Mac) focuses the Page Head's search field. It is a
 * shortcut to a control, not a command palette — no list of pages or Photos
 * opens behind it. The `Search` atom draws the keycap and this listener keeps
 * the promise it makes, and the two live on opposite sides of that boundary
 * on purpose: the atom draws, the page owns the shortcut.
 *
 * The shortcut emits no Message. There is nothing in the Model to learn from
 * a keypress — it moves focus in the DOM, which is a browser fact and not an
 * application one — so the listener does its work inside the filter and stays
 * silent. Doing it there rather than downstream is also what makes
 * `preventDefault` take effect: the mapper runs inside the event's own
 * dispatch, before the browser has already acted on the key.
 */

import { Effect, Option, Schema as S, Stream } from 'effect'
import { Subscription } from 'foldkit'

import { Message } from './model'
import type { Model } from './model'

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
  // The Page Head draws the field on some routes and not others, so a
  // shortcut with nothing to focus is a no-op rather than an error.
  if (field instanceof HTMLInputElement) field.focus()
}

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  lightboxKeys: entry(
    { selectedId: S.NullOr(S.String) },
    {
      modelToDependencies: (model) => ({ selectedId: model.selectedId }),
      dependenciesToStream: ({ selectedId }) =>
        Stream.when(
          Subscription.fromEventFilterMap({
            target: window,
            type: 'keydown',
            filterMapEvent: (event) => {
              if (event.key === 'Escape') return Option.some(Message.CloseLightbox())
              if (event.key === 'ArrowRight') return Option.some(Message.NextPhoto())
              if (event.key === 'ArrowLeft') return Option.some(Message.PrevPhoto())
              return Option.none()
            },
          }),
          Effect.sync(() => selectedId !== null),
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
