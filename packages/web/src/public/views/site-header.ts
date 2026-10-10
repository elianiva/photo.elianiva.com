/**
 * Header: the wordmark and the Nav, printed at the top of every public
 * document. The larger wordmark gives the site a clear entry point, and the
 * bottom rule separates its navigation from the document below it.
 *
 * The page is a sheet of film proofs, and a proof sheet does not open with a
 * site's banner: the photographs are the structure and the header only
 * says whose they are. The nameplate this replaced (a flag line, a 112px name
 * between flanking hairlines, two rule sandwiches and a red fold) spent the
 * whole first screen on furniture before a single frame.
 *
 * ## The Nav
 *
 * The nav's own links are written lowercase and rendered uppercase by one
 * `uppercase` on the nav, because the middle is not authored at all: a Tag is
 * created, renamed and deleted in the Admin, and it is typed however its author
 * typed it. One mechanism means renaming a Tag behaves the same as renaming
 * anything else.
 *
 * A site's Nav is therefore whatever its Tags say it is, and a site with no
 * Tag on a published photograph prints `all` and `about` with nothing between
 * them, which is a real state rather than a broken nav. The Nav **wraps**
 * rather than scrolls: every Tag stays visible with no hidden overflow and no
 * script.
 *
 * `current` is the Nav's own `href` for that document — `routeHref` in
 * `../route` — so which link is marked is read off the route table rather than
 * off a position in this list. The wordmark is a link to the home page but is not
 * itself marked current: that mark belongs to the Nav's `all`.
 */

import type { HtmlBuilder } from 'foldkit/html'

import * as NavLink from '@/components/ui/nav-link'

import type { NavEntry } from '../content'
import type { Message } from '../model'
import { routeHref, tagPath } from '../route'
import { BAND, type Child } from './shared'

const navLinks = (
  nav: ReadonlyArray<NavEntry>,
): ReadonlyArray<{ readonly label: string; readonly href: string }> => [
  { label: 'all', href: routeHref({ route: 'home' }) },
  ...nav.map((entry) => ({ label: entry.label, href: tagPath(entry.slug) })),
  { label: 'about', href: routeHref({ route: 'about' }) },
]

export const siteHeader = (
  current: string,
  entries: ReadonlyArray<NavEntry>,
  h: HtmlBuilder<Message>,
): Child =>
  h.header(
    [
      h.Class(
        `${BAND} flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b border-role-hairline pb-4 pt-6 lg:gap-x-12 lg:pb-5 lg:pt-8`,
      ),
    ],
    [
      h.a(
        [
          h.Href(routeHref({ route: 'home' })),
          h.Class(
            'type-wordmark text-role-text-primary transition-opacity duration-120 hover:opacity-70 focus-visible:ring-role-focus/50 outline-none focus-visible:ring-[3px] lg:type-wordmark-lg',
          ),
        ],
        ['Elianiva'],
      ),
      h.nav(
        [
          h.AriaLabel('Sections'),
          h.Class('flex flex-wrap items-center gap-x-5 gap-y-1 uppercase lg:gap-x-6'),
        ],
        // The link the reader is on is the one the rule marks, so the mark is
        // the document's own href rather than a position in this list.
        navLinks(entries).map((link) =>
          NavLink.navLink(
            {
              href: link.href,
              label: link.label,
              state: link.href === current ? 'active' : 'default',
              className: 'px-0.5',
            },
            h,
          ),
        ),
      ),
    ],
  )
