/**
 * Nav Link — the design's tab and section marker (master `46af82088f07a2de`).
 * A `$typography.kicker` label with 4px above and below and a 1.5px
 * `color.rule` underline: transparent when the link is not the current one, so
 * the current section is marked by a rule and not by colour alone.
 *
 * The Editor's `EDIT` / `DETAILS` tabs and the Colophon's sections are the same
 * link; `href` makes it a link, and the runtime intercepts it.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils'

export const navLinkStateKeys = ['active', 'default'] as const
export type NavLinkState = (typeof navLinkStateKeys)[number]

export const navLinkBaseClass =
  'focus-visible:ring-role-focus/50 inline-block border-b-[1.5px] px-0 py-1 type-kicker transition-colors duration-120 outline-none focus-visible:ring-[3px]'

export const navLinkStateClasses: Record<NavLinkState, string> = {
  active: 'border-role-rule text-role-text-primary',
  default:
    'border-transparent text-role-text-secondary hover:border-role-rule hover:text-role-text-primary',
}

export type NavLinkConfig = Readonly<{
  href: string
  label: string
  state: NavLinkState
  className?: string
}>

/** One nav link, marked current or not. */
export const navLink = <M>(config: NavLinkConfig, h: HtmlBuilder<M>): Html =>
  h.a(
    [
      h.Href(config.href),
      ...(config.state === 'active' ? [h.AriaCurrent('page')] : []),
      h.Class(cn(navLinkBaseClass, navLinkStateClasses[config.state], config.className)),
      h.DataAttribute('slot', 'nav-link'),
      h.DataAttribute('state', config.state),
    ],
    [config.label],
  )
