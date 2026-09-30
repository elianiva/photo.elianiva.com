/**
 * Lede: the headline block opposite the Page One plate. The text column takes
 * three parts to the plate's two, which is where the frame's 3:2 / 2:3 split
 * comes from.
 *
 * The copy is written here, next to the markup that prints it, and it is the
 * publication's own voice rather than a read: it must be true whatever the
 * archive holds, so it claims no frame count and no month range. A site with
 * nothing published says so instead — the one thing a static lede cannot do
 * is describe a batch of photographs that is not there.
 *
 * The mobile frame has no Page One plate and no deck: the headline sets at the
 * deck's size and the plate becomes the first frame of the first section (see
 * `editionSection`).
 */

import type { HtmlBuilder } from 'foldkit/html'

import type { Edition } from '../content'
import { Message } from '../model'
import { figure } from './figure'
import { BAND, type Child } from './shared'

export const lede = (edition: Edition, h: HtmlBuilder<Message>): Child => {
  const isEmpty = edition.lead === null
  return h.section(
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
              h.h1(
                [h.Class('type-deck text-role-text-primary desktop:type-headline')],
                [
                  isEmpty
                    ? 'Nothing published yet.'
                    : 'A summer in New York, a night in Istanbul, then home to Jakarta.',
                ],
              ),
              h.p(
                [h.Class('hidden type-deck text-role-text-secondary desktop:block')],
                [
                  isEmpty
                    ? 'The first photograph is on its way. Everything below the masthead is the front page waiting for it.'
                    : 'Made on foot, with one camera and one lens.',
                ],
              ),
            ],
          ),
          // A site with no published photograph has no Page One plate, so the
          // column is not drawn at all rather than drawn empty.
          ...(edition.lead === null
            ? []
            : [
                h.div(
                  [h.Class('hidden flex-col desktop:flex desktop:flex-2')],
                  [figure(edition.lead, 'page', h)],
                ),
              ]),
        ],
      ),
    ],
  )
}
