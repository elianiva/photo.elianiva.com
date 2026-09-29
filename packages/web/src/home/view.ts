/**
 * Home view root — the broadsheet front page. Editorial system: newsprint
 * paper, black ink, one display serif (Newsreader) over Libre Franklin, and
 * hairline rules as the only structure, so nothing competes with the plates.
 * Bands stack down the page; the region's views live in `views/`.
 */

import type { Document, HtmlBuilder } from 'foldkit/html'

import { Message } from './model'
import type { Model } from './model'
import { colophon } from './views/colophon'
import { continued } from './views/continued'
import { lede } from './views/lede'
import { lightbox } from './views/lightbox'
import { masthead } from './views/masthead'
import { editionSection } from './views/section'
import { BAND } from './views/shared'

// ---------------------------------------------------------------------------
// document
// ---------------------------------------------------------------------------

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'photo.elianiva.com — A summer in New York',
  lang: 'en',
  body: h.div(
    [
      // The colophon's "back to top" has a target to land on.
      h.Id('top'),
      // The layout margin steps up at `tablet`; the composition itself flips at
      // `desktop` in the views, because the desktop Front needs its full
      // 1080px measure to fit. The range between shows the mobile composition
      // at the tablet margin — the design has no tablet frame to follow.
      h.Class(
        'min-h-screen bg-role-surface px-(--layout-margin-mobile) text-role-text-primary tablet:px-(--layout-margin)',
      ),
    ],
    [
      masthead(model.edition, h),
      h.main(
        [h.Class('flex flex-col')],
        [
          lede(model.edition, h),
          ...model.edition.sections.map((section, index) =>
            editionSection(section, index === 0 ? model.edition.lead : null, h),
          ),
          h.div(
            [h.Id('archive'), h.Class(`${BAND} pt-(--spacing-lg) desktop:pt-(--spacing-3xl)`)],
            [continued(model.edition.tail, h)],
          ),
        ],
      ),
      colophon(model.edition.colophon, h),
      ...(model.selected !== null ? [lightbox(model.selected, h)] : []),
    ],
  ),
})
