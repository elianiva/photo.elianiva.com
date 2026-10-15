/**
 * The public site's view root. One display serif (Newsreader) over Libre
 * Franklin on paper, hairline rules as the only structure, and the figures
 * carrying the page — the type is set small and stays out of their way.
 *
 * One app draws the site's public documents, and the **route** says which: the
 * Home page is `/`, the About page is `/about`, a Tag page is `/tag/<slug>`, and
 * the Header, the Footer, the figures and the lightbox are shared chrome
 * around any of them. Which document is drawn is read off the Model, which
 * `init` filled from the Flags the Worker stamped — so a view can never be
 * rendered for a URL that did not ask for it, and the title below is the
 * document's own.
 *
 * Each title is the site's name plus what the page is, because a title is the
 * one line every search result and every tab shows. The home page's used to end in
 * the site's photo counter — `photo.elianiva.com — No. 412` — which made every
 * tab and every search result an issue nobody can open. A Tag page's is its
 * Tag's own label, because that is the word its own URL and the Nav both
 * carry.
 *
 * What follows the domain is written in the site's own case rather than the
 * title case a title conventionally gets, because the Nav, the About label
 * and every Tag label are all lowercase here and a tab that says `About` above
 * a nav that says `ABOUT` is the site disagreeing with itself two lines apart.
 */

import type { Document, Html, HtmlBuilder } from 'foldkit/html'

import { Message } from './model'
import type { Model } from './model'
import { aboutBody } from './views/about'
import { siteFooter } from './views/site-footer'
import { archiveEnd } from './views/archive-end'
import { lightbox } from './views/lightbox'
import { siteHeader } from './views/site-header'
import { rows } from './views/rows'
import { tagBody } from './views/tag-page'

const TITLES: Record<Exclude<Model['route'], 'tag'>, string> = {
  home: 'photo.elianiva.com — photography',
  about: 'photo.elianiva.com — about',
}

/** The title of the document the Model is drawing. */
const titleOf = (model: Model): string =>
  model.route === 'tag' ? `photo.elianiva.com — ${model.tag.label}` : TITLES[model.route]

/** What the home page says about itself, at the right of the header. It is the
 *  site's own voice, so it is written here and is true whatever the archive
 *  holds. */
const HOME_CONTEXT =
  'Aside from writing software, I like doing photography. I mostly take street photos because I like to walk around the neighbourhood and interact with people.'

/** A site with nothing published says so rather than drawing an empty page. */
const EMPTY_NOTE = 'Nothing posted yet, check back later.'

/** The first photos of the home page's run are above the fold and fetched now. */
const EAGER_FRAMES = 6

/**
 * The document shell both pages share.
 *
 * The footer's "back to top" has a target to land on. The layout margin steps
 * up at `md`; the compositions themselves flip at `lg` in the views, because
 * the desktop Home page needs its full 1080px measure to fit. The range between
 * shows the mobile composition at the wider margin — the design has no tablet
 * frame to follow.
 */
const shell = (model: Model, h: HtmlBuilder<Message>, body: ReadonlyArray<Html>) => {
  // The home page is full-bleed: its side padding is only the rows' own gap, and
  // its header and footer run the same width. The other documents sit in the
  // page's content column behind the wider margin.
  const wide = model.route === 'home'
  return h.div(
    [
      h.Id('top'),
      h.Class(
        `min-h-screen bg-role-surface text-role-text-primary ${wide ? 'px-2 lg:px-2.5' : 'px-4 md:px-12'}`,
      ),
    ],
    [
      siteHeader(wide ? HOME_CONTEXT : null, wide, h),
      ...body,
      siteFooter(model.nav, wide, h),
      // The lightbox is chrome too: a photo opens the same way on either
      // document, so the overlay is drawn by the same view for both, over a
      // selection either document's figures can make.
      ...(model.selected === null ? [] : [lightbox(model.selected, h)]),
    ],
  )
}

const homeDocument = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: titleOf(model),
  lang: 'en',
  body: shell(model, h, [
    h.main(
      [h.Class('flex flex-col')],
      [
        // Every photo in one run, newest first: the months the read pages
        // through are how the page loads, not how it looks.
        model.timeline.tail === 'empty'
          ? h.p([h.Class('type-caption py-8 text-role-text-secondary')], [EMPTY_NOTE])
          : rows(
              model.timeline.sections.flatMap((section) => section.figures),
              EAGER_FRAMES,
              h,
            ),
        archiveEnd(model.timeline.tail, model.loadingMonths, model.monthsError, h),
      ],
    ),
  ]),
})

const aboutDocument = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: titleOf(model),
  lang: 'en',
  body: shell(model, h, [h.main([h.Class('flex flex-col')], [aboutBody(model.figures, h)])]),
})

/** A Tag page is the home page's document shape at the home page's measure: the Tag's
 *  name, the Tag's caption and the photographs carrying it. */
const tagDocument = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: titleOf(model),
  lang: 'en',
  body: shell(model, h, [h.main([h.Class('flex flex-col')], [tagBody(model.tag, h)])]),
})

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  if (model.route === 'about') return aboutDocument(model, h)
  return model.route === 'tag' ? tagDocument(model, h) : homeDocument(model, h)
}
