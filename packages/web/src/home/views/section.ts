/**
 * A section of the edition: the month under a rule, then its plates flowed
 * into columns. Desktop flows them into three columns with a hairline between
 * them; mobile flows them into two, without rules, at a 12px beat. The flow is
 * computed per breakpoint because the column count changes the assignment, so
 * the section draws both trees and lets the `desktop` breakpoint pick one. The
 * columns are not authored — `flowColumns` drops each plate into the shortest
 * column — and the hairline between the desktop columns is a sibling rather
 * than a border, so it stretches to the tallest column and stops where that
 * column stops.
 *
 * `pageOne` is the lede's Page One plate on the desktop Front. The mobile lede
 * has no plate, so the first section takes it as its own first frame — which
 * is why the mobile `August 2025` head counts nine frames where the desktop
 * head counts eight.
 */

import type { HtmlBuilder } from 'foldkit/html'

import { gridColumns, gridColumnsMobile } from '@/lib/design-tokens'

import { flowColumns, frameCount, sectionCount, type EditionSection, type Figure } from '../content'
import { Message } from '../model'
import { figure } from './figure'
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

const column = (figures: ReadonlyArray<Figure>, gap: string, h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class(`flex min-w-0 flex-1 flex-col ${gap}`)],
    [...figures.map((plate) => figure(plate, 'column', h))],
  )

const columnsDesktop = (figures: ReadonlyArray<Figure>, h: HtmlBuilder<Message>): Child => {
  const flowed = flowColumns(figures, gridColumns)
  const children: Array<Child> = []
  flowed.forEach((columnFigures, index) => {
    children.push(column(columnFigures, 'gap-(--spacing-lg)', h))
    if (index < flowed.length - 1) {
      children.push(h.div([h.Class('w-px shrink-0 bg-role-hairline')], []))
    }
  })
  return h.div([h.Class('hidden items-stretch gap-(--spacing-lg) desktop:flex')], children)
}

const columnsMobile = (figures: ReadonlyArray<Figure>, h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class('flex items-stretch gap-(--spacing-lg) desktop:hidden')],
    [
      ...flowColumns(figures, gridColumnsMobile).map((columnFigures) =>
        column(columnFigures, 'gap-(--spacing-md)', h),
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
          columnsMobile(mobileFigures, h),
          columnsDesktop(section.figures, h),
        ],
      ),
    ],
  )
}
