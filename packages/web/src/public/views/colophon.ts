/**
 * Colophon: what the photographs were made with, where the sections live,
 * where else to find them, and the copyright line. The nameplate repeats at
 * half size because the colophon is the last thing on the page.
 *
 * Every word is written here, where it renders: a colophon is a statement about
 * how the work was made, which is the one thing a settings row cannot know. The
 * Admin's settings page used to author a copyright line and an about paragraph
 * that this column never printed, so there was a second, invisible source for
 * both.
 *
 * The one list here that is read is SECTIONS, because it is the Folio again: the
 * Colophon says where the site is, and a hand-written copy of the nav beside a
 * read one is two lists free to disagree. It is printed in the same kicker and
 * the same caps as the Folio, so the two lists are the same list twice.
 *
 * The copyright line is the one string here that will one day be wrong: it is
 * written out rather than derived, because the Colophon is handed the Folio and
 * no dates. It read `2021–2025` through 2026. It is set in the site's own case
 * rather than in capitals, like everything else the site says.
 *
 * ELSEWHERE is plain text, not links, and that is a known gap rather than a
 * decision: the addresses are the photographer's to publish, so this file does
 * not invent a destination for any of them. `/rss.xml` used to be named here
 * and in the Folio and is not a route, so it is gone from both until a feed
 * exists to point at.
 *
 * The mobile Colophon master (size=mobile) is a different composition: the
 * About block stands on its own above a bordered two-column row, EQUIPMENT is
 * dropped, the lists are shorter, the note is gone and the copyright loses its
 * rights clause. The columns wrapper carries those differences on `desktop`,
 * where it becomes `display: contents` so its children join the desktop grid
 * as items 2–4 and keep the design's exact 2fr / 1fr / 1fr / 1fr shares.
 */

import type { HtmlBuilder } from 'foldkit/html'

import type { FolioEntry } from '../content'
import { Message } from '../model'
import { BAND, type Child } from './shared'

/**
 * The desktop measure: about 374.4 against three columns of 187.2. A flex row
 * floors at the widest column's min-content width and misses those shares, so
 * this is a grid. Its mobile branch is one column, and the About's own `py`
 * supplies the gap the desktop grid supplies with `pt`/`gap`.
 */
const COLUMNS =
  'grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] lg:gap-12 lg:pb-12 lg:pt-8'

const COLUMN =
  'min-w-0 flex-1 flex-col gap-2 lg:border-l lg:border-role-hairline lg:pb-6 lg:pl-4 lg:pt-4'

const about = (h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class('flex min-w-0 flex-col gap-3 py-6 lg:py-0')],
    [
      h.span([h.Class('type-nameplate-sm text-role-text-primary')], ['Elianiva']),
      h.p([h.Class('type-body italic text-role-text-secondary')], ['Shot on foot, usually early.']),
    ],
  )

const columnLine = (line: string, mobile: boolean, h: HtmlBuilder<Message>): Child =>
  h.li(
    [h.Class(`${mobile ? 'type-exif-sm' : 'type-exif'} uppercase text-role-text-primary`)],
    [line],
  )

/** One column, printed twice: the mobile list is the plainer of the two when
 *  the column names one. */
const colophonColumn = (
  column: {
    readonly label: string
    readonly lines: ReadonlyArray<string>
    readonly linesMobile?: ReadonlyArray<string>
    readonly desktopOnly?: boolean
  },
  h: HtmlBuilder<Message>,
): Child =>
  h.div(
    [h.Class(`${column.desktopOnly === true ? 'hidden lg:flex' : 'flex'} ${COLUMN}`)],
    [
      h.span([h.Class('type-kicker text-role-text-secondary uppercase')], [column.label]),
      h.ul(
        [h.Class('flex list-none flex-col gap-1.5 lg:hidden')],
        [...(column.linesMobile ?? column.lines).map((line) => columnLine(line, true, h))],
      ),
      h.ul(
        [h.Class('hidden list-none flex-col gap-1.5 lg:flex')],
        [...column.lines.map((line) => columnLine(line, false, h))],
      ),
    ],
  )

const baseline = (h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class('flex items-center justify-between gap-4 border-t border-role-hairline pb-6 pt-4')],
    [
      h.span(
        [h.Class('type-kicker flex-1 text-role-text-disabled')],
        [
          h.span([h.Class('lg:hidden')], ['© 2021–2026 elianiva']),
          h.span([h.Class('hidden lg:inline')], ['© 2021–2026 elianiva · all rights reserved']),
        ],
      ),
      h.span(
        [h.Class('hidden type-caption italic text-role-text-disabled lg:block')],
        ['Set in Newsreader, Libre Franklin and IBM Plex Mono.'],
      ),
      h.a(
        [h.Href('#top'), h.Class('type-kicker text-role-text-primary uppercase')],
        ['back to top ↑'],
      ),
    ],
  )

export const colophon = (folio: ReadonlyArray<FolioEntry>, h: HtmlBuilder<Message>): Child => {
  // The three lists the Colophon prints, written here rather than in a table
  // the whole app reads: `linesMobile` is the plainer list, and `desktopOnly`
  // drops EQUIPMENT on mobile because the master has no room for it.
  //
  // SECTIONS is the exception and is read: it is the Folio's own entries, in
  // the order the Folio draws them, with the About page after them — the same
  // list the masthead prints, so a Tag added in the Admin appears in both, and
  // no more or fewer of them. It has no mobile variant because the Folio has
  // none to shorten.
  const sections = [...folio.map((entry) => entry.label), 'about']
  const columns = [
    {
      label: 'equipment',
      lines: [
        'Camera — Fujifilm X-T20',
        'Lens — 25mm f/1.8, manual',
        'Film sim — Classic Chrome',
        'Based in Jakarta',
      ],
      desktopOnly: true,
    },
    {
      label: 'sections',
      lines: sections,
    },
    {
      label: 'elsewhere',
      lines: ['instagram', 'prints on request', 'hello@elianiva.com'],
      linesMobile: ['instagram', 'hello@elianiva.com'],
    },
  ]
  return h.footer(
    [h.Class('flex flex-col')],
    [
      h.div(
        [h.Class(`${BAND} flex flex-col border-t border-role-hairline pt-12 lg:pt-16`)],
        [
          h.div(
            [h.Class(COLUMNS)],
            [
              about(h),
              h.div(
                [
                  h.Class(
                    'flex flex-row gap-4 border-t border-role-hairline pb-6 pt-4 lg:contents',
                  ),
                ],
                columns.map((column) => colophonColumn(column, h)),
              ),
            ],
          ),
          baseline(h),
        ],
      ),
    ],
  )
}
