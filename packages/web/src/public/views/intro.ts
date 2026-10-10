/**
 * Lede: the headline the home page opens with. It carries the site's own voice and
 * no photograph — the contact sheet starts right below it, and every frame on
 * it is drawn the same way, because a photograph is not a cover photo here.
 *
 * The copy is written here, next to the markup that prints it, and it is the
 * publication's own voice rather than a read: it must be true whatever the
 * archive holds, so it claims no frame count and no month range. A site with
 * nothing published says so instead — the one thing a static intro cannot do
 * is describe a batch of photographs that is not there.
 *
 * The headline is set large and tight, with the complete phrase kept inside
 * the page measure. The deck sits beside it on a wide screen and drops below
 * it on a narrow one.
 */

import type { HtmlBuilder } from 'foldkit/html'

import type { Timeline } from '../content'
import { Message } from '../model'
import { BAND, type Child } from './shared'

export const intro = (timeline: Timeline, h: HtmlBuilder<Message>): Child => {
  const isEmpty = timeline.sections.length === 0
  return h.section(
    [h.Class('flex flex-col')],
    [
      h.div(
        [
          h.Class(
            `${BAND} flex flex-col gap-6 pb-8 pt-8 lg:flex-row lg:items-end lg:justify-between lg:gap-10 lg:pb-10 lg:pt-12`,
          ),
        ],
        [
          h.h1(
            [h.Class('type-display max-w-full text-role-text-primary sm:max-w-[14ch]')],
            isEmpty
              ? ['nothing here ', h.span([h.Class('text-role-accent italic')], ['yet'])]
              : [
                  'A bunch of photographs ',
                  h.span([h.Class('whitespace-nowrap text-role-accent italic')], ['I took']),
                ],
          ),
          h.p(
            [h.Class('max-w-[340px] type-caption text-role-text-primary')],
            [
              isEmpty
                ? 'Nothing posted yet, check back later.'
                : 'Aside from writing software, I like doing photography. I mostly take street photos because I like to walk around the neighbourhood and interact with people.',
            ],
          ),
        ],
      ),
    ],
  )
}
