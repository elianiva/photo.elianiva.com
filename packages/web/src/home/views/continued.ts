/**
 * Continued: the seam between this edition and the next one — a button that
 * asks for the next month, showing a spinner while that read is in flight, or
 * the issue's closing marker once there is nothing older.
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
  switch (tail.state) {
    // A read in flight answers to the same row, so a second click cannot start
    // a second read of the same month.
    case 'more':
      return [
        h.button(
          [
            h.Class(
              'inline-flex cursor-pointer items-center gap-(--spacing-sm) bg-transparent disabled:cursor-progress',
            ),
            h.OnClick(Message.LoadOlderSections()),
            h.OnKeyDownPreventDefault((key) =>
              key === 'Enter' || key === ' '
                ? Option.some(Message.LoadOlderSections())
                : Option.none(),
            ),
            h.Disabled(loading),
            h.AriaLabel('Load the earlier editions'),
          ],
          [
            loading
              ? icon(h, LoaderCircle, 'size-2.5 animate-spin text-role-text-secondary')
              : icon(h, ArrowDown, 'size-2.5 text-role-text-secondary'),
            h.span(
              [h.Class('type-caption italic text-role-text-secondary')],
              [loading ? 'LOADING' : tail.label],
            ),
          ],
        ),
        // A failed read says so. The Sections already on the page are still
        // true, so the row offers the load again rather than ending the issue.
        ...(error === null
          ? []
          : [h.span([h.Class('type-caption italic text-role-text-disabled')], [error])]),
      ]
    case 'end':
      return [
        h.span([h.Class('type-exif text-role-text-primary')], [tail.marker]),
        h.span([h.Class('type-caption italic text-role-text-secondary')], [tail.note]),
      ]
  }
}

export const continued = (
  tail: Tail,
  loading: boolean,
  error: string | null,
  h: HtmlBuilder<Message>,
): Child =>
  h.div(
    [h.Class('mx-auto flex max-w-[560px] items-center gap-(--spacing-lg) py-(--spacing-xl)')],
    [
      hairline(h),
      h.div(
        [h.Class('flex items-center gap-(--spacing-md)')],
        tailBody(tail, loading, error, h),
      ),
      hairline(h),
    ],
  )
