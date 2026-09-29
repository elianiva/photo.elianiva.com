/**
 * Home update core: message → model transition plus init. There are no
 * commands — the edition ships with the bundle and the lightbox is the only
 * state the reader can move.
 */

import { Runtime, Update } from 'foldkit'

import { edition, type Edition, type Figure } from './content'
import { Message } from './model'
import type { Model } from './model'

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: { edition, selected: null },
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Every figure the reader can click, Page One first: the lightbox resolves a
 *  click against the same list the plates were rendered from. */
const figuresOf = (edition: Edition): ReadonlyArray<Figure> => [
  edition.lead,
  ...edition.sections.flatMap((section) => section.figures),
]

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    // An id the current edition no longer carries opens nothing; re-rendering
    // with the same model is cheaper than pretending the click missed.
    ClickedFigure: ({ id }) => {
      const figure = figuresOf(model.edition).find((candidate) => candidate.id === id)
      return figure === undefined ? { model } : { model: { ...model, selected: figure } }
    },
    CloseLightbox: () => ({ model: { ...model, selected: null } }),
  })
