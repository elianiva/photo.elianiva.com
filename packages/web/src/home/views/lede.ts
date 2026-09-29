/**
 * Lede: the edition's headline block opposite its Page One plate. The text
 * column takes three parts to the plate's two, which is where the frame's
 * 3:2 / 2:3 split comes from.
 *
 * The mobile frame has no Page One plate and no deck: the headline sets at the
 * deck's size, the kicker drops the range, and the plate becomes the first
 * frame of the first section (see `editionSection`).
 */

import type { HtmlBuilder } from 'foldkit/html'

import type { Edition } from '../content'
import { Message } from '../model'
import { figure } from './figure'
import { BAND, type Child } from './shared'

export const lede = (edition: Edition, h: HtmlBuilder<Message>): Child =>
  h.section(
    [h.Class('flex flex-col')],
    [
      h.div(
        [
          h.Class(
            `${BAND} flex flex-col gap-(--spacing-sm) pt-(--spacing-2xl) desktop:flex-row desktop:items-start desktop:justify-between desktop:gap-(--spacing-3xl) desktop:pt-(--spacing-3xl)`,
          ),
        ],
        [
          h.div(
            [
              h.Class(
                'flex flex-col gap-(--spacing-sm) desktop:flex-[3] desktop:gap-(--spacing-md)',
              ),
            ],
            [
              h.span(
                [h.Class('type-kicker text-role-text-secondary')],
                [
                  h.span([h.Class('desktop:hidden')], [edition.kickerMobile]),
                  h.span([h.Class('hidden desktop:inline')], [edition.kicker]),
                ],
              ),
              h.h1(
                [h.Class('type-deck text-role-text-primary desktop:type-headline')],
                [edition.headline],
              ),
              h.p(
                [h.Class('hidden type-deck text-role-text-secondary desktop:block')],
                [edition.deck],
              ),
            ],
          ),
          h.div(
            [h.Class('hidden flex-col desktop:flex desktop:flex-2')],
            [figure(edition.lead, 'page', h)],
          ),
        ],
      ),
    ],
  )
