import type { HtmlBuilder } from 'foldkit/html'

import type { Figure } from '../content'
import { Message } from '../model'
import { figure } from './figure'
import { kit } from './kit'
import { BAND, type Child } from './shared'

const DECK =
  "I'm a software engineer who happens to also love photography, you'll find mostly street photography here. I'm not a professional photographer by any means, these are just pictures I took on my free time"

/** The desktop master's two columns, one paragraph each. */
const COLUMNS: ReadonlyArray<string> = [
  'I shoot on the way to things. That is most of the method, and it works fine. If the light is bad I wait a bit, or I come back the next morning.',
  'I keep everything, including the ones I do not like. Each photograph gets a number, a date, and whatever exposure the camera reported. Nothing gets edited afterwards. This site is the whole folder, newest first.',
]

/** The mobile master's single paragraph: the same two columns, re-flowed. */
const PROSE_MOBILE =
  'I shoot on the way to things. That is most of the method. I keep everything, including the ones I do not like — each photograph gets a number, a date, and whatever exposure the camera reported, and nothing gets edited afterwards.'

const paragraph = (className: string, text: string, h: HtmlBuilder<Message>): Child =>
  h.p([h.Class(className)], [text])

const prose = (h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class('grid gap-6 lg:grid-cols-2')],
    [
      paragraph('type-body text-role-text-primary lg:hidden', PROSE_MOBILE, h),
      ...COLUMNS.map((column) =>
        paragraph('hidden type-body text-role-text-primary lg:block', column, h),
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
      : h.div([h.Class('hidden lg:block')], [figure({ plate, slot: 'about', loading: 'lazy' }, h)]),
  )

export const aboutBody = (figures: ReadonlyArray<Figure>, h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Id('about'), h.Class(`${BAND} flex flex-col gap-4 pt-8 lg:gap-6 lg:pt-12`)],
    [
      h.span([h.Class('type-kicker text-role-text-secondary uppercase')], ['about']),
      h.h1(
        [h.Class('type-section text-role-text-primary')],
        ['Hi there! You stumbled upon my photography website :)'],
      ),
      h.p([h.Class('type-deck text-role-text-secondary')], [DECK]),
      prose(h),
      ...plates(figures, h),
      kit(h),
    ],
  )
