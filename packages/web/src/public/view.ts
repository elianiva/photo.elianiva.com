/**
 * The public site's view root. One display serif (Newsreader) over Libre
 * Franklin on newsprint, hairline rules as the only structure, and the plates
 * carrying the page — the type is set small and stays out of their way.
 *
 * One app draws the site's public documents, and the **route** says which: the
 * Front is `/`, the About page is `/about`, a Tag page is `/tag/<slug>`, and
 * the Masthead, the Colophon, the plates and the lightbox are shared chrome
 * around any of them. Which document is drawn is read off the Model, which
 * `init` filled from the Flags the Worker stamped — so a view can never be
 * rendered for a URL that did not ask for it, and the title below is the
 * document's own.
 *
 * Each title is the site's name plus what the page is, because a title is the
 * one line every search result and every tab shows. The Front's used to end in
 * the site's photo counter — `photo.elianiva.com — No. 412` — which made every
 * tab and every search result an issue nobody can open. A Tag page's is its
 * Tag's own label, because that is the word its own URL and the Folio both
 * carry.
 *
 * What follows the domain is written in the site's own case rather than the
 * title case a title conventionally gets, because the Folio, the About kicker
 * and every Tag label are all lowercase here and a tab that says `About` above
 * a nav that says `ABOUT` is the site disagreeing with itself two lines apart.
 */

import type { Document, Html, HtmlBuilder } from 'foldkit/html'

import { Message } from './model'
import type { Model } from './model'
import { routeHref, tagPath } from './route'
import { aboutBody } from './views/about'
import { colophon } from './views/colophon'
import { continued } from './views/continued'
import { lede } from './views/lede'
import { lightbox } from './views/lightbox'
import { masthead } from './views/masthead'
import { editionSection } from './views/section'
import { BAND } from './views/shared'
import { tagBody } from './views/tag-page'

const TITLES: Record<Exclude<Model['route'], 'tag'>, string> = {
  front: 'photo.elianiva.com — photography',
  about: 'photo.elianiva.com — about',
}

/** The title of the document the Model is drawing. */
const titleOf = (model: Model): string =>
  model.route === 'tag' ? `photo.elianiva.com — ${model.tag.label}` : TITLES[model.route]

/**
 * The `href` the Folio marks as current: the document's own URL, printed by the
 * route table. A Tag page is named by its Tag's slug, so its href is that Tag's
 * path; the other two are named by their route alone.
 */
const currentHref = (model: Model): string =>
  model.route === 'tag' ? tagPath(model.tag.slug) : routeHref({ route: model.route })

/**
 * The document shell both pages share.
 *
 * The colophon's "back to top" has a target to land on. The layout margin steps
 * up at `tablet`; the compositions themselves flip at `desktop` in the views,
 * because the desktop Front needs its full 1080px measure to fit. The range
 * between shows the mobile composition at the tablet margin — the design has no
 * tablet frame to follow.
 */
const shell = (model: Model, h: HtmlBuilder<Message>, body: ReadonlyArray<Html>) =>
  h.div(
    [
      h.Id('top'),
      h.Class(
        'min-h-screen bg-role-surface px-(--layout-margin-mobile) text-role-text-primary tablet:px-(--layout-margin)',
      ),
    ],
    [
      masthead(currentHref(model), model.folio, h),
      ...body,
      colophon(model.folio, h),
      // The lightbox is chrome too: a plate opens the same way on either
      // document, so the overlay is drawn by the same view for both, over a
      // selection either document's plates can make.
      ...(model.selected === null ? [] : [lightbox(model.selected, h)]),
    ],
  )

const frontDocument = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: titleOf(model),
  lang: 'en',
  body: shell(model, h, [
    h.main(
      [h.Class('flex flex-col')],
      [
        lede(model.edition, h),
        // The first Section heads the page, so its first plate is the one the
        // browser fetches eagerly; every other Section is below the fold.
        ...model.edition.sections.map((section, index) => editionSection(section, index === 0, h)),
        h.div(
          [h.Id('archive'), h.Class(`${BAND} pt-(--spacing-lg) desktop:pt-(--spacing-3xl)`)],
          [continued(model.edition.tail, model.loadingSections, model.sectionsError, h)],
        ),
      ],
    ),
  ]),
})

const aboutDocument = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: titleOf(model),
  lang: 'en',
  body: shell(model, h, [h.main([h.Class('flex flex-col')], [aboutBody(model.plates, h)])]),
})

/** A Tag page is the Front's document shape at the Front's measure: the Tag's
 *  name, the Tag's caption and the photographs carrying it. */
const tagDocument = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: titleOf(model),
  lang: 'en',
  body: shell(model, h, [h.main([h.Class('flex flex-col')], [tagBody(model.tag, h)])]),
})

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  if (model.route === 'about') return aboutDocument(model, h)
  return model.route === 'tag' ? tagDocument(model, h) : frontDocument(model, h)
}
