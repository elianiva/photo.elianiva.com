/**
 * About: what the site is, who makes it and with what. The page is one column
 * of prose and plates under a kicker, a headline and a deck, and every word
 * of it is written here rather than read: an About page is the photographer
 * speaking, and it has to be true whether the archive holds one photograph or
 * four hundred, so it claims no frame count and no month. The Admin's
 * `aboutCopy` column used to be a second, invisible source for two of these
 * sentences (migration 0008) and is gone.
 *
 * The two compositions are the design's two masters, and they are not the same
 * page at a narrower measure:
 *
 * - The desktop master runs the prose as **two columns** of one paragraph
 *   each, and draws **one** plate — the full 1080px measure, where a plate
 *   column would be a different figure.
 * - The mobile master runs the same prose as **one** paragraph (the same
 *   statements, re-flowed: no mid-sentence cut, and no column break on a
 *   measure a phone can hold), and draws **two** plates.
 *
 * So the mobile paragraph and the two desktop ones are both here, and only one
 * composition is ever displayed. The second plate is the same arrangement: it
 * is hidden at `desktop` and drawn `lazy`, because a plate the desktop
 * composition never lays out must not fetch a Photo's original there
 * (ADR 0002 — there is no resizer; every plate is the whole file).
 */

import type { HtmlBuilder } from 'foldkit/html'

import type { Figure } from '../content'
import { Message } from '../model'
import { figure } from './figure'
import { kit } from './kit'
import { BAND, type Child } from './shared'

const HEADLINE = 'One camera, one lens, and a lot of walking'

const DECK = 'Street photographs from Jakarta, made slowly and kept in full resolution.'

/** The desktop master's two columns, one paragraph each. */
const COLUMNS: ReadonlyArray<string> = [
  'I walk the same streets most mornings, early, before the traffic fills them. One body and a 25mm lens is the whole kit, so every frame is a decision about where to stand and when to wait. I do not crop, I do not stage, and I keep the full file.',
  'The archive is the point. Each photograph gets a number, a date, and its exposure, filed like a newspaper files a negative. Jakarta is home, but the habit travels: New York, Istanbul, anywhere with a pavement and something happening on it.',
]

/** The mobile master's single paragraph: the same two columns, re-flowed. */
const PROSE_MOBILE =
  'I walk the same streets most mornings, early, before the traffic fills them. One body and a 25mm lens is the whole kit. I do not crop, I do not stage, and I keep the full file. Each photograph gets a number, a date, and its exposure, filed like a newspaper files a negative.'

const paragraph = (className: string, text: string, h: HtmlBuilder<Message>): Child =>
  h.p([h.Class(className)], [text])

const prose = (h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class('grid gap-(--spacing-xl) desktop:grid-cols-2')],
    [
      paragraph('type-body text-role-text-primary desktop:hidden', PROSE_MOBILE, h),
      ...COLUMNS.map((column) =>
        paragraph('hidden type-body text-role-text-primary desktop:block', column, h),
      ),
    ],
  )

/** The plates the read returned. The first is the page's plate on both
 *  masters; the second is the mobile master's, so it is hidden at `desktop`
 *  and fetched lazily. A site with one published photograph draws one plate on
 *  both. */
const plates = (figures: ReadonlyArray<Figure>, h: HtmlBuilder<Message>): ReadonlyArray<Child> =>
  figures.map((plate, index) =>
    index === 0
      ? figure({ plate, slot: 'about' }, h)
      : h.div(
          [h.Class('hidden desktop:block')],
          [figure({ plate, slot: 'about', loading: 'lazy' }, h)],
        ),
  )

export const aboutBody = (figures: ReadonlyArray<Figure>, h: HtmlBuilder<Message>): Child =>
  h.div(
    [
      h.Id('about'),
      h.Class(
        `${BAND} flex flex-col gap-(--spacing-lg) pt-(--spacing-2xl) desktop:gap-(--spacing-xl) desktop:pt-(--spacing-3xl)`,
      ),
    ],
    [
      h.span([h.Class('type-kicker text-role-text-secondary')], ['ABOUT']),
      h.h1([h.Class('type-section-sm text-role-text-primary desktop:type-headline')], [HEADLINE]),
      h.p([h.Class('type-deck text-role-text-secondary')], [DECK]),
      prose(h),
      ...plates(figures, h),
      kit(h),
    ],
  )
