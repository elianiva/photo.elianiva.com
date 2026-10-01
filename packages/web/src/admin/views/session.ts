/**
 * Session expired — the whole Admin, replaced.
 *
 * There is no signed-out state in this app: Cloudflare Access gates `/admin*`
 * before any of it runs (ADR 0003), and nothing here asks for or accepts a
 * password. So when `GetSession` cannot be answered, the only true statement
 * the UI can make is that the session is not proven, and the only useful thing
 * it can offer is the way back through Access.
 *
 * The way back is a *navigation to the Admin's own URL*, and that is the whole
 * mechanism: Access evaluates a request at the edge, before the Worker runs, so
 * the request that starts a login is a document request for the protected path
 * itself. Nothing inside a page that has already loaded can start one.
 *
 * It is deliberately not a `/cdn-cgi/access/login` link. That path is served by
 * the Access edge on the *team* domain (`<team>.cloudflareaccess.com`), and it
 * is not an endpoint of the site's own origin: a browser sent there where no
 * Access edge fronts the zone — `localhost` in development — gets a bare 404,
 * and the same 404 is what an operator lands on when a login hands them back to
 * the app's own hostname. On the stage where the gate stands down there is no
 * Access to log into at all, and the same navigation is still the right answer
 * for a different reason: it re-runs the reads.
 */

import type { Document, HtmlBuilder } from 'foldkit/html'

import type { Msg } from '../model'
import { appRouteToUrl, type AppRoute } from '../route'
import type { Child } from './shared'

const signInLink = (h: HtmlBuilder<Msg>, route: AppRoute): Child =>
  h.a(
    [
      // The route the operator was on, so Access brings them back to the page
      // they were working in rather than to the Library.
      h.Href(appRouteToUrl(route)),
      h.Class(
        'focus-visible:ring-role-focus/50 bg-role-primary focus-visible:ring-[3px] text-role-on-primary inline-flex h-9 items-center border border-transparent px-4 type-ui transition-colors duration-120 outline-none',
      ),
      h.DataAttribute('slot', 'button'),
    ],
    ['Sign in again'],
  )

export const sessionExpired = (h: HtmlBuilder<Msg>, route: AppRoute): Document => ({
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
            'mx-auto flex min-h-dvh w-full max-w-[1080px] flex-col justify-center gap-4 px-4 sm:px-12',
          ),
        ],
        [
          h.span([h.Class('type-kicker text-role-text-secondary')], ['THE DESK']),
          h.h1([h.Class('type-headline text-role-text-primary')], ['Session expired']),
          h.p(
            [h.Class('type-deck max-w-prose text-role-text-secondary')],
            [
              'The Cloudflare Access session behind the admin has ended. Sign in again to carry on.',
            ],
          ),
          h.div([h.Class('flex')], [signInLink(h, route)]),
        ],
      ),
    ],
  ),
})
