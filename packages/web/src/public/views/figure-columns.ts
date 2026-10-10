/**
 * A run of figures flowed into columns — the home page's Month body and a Tag
 * page's whole body are the same arrangement at the same measure, so the flow
 * lives here once rather than twice.
 *
 * Desktop flows them into two columns with a hairline between them; mobile
 * flows them into two, without rules, at an 8px beat and bleeding 8px past
 * the page's side padding so each photo is a bit wider. The flow is computed per
 * breakpoint because the column count changes the assignment, so this draws
 * both trees and lets `lg` pick one. The columns are not
 * authored — `flowColumns` drops each photo into the shortest column — and the
 * hairline between the desktop columns is a sibling rather than a border, so it
 * stretches to the tallest column and stops where that column stops.
 *
 * A photo in a run is below the fold, so a run fetches its figures lazily — the
 * exception is the run that heads the document, the home page's first Month, whose
 * first photo is the page's eager one. That photo used to be a Page One photo
 * in the intro; it is now simply the first photo of the first flow, which is
 * where it sat in the order all along.
 */

import type { HtmlBuilder } from 'foldkit/html'

import { flowColumns, type Figure } from '../content'
import { Message } from '../model'
import { figure } from './figure'
import type { Child } from './shared'

/** The two column counts this file draws: two across on the desktop tree, two
 *  on the mobile one. */
const DESKTOP_COLUMNS = 2
const MOBILE_COLUMNS = 2

const column = (
  figures: ReadonlyArray<Figure>,
  gap: string,
  eagerHead: boolean,
  h: HtmlBuilder<Message>,
): Child =>
  h.div(
    [h.Class(`flex min-w-0 flex-1 flex-col ${gap}`)],
    [
      ...figures.map((photo, index) =>
        figure({ photo, slot: 'column', loading: eagerHead && index === 0 ? 'eager' : 'lazy' }, h),
      ),
    ],
  )

const columnsDesktop = (
  figures: ReadonlyArray<Figure>,
  headsDocument: boolean,
  h: HtmlBuilder<Message>,
): Child => {
  const flowed = flowColumns(figures, DESKTOP_COLUMNS)
  const children: Array<Child> = []
  flowed.forEach((columnFigures, index) => {
    // `flowColumns` puts the run's first photo at the head of the first column
    // on both masters, so one photo per tree is the eager one whichever way the
    // flow broke.
    children.push(column(columnFigures, 'gap-4', headsDocument && index === 0, h))
    if (index < flowed.length - 1) {
      children.push(h.div([h.Class('w-px shrink-0 bg-role-hairline')], []))
    }
  })
  return h.div([h.Class('hidden items-stretch gap-4 lg:flex')], children)
}

const columnsMobile = (
  figures: ReadonlyArray<Figure>,
  headsDocument: boolean,
  h: HtmlBuilder<Message>,
): Child =>
  h.div(
    [h.Class('-mx-2 flex items-stretch gap-2 lg:hidden')],
    [
      ...flowColumns(figures, MOBILE_COLUMNS).map((columnFigures, index) =>
        column(columnFigures, 'gap-3', headsDocument && index === 0, h),
      ),
    ],
  )

/** The two trees, in the order a caller places them: the mobile one first.
 *
 *  Both trees draw the same figures. They used to differ on the home page's first
 *  Month, whose mobile master also carried the intro's Page One photo.
 *
 *  `headsDocument` is the home page's own first Month: it sits at the top of the
 *  page, so the photo at the head of its flow is above the fold and is the one
 *  photo on the site the browser is told to fetch now. */
export const figureColumns = (
  figures: ReadonlyArray<Figure>,
  h: HtmlBuilder<Message>,
  headsDocument = false,
): ReadonlyArray<Child> => [
  columnsMobile(figures, headsDocument, h),
  columnsDesktop(figures, headsDocument, h),
]
