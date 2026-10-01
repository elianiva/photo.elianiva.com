/**
 * A section of the edition: the month under a rule, then its plates flowed
 * into columns. The flow itself is `plateColumns` — a Tag page's run of plates
 * is the same arrangement at the same measure, so it is drawn once there.
 *
 * `pageOne` is the lede's Page One plate on the desktop Front. The mobile lede
 * has no plate, so the first section takes it as its own first frame — which
 * is why the mobile `August 2025` head counts nine frames where the desktop
 * head counts eight.
 */

import type { HtmlBuilder } from 'foldkit/html'

import { frameCount, sectionCount, type EditionSection, type Figure } from '../content'
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

export const editionSection = (
  section: EditionSection,
  pageOne: Figure | null,
  h: HtmlBuilder<Message>,
): Child => {
  const mobileFigures = pageOne === null ? section.figures : [pageOne, ...section.figures]
  return h.section(
    [h.Class('flex flex-col')],
    [
      h.div(
        [
          h.Class(
            `${BAND} flex flex-col gap-(--spacing-lg) pt-(--spacing-2xl) desktop:gap-(--spacing-xl) desktop:pt-(--spacing-3xl)`,
          ),
        ],
        [
          sectionHead(section, frameCount(mobileFigures.length), h),
          // The mobile tree takes the Page One plate, which belongs to the
          // first section on that master and to no section on the desktop one.
          ...plateColumns(mobileFigures, section.figures, h),
        ],
      ),
    ],
  )
}
