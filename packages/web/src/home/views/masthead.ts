/**
 * Masthead: the broadsheet's front. The site name sits in a strip over the
 * nameplate; the ears carry the origin, the tagline and the archive line; the
 * folio below the rule stack is the only navigation on the page.
 *
 * Every word here is written where it renders, and none of it is read: a
 * masthead is the publication's voice, so it changes when the voice changes
 * rather than when a photograph is uploaded. The strip used to carry a volume
 * numeral, an issue number and the date of the newest photograph — computed
 * strings that made the header count things the site does not publish, and
 * that any of them could contradict after one edit. What is left is the name.
 *
 * The mobile Masthead master (size=mobile) drops the ears and the site name
 * from the strip, centres the short nameplate over the tagline, and keeps only
 * the section links and search in the folio — so the 112px nameplate never has
 * to fit a narrow measure. The ears' fixed 260px boxes and the 112px nameplate
 * are what put the flip at `desktop`: below it the desktop composition cannot
 * fit.
 */

import { Search } from 'lucide'
import type { HtmlBuilder } from 'foldkit/html'

import * as NavLink from '@/components/ui/nav-link'

import { icon } from '@/lib/icons'

import { Message } from '../model'
import { mastheadRules } from './rules'
import { BAND, type Child } from './shared'

/** The two boxes flanking the desktop nameplate: same box, mirrored alignment. */
const EAR =
  'hidden w-[260px] shrink-0 flex-col gap-(--spacing-xs) px-(--spacing-md) py-(--spacing-sm) desktop:flex'

const earsStrip = (h: HtmlBuilder<Message>): Child =>
  h.div(
    [
      h.Class(
        'flex items-center justify-center gap-(--spacing-lg) border-b border-role-hairline py-(--spacing-md)',
      ),
    ],
    [h.span([h.Class('type-caption italic text-role-text-secondary')], ['photo.elianiva.com'])],
  )

const nameplateRow = (h: HtmlBuilder<Message>): Child =>
  h.div(
    [
      h.Class(
        'flex flex-col items-center gap-(--spacing-xs) py-(--spacing-lg) desktop:flex-row desktop:items-center desktop:justify-between desktop:gap-(--spacing-xl) desktop:py-(--spacing-xl)',
      ),
    ],
    [
      h.div(
        [h.Class(`${EAR} text-left`)],
        [
          h.span([h.Class('type-kicker text-role-text-secondary')], ['FROM JAKARTA']),
          h.span(
            [h.Class('type-caption italic text-role-text-primary')],
            ['Street, mostly. Landscape, sometimes.'],
          ),
        ],
      ),
      h.span(
        [h.Class('type-nameplate-sm text-role-text-primary desktop:type-nameplate')],
        ['Elianiva'],
      ),
      h.div(
        [h.Class(`${EAR} text-right`)],
        [
          h.span([h.Class('type-kicker text-role-text-secondary')], ['THE ARCHIVE']),
          h.span(
            [h.Class('type-caption italic text-role-text-primary')],
            ['Jakarta, Istanbul, Tokyo and New York, since 2021.'],
          ),
        ],
      ),
      // The ears' tagline moves under the mobile nameplate; the site name it
      // sat beside is the nameplate itself.
      h.span(
        [h.Class('type-caption italic text-role-text-secondary desktop:hidden')],
        ['Street, mostly. Landscape, sometimes.'],
      ),
    ],
  )

const folio = (h: HtmlBuilder<Message>): Child =>
  h.div(
    [
      h.Class(
        'flex items-center justify-between gap-(--spacing-lg) border-b border-role-rule py-(--spacing-md) desktop:gap-(--spacing-xl)',
      ),
    ],
    [
      h.nav(
        [
          h.AriaLabel('Sections'),
          h.Class('flex items-center gap-(--spacing-lg) desktop:gap-(--spacing-xl)'),
        ],
        [
          // The first link is the page the reader is already on, so it is the
          // one the rule marks.
          ...[
            { label: 'ALL', href: '/#' },
            { label: 'STREET', href: '/street' },
            { label: 'LANDSCAPE', href: '/landscape' },
            { label: 'SERIES', href: '/series' },
            { label: 'ABOUT', href: '/about' },
          ].map((link, index) =>
            NavLink.navLink(
              { href: link.href, label: link.label, state: index === 0 ? 'active' : 'default' },
              h,
            ),
          ),
        ],
      ),
      h.div(
        [h.Class('flex items-center gap-(--spacing-lg) desktop:gap-(--spacing-xl)')],
        [
          // The mobile folio carries the section links and search only, so the
          // feed rides the desktop composition.
          h.nav(
            [h.AriaLabel('Utility'), h.Class('hidden items-center desktop:flex')],
            [NavLink.navLink({ href: '/rss.xml', label: 'RSS', state: 'default' }, h)],
          ),
          h.a(
            [h.Href('/search'), h.AriaLabel('Search')],
            [icon(h, Search, 'size-3.5 text-role-text-primary')],
          ),
        ],
      ),
    ],
  )

export const masthead = (h: HtmlBuilder<Message>): Child =>
  h.header(
    [h.Class('flex flex-col')],
    [
      h.div(
        [h.Class(`${BAND} flex flex-col`)],
        [earsStrip(h), nameplateRow(h), mastheadRules(h), folio(h)],
      ),
    ],
  )
