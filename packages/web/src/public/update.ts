/**
 * The public site's update core: message → model transition plus init.
 *
 * `init` is synchronous and takes what the Worker already read, because the
 * first paint is server-rendered and a reader should never watch an empty
 * broadsheet fill itself in. The one command on the site fetches the months
 * below the last Section when the reader asks for them; the About page and a
 * Tag page draw no Continued row, so nothing on them dispatches that command.
 */

import { Runtime, Update } from 'foldkit'

import { EMPTY_EDITION, EMPTY_TAG_PAGE, type EditionSection, type Figure } from './content'
import { LoadOlderSectionsCmd } from './commands'
import { Message } from './model'
import type { Flags, Model } from './model'

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

/** The Model of the document a stamp names. Every branch carries the same
 *  fields, so this is a per-document read of one struct rather than three
 *  spellings of it: the fields a document does not draw are the named empty
 *  ones, whatever the stamp happens to carry in them. `folio` is the exception
 *  and rides on all three — the Folio is the Masthead's, and the Masthead is
 *  the chrome they share. */
const modelOf = (flags: Flags): Model => {
  if (flags.route === 'front') {
    return {
      route: 'front',
      edition: flags.edition,
      sectionCursor: flags.nextSectionCursor,
      loadingSections: false,
      sectionsError: null,
      // The About page's and the Tag page's photographs are not this
      // document's.
      plates: [],
      tag: EMPTY_TAG_PAGE,
      folio: flags.folio,
      selected: null,
    }
  }
  if (flags.route === 'about') {
    return {
      route: 'about',
      // Likewise the Edition: the About page reads its photographs out of
      // `plates`, so the Edition it never prints is the named empty one rather
      // than a second reading of D1 it does not need.
      edition: EMPTY_EDITION,
      sectionCursor: null,
      loadingSections: false,
      sectionsError: null,
      plates: flags.plates,
      tag: EMPTY_TAG_PAGE,
      folio: flags.folio,
      selected: null,
    }
  }
  return {
    route: 'tag',
    // A Tag page is one Tag's photographs read whole, so it has no Edition to
    // page through and no cursor below the last one.
    edition: EMPTY_EDITION,
    sectionCursor: null,
    loadingSections: false,
    sectionsError: null,
    plates: [],
    tag: flags.tag,
    folio: flags.folio,
    selected: null,
  }
}

export const init: Runtime.ApplicationInit<Model, Message, Flags> = (flags) => ({
  model: modelOf(flags),
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Every figure the reader can click, in the order the page drew them: the
 *  lightbox resolves a click against the same list the plates were rendered
 *  from. The Front pages through its Edition, Page One first; the other two
 *  documents read their photographs out of one list. */
const figuresOf = (model: Model): ReadonlyArray<Figure> => {
  if (model.route === 'front') {
    return [
      ...(model.edition.lead === null ? [] : [model.edition.lead]),
      ...model.edition.sections.flatMap((section) => section.figures),
    ]
  }
  return model.route === 'about' ? model.plates : model.tag.plates
}

/** Whether a Section the read returned is already on the page. The cursor only
 *  ever moves backwards, so a repeat would be the same month twice. */
const isNewSection = (
  sections: ReadonlyArray<EditionSection>,
  existing: ReadonlyArray<EditionSection>,
): boolean => sections.every((section) => !existing.some((have) => have.id === section.id))

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    // An id the current document no longer carries opens nothing; re-rendering
    // with the same model is cheaper than pretending the click missed.
    ClickedFigure: ({ id }) => {
      const figure = figuresOf(model).find((candidate) => candidate.id === id)
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

    LoadedSections: ({ sections, nextSectionCursor }) => {
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
            ...model.edition,
            sections: [...model.edition.sections, ...sections],
            // The lead belongs to the Edition as it was rendered; older
            // Sections are plates, not a new Page One.
            tail: nextSectionCursor === null ? 'end' : 'more',
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
