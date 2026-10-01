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
 * A plate in a run is below the fold whatever the run is, so every one of them
 * is fetched lazily: the Front's lead is the only plate the site fetches
 * eagerly, and it is drawn by the lede rather than by here.
 */

import type { HtmlBuilder } from 'foldkit/html'

import { gridColumns, gridColumnsMobile } from '@/lib/design-tokens'

import { flowColumns, type Figure } from '../content'
import { Message } from '../model'
import { figure } from './figure'
import type { Child } from './shared'

const column = (figures: ReadonlyArray<Figure>, gap: string, h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class(`flex min-w-0 flex-1 flex-col ${gap}`)],
    [...figures.map((plate) => figure({ plate, slot: 'column' }, h))],
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

/** The two trees, in the order a caller places them: the mobile one first.
 *
 *  `mobile` and `desktop` are the same list everywhere but on the Front's first
 *  Section, whose mobile master also carries the lede's Page One plate — the
 *  desktop composition draws that plate in the lede, so its Section does not
 *  repeat it. */
export const plateColumns = (
  mobile: ReadonlyArray<Figure>,
  desktop: ReadonlyArray<Figure>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Child> => [columnsMobile(mobile, h), columnsDesktop(desktop, h)]
