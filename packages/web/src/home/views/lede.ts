/**
 * Lede: the edition's headline block opposite its Page One plate. The text
 * column takes three parts to the plate's two, which is where the frame's
 * 3:2 / 2:3 split comes from.
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
            `${BAND} flex items-start justify-between gap-(--spacing-3xl) pt-(--spacing-3xl)`,
          ),
        ],
        [
          h.div(
            [h.Class('flex flex-[3] flex-col gap-(--spacing-md)')],
            [
              h.span([h.Class('type-kicker text-role-text-secondary')], [edition.kicker]),
              h.h1([h.Class('type-headline text-role-text-primary')], [edition.headline]),
              h.p([h.Class('type-deck text-role-text-secondary')], [edition.deck]),
            ],
          ),
          h.div([h.Class('flex flex-2 flex-col')], [figure(edition.lead, 'page', h)]),
        ],
      ),
    ],
  )
