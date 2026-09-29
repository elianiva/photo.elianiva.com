/**
 * Colophon: what the photographs were made with, where the sections live,
 * where else to find them, and the copyright line. The nameplate repeats at
 * half size because the colophon is the last thing on the page.
 */

import type { HtmlBuilder } from 'foldkit/html'

import type { Colophon, ColophonColumn } from '../content'
import { Message } from '../model'
import { ruleStack } from './rules'
import { BAND, type Child } from './shared'

/**
 * The standing columns, and the about block beside them. The design's measure
 * is exact — about 374.4 against three columns of 187.2 — so this is a grid:
 * a flex row floors at the widest column's min-content width and misses those
 * shares.
 */
const COLUMNS =
  'grid grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] gap-(--layout-margin) pb-(--spacing-3xl) pt-(--spacing-2xl)'

const about = (c: Colophon, h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class('flex min-w-0 flex-col gap-(--spacing-md)')],
    [
      h.span([h.Class('type-nameplate-sm text-role-text-primary')], ['Elianiva']),
      h.p([h.Class('type-body italic text-role-text-secondary')], [c.blurb]),
    ],
  )

const colophonColumn = (column: ColophonColumn, h: HtmlBuilder<Message>): Child =>
  h.div(
    [
      h.Class(
        'flex min-w-0 flex-col gap-(--spacing-sm) border-l border-role-hairline pb-(--spacing-xl) pl-(--spacing-lg) pt-(--spacing-lg)',
      ),
    ],
    [
      h.span([h.Class('type-kicker text-role-text-secondary')], [column.label]),
      h.ul(
        [h.Class('flex list-none flex-col gap-1.5')],
        [
          ...column.lines.map((line) =>
            h.li([h.Class('type-exif text-role-text-primary')], [line]),
          ),
        ],
      ),
    ],
  )

const baseline = (c: Colophon, h: HtmlBuilder<Message>): Child =>
  h.div(
    [
      h.Class(
        'flex items-center justify-between gap-(--spacing-lg) border-t border-role-hairline pb-(--spacing-xl) pt-(--spacing-lg)',
      ),
    ],
    [
      h.span([h.Class('type-kicker flex-1 text-role-text-disabled')], [c.copyright]),
      h.span([h.Class('type-caption italic text-role-text-disabled')], [c.note]),
      h.a([h.Href('#top'), h.Class('type-kicker text-role-text-primary')], [c.backToTop]),
    ],
  )

export const colophon = (c: Colophon, h: HtmlBuilder<Message>): Child =>
  h.footer(
    [h.Class('flex flex-col')],
    [
      h.div(
        [h.Class(`${BAND} flex flex-col`)],
        [
          ruleStack(h),
          h.div(
            [h.Class(COLUMNS)],
            [about(c, h), ...c.columns.map((column) => colophonColumn(column, h))],
          ),
          baseline(c, h),
        ],
      ),
    ],
  )
