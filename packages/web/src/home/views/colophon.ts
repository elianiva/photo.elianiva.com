/**
 * Colophon: what the photographs were made with, where the sections live,
 * where else to find them, and the copyright line. The nameplate repeats at
 * half size because the colophon is the last thing on the page.
 *
 * The mobile Colophon master (size=mobile) is a different composition: the
 * About block stands on its own above a bordered two-column row, EQUIPMENT is
 * dropped, the lists are shorter, the note is gone and the copyright loses its
 * rights clause. The columns wrapper carries those differences on `desktop`,
 * where it becomes `display: contents` so its children join the desktop grid
 * as items 2–4 and keep the design's exact 2fr / 1fr / 1fr / 1fr shares.
 */

import type { HtmlBuilder } from 'foldkit/html'

import type { Colophon, ColophonColumn } from '../content'
import { Message } from '../model'
import { colophonRules } from './rules'
import { BAND, type Child } from './shared'

/**
 * The desktop measure: about 374.4 against three columns of 187.2. A flex row
 * floors at the widest column's min-content width and misses those shares, so
 * this is a grid. Its mobile branch is one column, and the About's own `py`
 * supplies the gap the desktop grid supplies with `pt`/`gap`.
 */
const COLUMNS =
  'grid grid-cols-1 desktop:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] desktop:gap-(--layout-margin) desktop:pb-(--spacing-3xl) desktop:pt-(--spacing-2xl)'

const COLUMN =
  'min-w-0 flex-1 flex-col gap-(--spacing-sm) desktop:border-l desktop:border-role-hairline desktop:pb-(--spacing-xl) desktop:pl-(--spacing-lg) desktop:pt-(--spacing-lg)'

const about = (c: Colophon, h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class('flex min-w-0 flex-col gap-(--spacing-md) py-(--spacing-xl) desktop:py-0')],
    [
      h.span([h.Class('type-nameplate-sm text-role-text-primary')], ['Elianiva']),
      h.p([h.Class('type-body italic text-role-text-secondary')], [c.blurb]),
    ],
  )

const columnLine = (line: string, mobile: boolean, h: HtmlBuilder<Message>): Child =>
  h.li(
    [h.Class(mobile ? 'type-exif-sm text-role-text-primary' : 'type-exif text-role-text-primary')],
    [line],
  )

const colophonColumn = (column: ColophonColumn, h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class(`${column.desktopOnly === true ? 'hidden desktop:flex' : 'flex'} ${COLUMN}`)],
    [
      h.span([h.Class('type-kicker text-role-text-secondary')], [column.label]),
      h.ul(
        [h.Class('flex list-none flex-col gap-1.5 desktop:hidden')],
        [...(column.linesMobile ?? column.lines).map((line) => columnLine(line, true, h))],
      ),
      h.ul(
        [h.Class('hidden list-none flex-col gap-1.5 desktop:flex')],
        [...column.lines.map((line) => columnLine(line, false, h))],
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
      h.span(
        [h.Class('type-kicker flex-1 text-role-text-disabled')],
        [
          h.span([h.Class('desktop:hidden')], [c.copyrightMobile ?? c.copyright]),
          h.span([h.Class('hidden desktop:inline')], [c.copyright]),
        ],
      ),
      h.span(
        [h.Class('hidden type-caption italic text-role-text-disabled desktop:block')],
        [c.note],
      ),
      h.a([h.Href('#top'), h.Class('type-kicker text-role-text-primary')], [c.backToTop]),
    ],
  )

export const colophon = (c: Colophon, h: HtmlBuilder<Message>): Child =>
  h.footer(
    [h.Class('flex flex-col')],
    [
      h.div(
        [h.Class(`${BAND} flex flex-col pt-(--spacing-3xl) desktop:pt-(--spacing-4xl)`)],
        [
          colophonRules(h),
          h.div(
            [h.Class(COLUMNS)],
            [
              about(c, h),
              h.div(
                [
                  h.Class(
                    'flex flex-row gap-(--spacing-lg) border-t border-role-hairline pb-(--spacing-xl) pt-(--spacing-lg) desktop:contents',
                  ),
                ],
                [...c.columns.map((column) => colophonColumn(column, h))],
              ),
            ],
          ),
          baseline(c, h),
        ],
      ),
    ],
  )
