/**
 * Session expired — the whole Admin, replaced.
 *
 * There is no signed-out state in this app: Cloudflare Access gates
 * `/admin*` before any of it runs (ADR 0007), and nothing here asks for or
 * accepts a password. So when `GetSession` cannot be answered, the only true
 * statement the UI can make is that the session is not proven, and the only
 * useful thing it can offer is the way back through Access.
 *
 * The link is a same-origin `/cdn-cgi/access/login`. The Access team domain is
 * a server binding this document never sees — and on the stage where the gate
 * stands down there is no team domain to name — so the one URL that is
 * available from inside the page is the one Cloudflare serves for the zone the
 * Admin is on.
 */

import type { Document, HtmlBuilder } from 'foldkit/html'

import type { Msg } from '../model'
import type { Child } from './shared'

/** Where Cloudflare Access takes a session that has ended. Same-origin, so it
 *  works on every stage including the one with no Access edge at all. */
export const ACCESS_LOGIN_PATH = '/cdn-cgi/access/login'

const signInLink = (h: HtmlBuilder<Msg>): Child =>
  h.a(
    [
      h.Href(ACCESS_LOGIN_PATH),
      h.Class(
        'focus-visible:ring-role-focus/50 bg-role-primary focus-visible:ring-[3px] text-role-on-primary inline-flex h-9 items-center border border-transparent px-(--spacing-lg) type-ui transition-colors duration-(--motion-duration-fast) outline-none',
      ),
      h.DataAttribute('slot', 'button'),
    ],
    ['Sign in again'],
  )

export const sessionExpired = (h: HtmlBuilder<Msg>): Document => ({
  title: 'Session expired — Admin',
  body: h.div(
    [
      h.Class('bg-role-surface min-h-dvh text-role-text-primary'),
      h.DataAttribute('slot', 'session-expired'),
    ],
    [
      h.div(
        [
          h.Class(
            'mx-auto flex min-h-dvh w-full max-w-(--layout-content-max) flex-col justify-center gap-(--spacing-lg) px-(--layout-margin-mobile) sm:px-(--layout-margin)',
          ),
        ],
        [
          h.span([h.Class('type-kicker text-role-text-secondary')], ['THE DESK']),
          h.h1([h.Class('type-headline text-role-text-primary')], ['Session expired']),
          h.p(
            [h.Class('type-deck max-w-prose text-role-text-secondary')],
            [
              'The Cloudflare Access session behind the Admin has ended. Sign in again to carry on.',
            ],
          ),
          h.div([h.Class('flex')], [signInLink(h)]),
        ],
      ),
    ],
  ),
})
