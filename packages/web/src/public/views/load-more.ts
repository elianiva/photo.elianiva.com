/**
 * Load-more: the seam between this month's photographs and the next one — a
 * button that asks for the next month, showing a spinner while that read is in
 * flight, or the closing marker once there is nothing older.
 *
 * The row words its own three states, because the state is all the Timeline
 * carries: what the reader is told depends on what is left, and the sentences
 * belong beside the markup that prints them.
 *
 * All three states are set in the label, the Header's furniture voice, and
 * none of them is two lines. They used to be a `type-exif` label in IBM Plex
 * Mono carrying `END OF THE ARCHIVE` beside a `type-caption` italic sentence
 * carrying `That is every photograph.` — two unrelated faces at two sizes, the
 * smaller one holding the headline of the pair, saying one thing twice. The
 * seam wants a word, not a caption.
 */

import { ArrowDown, LoaderCircle } from 'lucide'
import { Option } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'

import { icon } from '@/lib/icons'

import type { Tail } from '../content'
import { Message } from '../model'
import type { Child } from './shared'

const hairline = (h: HtmlBuilder<Message>): Child =>
  h.div([h.Class('h-px flex-1 bg-role-hairline')], [])

const tailBody = (
  tail: Tail,
  loading: boolean,
  error: string | null,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Child> => {
  switch (tail) {
    // A read in flight answers to the same row, so a second click cannot start a
    // second read of the same month.
    case 'more':
      return [
        h.button(
          [
            h.Class(
              'inline-flex cursor-pointer items-center gap-2 bg-transparent disabled:cursor-progress',
            ),
            h.OnClick(Message.LoadOlderMonths()),
            h.OnKeyDownPreventDefault((key) =>
              key === 'Enter' || key === ' '
                ? Option.some(Message.LoadOlderMonths())
                : Option.none(),
            ),
            h.Disabled(loading),
            h.AriaLabel('Load more photographs'),
          ],
          [
            loading
              ? icon(h, LoaderCircle, 'size-2.5 animate-spin text-role-text-secondary')
              : icon(h, ArrowDown, 'size-2.5 text-role-text-secondary'),
            h.span(
              [h.Class('type-label text-role-text-secondary uppercase')],
              [loading ? 'loading' : 'load more'],
            ),
          ],
        ),
        // A failed read says so. The Months already on the page are still
        // true, so the row offers the load again rather than ending the run.
        ...(error === null
          ? []
          : [h.span([h.Class('type-caption italic text-role-text-disabled')], [error])]),
      ]
    case 'end':
      return [
        h.span([h.Class('type-label text-role-text-secondary uppercase')], ['that is all of them']),
      ]
    case 'empty':
      return [
        h.span([h.Class('type-label text-role-text-secondary uppercase')], ['nothing here yet']),
      ]
  }
}

export const loadMore = (
  tail: Tail,
  loading: boolean,
  error: string | null,
  h: HtmlBuilder<Message>,
): Child =>
  h.div(
    [h.Class('mx-auto flex max-w-[560px] items-center gap-4 py-6')],
    [
      hairline(h),
      h.div([h.Class('flex items-center gap-3')], tailBody(tail, loading, error, h)),
      hairline(h),
    ],
  )
