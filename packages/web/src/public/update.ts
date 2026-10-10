/**
 * The public site's update core: message → model transition plus init.
 *
 * `init` is synchronous and takes what the Worker already read, because the
 * first paint is server-rendered and a reader should never watch an empty page
 * fill itself in. The one command on the site fetches the months
 * below the last server month as the reader scrolls; the About page and a
 * Tag page draw no load-more row, so nothing on them dispatches that command.
 */

import { Runtime, Update } from 'foldkit'

import { EMPTY_TIMELINE, EMPTY_TAG_PAGE, type DaySection, type Figure } from './content'
import { LoadOlderMonthsCmd } from './commands'
import { Message } from './model'
import type { Flags, Model } from './model'

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

/** The Model of the document a stamp names. Every branch carries the same
 *  fields, so this is a per-document read of one struct rather than three
 *  spellings of it: the fields a document does not draw are the named empty
 *  ones, whatever the stamp happens to carry in them. `nav` is the exception
 *  and rides on all three — the Nav is the Header's, and the Header is
 *  the chrome they share. */
const modelOf = (flags: Flags): Model => {
  if (flags.route === 'home') {
    return {
      route: 'home',
      timeline: flags.timeline,
      sectionCursor: flags.nextMonthCursor,
      loadingMonths: false,
      monthsError: null,
      // The About page's and the Tag page's photographs are not this
      // document's.
      figures: [],
      tag: EMPTY_TAG_PAGE,
      nav: flags.nav,
      selected: null,
    }
  }
  if (flags.route === 'about') {
    return {
      route: 'about',
      // Likewise the Timeline: the About page reads its photographs out of
      // `figures`, so the Timeline it never prints is the named empty one rather
      // than a second reading of D1 it does not need.
      timeline: EMPTY_TIMELINE,
      sectionCursor: null,
      loadingMonths: false,
      monthsError: null,
      figures: flags.figures,
      tag: EMPTY_TAG_PAGE,
      nav: flags.nav,
      selected: null,
    }
  }
  return {
    route: 'tag',
    // A Tag page is one Tag's photographs read whole, so it has no Timeline to
    // page through and no cursor below the last one.
    timeline: EMPTY_TIMELINE,
    sectionCursor: null,
    loadingMonths: false,
    monthsError: null,
    figures: [],
    tag: flags.tag,
    nav: flags.nav,
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
 *  lightbox resolves a click against the same list the figures were rendered
 *  from. The home page pages through its Timeline's Months; the other two
 *  documents read their photographs out of one list. */
const figuresOf = (model: Model): ReadonlyArray<Figure> => {
  if (model.route === 'home') {
    return model.timeline.sections.flatMap((section) => section.figures)
  }
  return model.route === 'about' ? model.figures : model.tag.figures
}

/** Whether a day section the read returned is already on the page. */
const isNewSection = (
  sections: ReadonlyArray<DaySection>,
  existing: ReadonlyArray<DaySection>,
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

    // Nothing below, or a read already in flight: repeated scroll events must
    // not start overlapping reads.
    LoadOlderMonths: () =>
      model.sectionCursor === null || model.loadingMonths
        ? { model }
        : {
            model: { ...model, loadingMonths: true, monthsError: null },
            commands: [LoadOlderMonthsCmd({ sectionCursor: model.sectionCursor })],
          },

    LoadedSections: ({ sections, nextMonthCursor }) => {
      // A day section already on the page means the cursor did not move, which
      // would otherwise loop the reader forever on the same content.
      if (
        !isNewSection(sections, model.timeline.sections) ||
        (nextMonthCursor !== null && nextMonthCursor === model.sectionCursor)
      ) {
        return {
          model: {
            ...model,
            loadingMonths: false,
            sectionCursor: null,
            timeline: { ...model.timeline, tail: 'end' },
          },
        }
      }
      return {
        model: {
          ...model,
          loadingMonths: false,
          monthsError: null,
          sectionCursor: nextMonthCursor,
          timeline: {
            ...model.timeline,
            sections: [...model.timeline.sections, ...sections],
            // The months arriving here are older than the page's existing tail.
            tail: nextMonthCursor === null ? 'end' : 'more',
          },
        },
      }
    },

    // The Timeline already on the page is still true; a later scroll retries.
    FailedLoadMonths: ({ message }) => ({
      model: { ...model, loadingMonths: false, monthsError: message },
    }),
  })
