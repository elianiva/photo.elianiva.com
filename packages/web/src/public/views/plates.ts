/**
 * A run of plates flowed into columns — the Front's Section body and a Tag
 * page's whole body are the same arrangement at the same measure, so the flow
 * lives here once rather than twice.
 *
 * Desktop flows them into three columns with a hairline between them; mobile
 * flows them into two, without rules, at a 12px beat. The flow is computed per
 * breakpoint because the column count changes the assignment, so this draws
 * both trees and lets the `desktop` breakpoint pick one. The columns are not
 * authored — `flowColumns` drops each plate into the shortest column — and the
 * hairline between the desktop columns is a sibling rather than a border, so it
 * stretches to the tallest column and stops where that column stops.
 *
 * A plate in a run is below the fold, so a run fetches its plates lazily — the
 * exception is the run that heads the document, the Front's first Section, whose
 * first plate is the page's eager one. That plate used to be a Page One plate
 * in the lede; it is now simply the first plate of the first flow, which is
 * where it sat in the order all along.
 */

import type { HtmlBuilder } from 'foldkit/html'

import { gridColumns, gridColumnsMobile } from '@/lib/design-tokens'

import { flowColumns, type Figure } from '../content'
import { Message } from '../model'
import { figure } from './figure'
import type { Child } from './shared'

const column = (
  figures: ReadonlyArray<Figure>,
  gap: string,
  eagerHead: boolean,
  h: HtmlBuilder<Message>,
): Child =>
  h.div(
    [h.Class(`flex min-w-0 flex-1 flex-col ${gap}`)],
    [
      ...figures.map((plate, index) =>
        figure({ plate, slot: 'column', loading: eagerHead && index === 0 ? 'eager' : 'lazy' }, h),
      ),
    ],
  )

const columnsDesktop = (
  figures: ReadonlyArray<Figure>,
  headsDocument: boolean,
  h: HtmlBuilder<Message>,
): Child => {
  const flowed = flowColumns(figures, gridColumns)
  const children: Array<Child> = []
  flowed.forEach((columnFigures, index) => {
    // `flowColumns` puts the run's first plate at the head of the first column
    // on both masters, so one plate per tree is the eager one whichever way the
    // flow broke.
    children.push(column(columnFigures, 'gap-(--spacing-lg)', headsDocument && index === 0, h))
    if (index < flowed.length - 1) {
      children.push(h.div([h.Class('w-px shrink-0 bg-role-hairline')], []))
    }
  })
  return h.div([h.Class('hidden items-stretch gap-(--spacing-lg) desktop:flex')], children)
}

const columnsMobile = (
  figures: ReadonlyArray<Figure>,
  headsDocument: boolean,
  h: HtmlBuilder<Message>,
): Child =>
  h.div(
    [h.Class('flex items-stretch gap-(--spacing-lg) desktop:hidden')],
    [
      ...flowColumns(figures, gridColumnsMobile).map((columnFigures, index) =>
        column(columnFigures, 'gap-(--spacing-md)', headsDocument && index === 0, h),
      ),
    ],
  )

/** The two trees, in the order a caller places them: the mobile one first.
 *
 *  Both trees draw the same plates. They used to differ on the Front's first
 *  Section, whose mobile master also carried the lede's Page One plate.
 *
 *  `headsDocument` is the Front's own first Section: it sits at the top of the
 *  page, so the plate at the head of its flow is above the fold and is the one
 *  plate on the site the browser is told to fetch now. */
export const plateColumns = (
  figures: ReadonlyArray<Figure>,
  h: HtmlBuilder<Message>,
  headsDocument = false,
): ReadonlyArray<Child> => [
  columnsMobile(figures, headsDocument, h),
  columnsDesktop(figures, headsDocument, h),
]
