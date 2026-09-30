/**
 * Masthead: the broadsheet's front. Volume, site name and date sit in a strip
 * over the nameplate; the ears carry the tagline and the archive line; the
 * folio below the rule stack is the only navigation on the page.
 *
 * The mobile Masthead master (size=mobile) drops the ears and the site name
 * from the strip, centres the short nameplate over the tagline, and keeps only
 * the section links and search in the folio — so the 112px nameplate never has
 * to fit a narrow measure, and the three-part ears strip becomes a two-part
 * one. The ears' fixed 260px boxes and the 112px nameplate are what put the
 * flip at `desktop`: below it the desktop composition cannot fit.
 */

import { Search } from 'lucide'
import type { HtmlBuilder } from 'foldkit/html'

import * as NavLink from '@/components/ui/nav-link'

import { icon } from '@/lib/icons'

import { mastheadCount, type Edition } from '../content'
import { Message } from '../model'
import { mastheadRules } from './rules'
import { BAND, type Child } from './shared'

/** The two boxes flanking the desktop nameplate: same box, mirrored alignment. */
const EAR =
  'hidden w-[260px] shrink-0 flex-col gap-(--spacing-xs) px-(--spacing-md) py-(--spacing-sm) desktop:flex'

const earsStrip = (edition: Edition, h: HtmlBuilder<Message>): Child =>
  h.div(
    [
      h.Class(
        'flex items-center justify-between gap-(--spacing-lg) border-b border-role-hairline py-(--spacing-md) desktop:grid desktop:grid-cols-3',
      ),
    ],
    [
      // Mobile has no room for the volume numeral; desktop's three equal tracks
      // keep the site name centred on the nameplate below.
      h.span(
        [h.Class('type-kicker text-left text-role-text-secondary')],
        [
          h.span([h.Class('desktop:hidden')], [mastheadCount(edition).volumeMobile]),
          h.span([h.Class('hidden desktop:inline')], [mastheadCount(edition).volume]),
        ],
      ),
      h.span(
        [
          h.Class(
            'hidden type-caption italic text-role-text-secondary desktop:block desktop:text-center',
          ),
        ],
        [edition.motto],
      ),
      h.span(
        [h.Class('type-kicker text-right text-role-text-secondary')],
        [
          h.span([h.Class('desktop:hidden')], [edition.folioDateMobile]),
          h.span([h.Class('hidden desktop:inline')], [edition.folioDate]),
        ],
      ),
    ],
  )

const nameplateRow = (edition: Edition, h: HtmlBuilder<Message>): Child =>
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
          h.span([h.Class('type-kicker text-role-text-secondary')], [edition.origin]),
          h.span([h.Class('type-caption italic text-role-text-primary')], [edition.tagline]),
        ],
      ),
      h.span(
        [h.Class('type-nameplate-sm text-role-text-primary desktop:type-nameplate')],
        ['Elianiva'],
      ),
      h.div(
        [h.Class(`${EAR} text-right`)],
        [
          h.span([h.Class('type-kicker text-role-text-secondary')], [edition.archiveLabel]),
          h.span([h.Class('type-caption italic text-role-text-primary')], [edition.archiveLine]),
        ],
      ),
      // The ears' tagline moves under the mobile nameplate; the site name it
      // sat beside is the nameplate itself.
      h.span(
        [h.Class('type-caption italic text-role-text-secondary desktop:hidden')],
        [edition.tagline],
      ),
    ],
  )

const folio = (edition: Edition, h: HtmlBuilder<Message>): Child =>
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
          ...edition.folio.sections.map((link, index) =>
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
          // The frame count and RSS ride the desktop folio only.
          h.nav(
            [
              h.AriaLabel('Utility'),
              h.Class('hidden items-center gap-(--spacing-xl) desktop:flex'),
            ],
            [
              h.span(
                [h.Class('type-exif text-role-text-disabled')],
                [`${mastheadCount(edition).issue} FRAMES`],
              ),
              NavLink.navLink({ href: edition.folio.rssHref, label: 'RSS', state: 'default' }, h),
            ],
          ),
          h.a(
            [h.Href(edition.folio.searchHref), h.AriaLabel('Search')],
            [icon(h, Search, 'size-3.5 text-role-text-primary')],
          ),
        ],
      ),
    ],
  )

export const masthead = (edition: Edition, h: HtmlBuilder<Message>): Child =>
  h.header(
    [h.Class('flex flex-col')],
    [
      h.div(
        [h.Class(`${BAND} flex flex-col`)],
        [earsStrip(edition, h), nameplateRow(edition, h), mastheadRules(h), folio(edition, h)],
      ),
    ],
  )
