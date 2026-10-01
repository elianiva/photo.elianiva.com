/**
 * A section of the edition: the month under a rule, then its plates flowed
 * into columns. The flow itself is `plateColumns` — a Tag page's run of plates
 * is the same arrangement at the same measure, so it is drawn once there.
 *
 * The head counts the Section's own plates and the flow draws exactly those, so
 * the count is the same fact on both masters. It used not to be: the lede held
 * a Page One plate, the desktop composition left it out of the first Section
 * and the mobile one took it as its own first frame, so the mobile
 * `August 2025` head counted nine frames where the desktop head counted eight.
 * No plate is held back now, so there is one list and one count.
 */

import type { HtmlBuilder } from 'foldkit/html'

import { frameCount, sectionCount, type EditionSection } from '../content'
import { Message } from '../model'
import { plateColumns } from './plates'
import { BAND, type Child } from './shared'

const sectionHead = (
  section: EditionSection,
  mobileCount: string,
  h: HtmlBuilder<Message>,
): Child =>
  h.div(
    [
      h.Class(
        'flex items-end justify-between gap-(--spacing-md) border-t border-role-rule pt-(--spacing-md) desktop:gap-(--spacing-lg)',
      ),
    ],
    [
      h.div(
        [h.Class('flex items-end gap-(--spacing-sm) desktop:gap-(--spacing-md)')],
        [
          h.h2(
            [h.Class('type-section-sm italic text-role-text-primary desktop:type-section')],
            [section.month],
          ),
          h.span([h.Class('type-exif text-role-text-secondary')], [section.year]),
        ],
      ),
      h.span(
        [h.Class('type-kicker text-role-text-secondary')],
        [
          h.span([h.Class('desktop:hidden')], [mobileCount]),
          h.span([h.Class('hidden desktop:inline')], [sectionCount(section)]),
        ],
      ),
    ],
  )

/** `headsDocument` is the Front's first Section — the one whose first plate is
 *  above the fold, and so the one plate on the site the browser is told to
 *  fetch now. */
export const editionSection = (
  section: EditionSection,
  headsDocument: boolean,
  h: HtmlBuilder<Message>,
): Child =>
  h.section(
    [h.Class('flex flex-col')],
    [
      h.div(
        [
          h.Class(
            `${BAND} flex flex-col gap-(--spacing-lg) pt-(--spacing-2xl) desktop:gap-(--spacing-xl) desktop:pt-(--spacing-3xl)`,
          ),
        ],
        [
          sectionHead(section, frameCount(section.figures.length), h),
          ...plateColumns(section.figures, h, headsDocument),
        ],
      ),
    ],
  )
