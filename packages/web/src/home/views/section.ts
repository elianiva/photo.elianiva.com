/**
 * A section of the edition: the month under a rule, then its plates flowed
 * into three columns. The columns are not authored — `flowColumns` drops each
 * plate into the shortest column — and the hairline between them is a sibling
 * rather than a border, so it stretches to the tallest column and stops where
 * that column stops.
 */

import type { HtmlBuilder } from 'foldkit/html'

import { gridColumns } from '@/lib/design-tokens'

import { flowColumns, sectionCount, type EditionSection, type Figure } from '../content'
import { Message } from '../model'
import { figure } from './figure'
import { BAND, type Child } from './shared'

const COLUMNS = gridColumns

const sectionHead = (section: EditionSection, h: HtmlBuilder<Message>): Child =>
  h.div(
    [
      h.Class(
        'flex items-end justify-between gap-(--spacing-lg) border-t border-role-rule pt-(--spacing-md)',
      ),
    ],
    [
      h.div(
        [h.Class('flex items-end gap-(--spacing-md)')],
        [
          h.h2([h.Class('type-section italic text-role-text-primary')], [section.month]),
          h.span([h.Class('type-exif text-role-text-secondary')], [section.year]),
        ],
      ),
      h.span([h.Class('type-kicker text-role-text-secondary')], [sectionCount(section)]),
    ],
  )

const column = (figures: ReadonlyArray<Figure>, h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class('flex min-w-0 flex-1 flex-col gap-(--spacing-lg)')],
    [...figures.map((plate) => figure(plate, 'column', h))],
  )

const columns = (section: EditionSection, h: HtmlBuilder<Message>): Child => {
  const flowed = flowColumns(section.figures, COLUMNS)
  const children: Array<Child> = []
  flowed.forEach((figures, index) => {
    children.push(column(figures, h))
    if (index < flowed.length - 1) {
      children.push(h.div([h.Class('w-px shrink-0 bg-role-hairline')], []))
    }
  })
  return h.div([h.Class('flex items-stretch gap-(--spacing-lg)')], children)
}

export const editionSection = (section: EditionSection, h: HtmlBuilder<Message>): Child =>
  h.section(
    [h.Class('flex flex-col')],
    [
      h.div(
        [h.Class(`${BAND} flex flex-col gap-(--spacing-xl) pt-(--spacing-3xl)`)],
        [sectionHead(section, h), columns(section, h)],
      ),
    ],
  )
