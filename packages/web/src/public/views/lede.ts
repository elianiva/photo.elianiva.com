/**
 * Lede: the headline block the Front opens with. It carries the site's own
 * voice and no photograph — the plates start at the first Section below it, and
 * every one of them is drawn the same way, because a photograph is not a
 * frontispiece here.
 *
 * The copy is written here, next to the markup that prints it, and it is the
 * publication's own voice rather than a read: it must be true whatever the
 * archive holds, so it claims no frame count and no month range. A site with
 * nothing published says so instead — the one thing a static lede cannot do
 * is describe a batch of photographs that is not there.
 *
 * The headline is one word. It used to be an epigram — `Street, mostly.
 * Landscape, sometimes.` — and before that a newspaper lede: `A summer in New
 * York, a night in Istanbul, then home to Jakarta.` Both were written to sound
 * composed rather than to say where you are, and neither is what the rest of
 * the site sounds like. The deck is the one line that earns itself: this is the
 * front page, and the only thing it does that a grid of thumbnails does not is
 * open a photograph at full size.
 *
 * The block is one composition rather than two. It used to set its text opposite
 * the Page One plate, three parts to the plate's two, and to hide that plate on
 * mobile — so the headline was a two-thirds measure above the fold on the
 * desktop and the full measure on the mobile. With no plate opposite it the
 * measure is the page's own.
 */

import type { HtmlBuilder } from 'foldkit/html'

import type { Edition } from '../content'
import { Message } from '../model'
import { BAND, type Child } from './shared'

export const lede = (edition: Edition, h: HtmlBuilder<Message>): Child => {
  const isEmpty = edition.sections.length === 0
  return h.section(
    [h.Class('flex flex-col')],
    [
      h.div(
        [h.Class(`${BAND} flex flex-col gap-2 pt-8 lg:pt-12`)],
        [
          h.h1(
            [h.Class('type-section text-role-text-primary')],
            [isEmpty ? 'nothing here yet' : 'A bunch of photographs I took'],
          ),
          h.p(
            [h.Class('hidden type-deck text-role-text-secondary lg:block')],
            [
              isEmpty
                ? 'The first one is on its way.'
                : 'Aside from writing software, I like doing photography. I mostly take street photos because I like to walk around the neighbourhood and interact with people. These are some of my results',
            ],
          ),
        ],
      ),
    ],
  )
}
