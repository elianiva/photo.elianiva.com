/**
 * Masthead: the broadsheet's front. Volume, site name and date sit in a strip
 * over the nameplate; the ears carry the tagline and the archive line; the
 * folio below the rule stack is the only navigation on the page.
 */

import { Search } from 'lucide'
import type { HtmlBuilder } from 'foldkit/html'

import { icon } from '@/lib/icons'

import type { Edition } from '../content'
import { Message } from '../model'
import { navLink } from './nav-link'
import { ruleStack } from './rules'
import { BAND, type Child } from './shared'

/** The two boxes flanking the nameplate: same box, mirrored alignment. */
const EAR =
  'flex w-[260px] shrink-0 flex-col gap-(--spacing-xs) px-(--spacing-md) py-(--spacing-sm)'

const earsStrip = (edition: Edition, h: HtmlBuilder<Message>): Child =>
  h.div(
    [
      h.Class(
        'grid grid-cols-3 items-center gap-(--spacing-lg) border-b border-role-hairline py-(--spacing-md)',
      ),
    ],
    [
      // Three equal tracks, so the middle line centres on the nameplate below
      // rather than on the gap left by the widest ear.
      h.div(
        [h.Class('text-left')],
        [h.span([h.Class('type-kicker text-role-text-secondary')], [edition.volume])],
      ),
      h.div(
        [h.Class('text-center')],
        [h.span([h.Class('type-caption italic text-role-text-secondary')], [edition.motto])],
      ),
      h.div(
        [h.Class('text-right')],
        [h.span([h.Class('type-kicker text-role-text-secondary')], [edition.folioDate])],
      ),
    ],
  )

const nameplateRow = (edition: Edition, h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class('flex items-center justify-between gap-(--spacing-xl) py-(--spacing-xl)')],
    [
      h.div(
        [h.Class(`${EAR} text-left`)],
        [
          h.span([h.Class('type-kicker text-role-text-secondary')], [edition.origin]),
          h.span([h.Class('type-caption italic text-role-text-primary')], [edition.tagline]),
        ],
      ),
      h.span([h.Class('type-nameplate text-role-text-primary')], ['Elianiva']),
      h.div(
        [h.Class(`${EAR} text-right`)],
        [
          h.span([h.Class('type-kicker text-role-text-secondary')], [edition.archiveLabel]),
          h.span([h.Class('type-caption italic text-role-text-primary')], [edition.archiveLine]),
        ],
      ),
    ],
  )

const folio = (edition: Edition, h: HtmlBuilder<Message>): Child =>
  h.div(
    [
      h.Class(
        'flex items-center justify-between gap-(--spacing-xl) border-t border-role-rule pt-(--spacing-md)',
      ),
    ],
    [
      h.nav(
        [h.AriaLabel('Sections'), h.Class('flex items-center gap-(--spacing-xl)')],
        [
          // The first link is the page the reader is already on, so it is the
          // one the rule marks.
          ...edition.folio.sections.map((link, index) =>
            navLink(link.label, link.href, index === 0 ? 'active' : 'default', h),
          ),
        ],
      ),
      h.nav(
        [h.AriaLabel('Utility'), h.Class('flex items-center gap-(--spacing-xl)')],
        [
          h.span([h.Class('type-exif text-role-text-disabled')], [`${edition.issue} FRAMES`]),
          navLink('RSS', edition.folio.rssHref, 'default', h),
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
        [earsStrip(edition, h), nameplateRow(edition, h), ruleStack(h), folio(edition, h)],
      ),
    ],
  )
