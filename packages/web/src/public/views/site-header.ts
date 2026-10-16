/**
 * Header: the wordmark at the left and, on the home page, a few words of
 * context at the right. There is no nav: the photographs are the structure,
 * and the header only says whose they are.
 *
 * `context` is the home page's own voice and is null on the documents that
 * speak for themselves. `wide` lets the header run the window's full width so
 * the wordmark lines up with the left edge of the full-bleed rows below it;
 * otherwise it caps at the page's content column.
 */

import type { HtmlBuilder } from 'foldkit/html'

import type { Message } from '../model'
import { routeHref } from '../route'
import { BAND, type Child } from './shared'

export const siteHeader = (
  context: string | null,
  wide: boolean,
  /** The home page has no headline of its own, so the wordmark is its `<h1>`.
   *  The other documents carry theirs in the body. */
  heading: boolean,
  h: HtmlBuilder<Message>,
): Child => {
  const wordmark = h.a(
    [
      h.Href(routeHref({ route: 'home' })),
      h.Class(
        'type-wordmark text-role-text-primary transition-opacity duration-120 hover:opacity-70 focus-visible:ring-role-focus/50 outline-none focus-visible:ring-[3px] lg:type-wordmark-lg',
      ),
    ],
    ['Elianiva'],
  )
  return h.header(
    [
      h.Class(
        `${wide ? 'w-full' : BAND} flex flex-col gap-3 pb-5 pt-6 sm:flex-row sm:items-start sm:justify-between sm:gap-10 lg:pb-6 lg:pt-8`,
      ),
    ],
    [
      heading ? h.h1([h.Class('m-0 flex')], [wordmark]) : wordmark,
      ...(context === null
        ? []
        : [h.p([h.Class('type-caption max-w-[340px] text-role-text-primary')], [context])]),
    ],
  )
}
