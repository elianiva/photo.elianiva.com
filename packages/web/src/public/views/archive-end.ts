/**
 * The archive's invisible scroll sentinel and the only feedback needed while
 * the next batch arrives or after a failed read. There is no pager: scrolling
 * naturally reaches the sentinel, and the subscription prefetches before it
 * enters the viewport.
 */

import type { HtmlBuilder } from 'foldkit/html'

import type { Tail } from '../content'
import type { Message } from '../model'
import type { Child } from './shared'

export const archiveEnd = (
  tail: Tail,
  loading: boolean,
  error: string | null,
  h: HtmlBuilder<Message>,
): Child =>
  h.div(
    [h.Id('archive'), h.Class('mx-auto min-h-1 w-full max-w-[1080px]')],
    loading
      ? [
          h.p(
            [h.Class('sr-only'), h.Attribute('role', 'status'), h.AriaLive('polite')],
            ['Loading more photographs'],
          ),
        ]
      : error !== null && tail === 'more'
        ? [
            h.p(
              [
                h.Class('type-caption py-4 text-center text-role-text-secondary'),
                h.Attribute('role', 'alert'),
              ],
              ['Could not load more photographs. Scroll to try again.'],
            ),
          ]
        : [],
  )
