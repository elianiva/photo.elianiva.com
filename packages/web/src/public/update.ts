/**
 * The public site's update core: message → model transition plus init.
 *
 * `init` is synchronous and takes what the Worker already read, because the
 * first paint is server-rendered and a reader should never watch an empty page
 * fill itself in. The one command on the site fetches the months
 * below the last Month when the reader asks for them; the About page and a
 * Tag page draw no load-more row, so nothing on them dispatches that command.
 */

import { Runtime, Update } from 'foldkit'

import { EMPTY_TIMELINE, EMPTY_TAG_PAGE, type Month, type Figure } from './content'
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
    return model.timeline.months.flatMap((month) => month.figures)
  }
  return model.route === 'about' ? model.figures : model.tag.figures
}

/** Whether a Month the read returned is already on the page. The cursor only
 *  ever moves backwards, so a repeat would be the same month twice. */
const isNewSection = (sections: ReadonlyArray<Month>, existing: ReadonlyArray<Month>): boolean =>
  sections.every((section) => !existing.some((have) => have.id === section.id))

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
    LoadOlderMonths: () =>
      model.sectionCursor === null || model.loadingMonths
        ? { model }
        : {
            model: { ...model, loadingMonths: true, monthsError: null },
            commands: [LoadOlderMonthsCmd({ sectionCursor: model.sectionCursor })],
          },

    LoadedMonths: ({ months, nextMonthCursor }) => {
      // A Month already on the page means the cursor did not move, which
      // would otherwise loop the reader forever on the same month.
      if (!isNewSection(months, model.timeline.months)) {
        return { model: { ...model, loadingMonths: false, sectionCursor: null } }
      }
      return {
        model: {
          ...model,
          loadingMonths: false,
          monthsError: null,
          sectionCursor: nextMonthCursor,
          timeline: {
            ...model.timeline,
            months: [...model.timeline.months, ...months],
            // The page's head is the Month it already opened with; the
            // Months arriving here are older months, below it.
            tail: nextMonthCursor === null ? 'end' : 'more',
          },
        },
      }
    },

    // The Timeline already on the page is still true, so the row goes back to
    // offering the load and says why the last attempt did not land.
    FailedLoadMonths: ({ message }) => ({
      model: { ...model, loadingMonths: false, monthsError: message },
    }),
  })
