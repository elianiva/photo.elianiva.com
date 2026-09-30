/**
 * Home update core: message → model transition plus init.
 *
 * `init` is synchronous and takes the Edition the Worker already read, because
 * the first paint is server-rendered and a reader should never watch an empty
 * broadsheet fill itself in. The one command on this page fetches the Edition
 * below the last Section when the reader asks for it.
 */

import { Runtime, Update } from 'foldkit'

import type { Edition, EditionSection, Figure } from './content'
import { LoadOlderSectionsCmd } from './commands'
import { Message } from './model'
import type { Flags, Model } from './model'

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export const init: Runtime.ApplicationInit<Model, Message, Flags> = (flags) => ({
  model: {
    edition: flags.edition,
    selected: null,
    sectionCursor: flags.nextSectionCursor,
    loadingSections: false,
    sectionsError: null,
  },
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Every figure the reader can click, Page One first: the lightbox resolves a
 *  click against the same list the plates were rendered from. */
const figuresOf = (edition: Edition): ReadonlyArray<Figure> => [
  ...(edition.lead === null ? [] : [edition.lead]),
  ...edition.sections.flatMap((section) => section.figures),
]

/** Whether a Section the read returned is already on the page. The cursor only
 *  ever moves backwards, so a repeat would be the same month twice. */
const isNewSection = (
  sections: ReadonlyArray<EditionSection>,
  existing: ReadonlyArray<EditionSection>,
): boolean =>
  sections.every((section) => !existing.some((have) => have.id === section.id))

/**
 * The masthead's counters after older Sections are appended.
 *
 * Appending can only add photographs, so the count and the highest Photo Number
 * both rise — except that the two come from *different* sets. `total` counts
 * every published photograph, and a photograph with no `takenAt` is counted
 * there while belonging to no Section, so a read of newer Sections can move the
 * count without the page having gained a plate. That is why the appended read
 * brings its own counters rather than the client counting plates, and why the
 * Edition holds them raw for `mastheadCount` to word.
 */
const withCounters = (
  edition: Edition,
  counters: { readonly number: number | null; readonly total: number },
): Edition => ({ ...edition, number: counters.number, total: counters.total })

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

export const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    // An id the current edition no longer carries opens nothing; re-rendering
    // with the same model is cheaper than pretending the click missed.
    ClickedFigure: ({ id }) => {
      const figure = figuresOf(model.edition).find((candidate) => candidate.id === id)
      return figure === undefined ? { model } : { model: { ...model, selected: figure } }
    },
    CloseLightbox: () => ({ model: { ...model, selected: null } }),

    // Nothing below, or a read already in flight: the row is not a button in
    // either state, and a second read would append the same month twice.
    LoadOlderSections: () =>
      model.sectionCursor === null || model.loadingSections
        ? { model }
        : {
            model: { ...model, loadingSections: true, sectionsError: null },
            commands: [LoadOlderSectionsCmd({ sectionCursor: model.sectionCursor })],
          },

    LoadedSections: ({ sections, nextSectionCursor, number, total }) => {
      // A Section already on the page means the cursor did not move, which
      // would otherwise loop the reader forever on the same month.
      if (!isNewSection(sections, model.edition.sections)) {
        return { model: { ...model, loadingSections: false, sectionCursor: null } }
      }
      return {
        model: {
          ...model,
          loadingSections: false,
          sectionsError: null,
          sectionCursor: nextSectionCursor,
          edition: {
            ...withCounters(model.edition, { number, total }),
            sections: [...model.edition.sections, ...sections],
            // The lead belongs to the Edition as it was rendered; older
            // Sections are plates, not a new Page One.
            tail:
              nextSectionCursor === null
                ? { state: 'end', marker: 'END OF THE EDITIONS', note: 'That is every frame.' }
                : { state: 'more', label: 'LOAD THE EARLIER EDITIONS' },
          },
        },
      }
    },

    // The Edition already on the page is still true, so the row goes back to
    // offering the load and says why the last attempt did not land.
    FailedLoadSections: ({ message }) => ({
      model: { ...model, loadingSections: false, sectionsError: message },
    }),
  })
