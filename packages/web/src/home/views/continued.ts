/**
 * Continued: the seam between this edition and the next one — a spinner while
 * the next month loads, an arrow when more pages exist behind it, or the
 * issue's closing marker. Which of the three the data asks for is the only
 * thing that changes.
 */

import { ArrowDown, LoaderCircle } from 'lucide'
import type { HtmlBuilder } from 'foldkit/html'

import { icon } from '@/lib/icons'

import type { Tail } from '../content'
import { Message } from '../model'
import type { Child } from './shared'

const hairline = (h: HtmlBuilder<Message>): Child =>
  h.div([h.Class('h-px flex-1 bg-role-hairline')], [])

const tailBody = (tail: Tail, h: HtmlBuilder<Message>): ReadonlyArray<Child> => {
  switch (tail.state) {
    case 'loading':
      return [
        icon(h, LoaderCircle, 'size-3 animate-spin text-role-text-secondary'),
        h.span([h.Class('type-kicker text-role-text-secondary')], [tail.label]),
      ]
    case 'more':
      return [
        h.a(
          [h.Href('/#archive')],
          [
            icon(h, ArrowDown, 'size-2.5 text-role-text-secondary'),
            h.span([h.Class('type-caption italic text-role-text-secondary')], [tail.label]),
          ],
        ),
      ]
    case 'end':
      return [
        h.span([h.Class('type-exif text-role-text-primary')], [tail.marker]),
        h.span([h.Class('type-caption italic text-role-text-secondary')], [tail.note]),
      ]
  }
}

export const continued = (tail: Tail, h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class('mx-auto flex max-w-[560px] items-center gap-(--spacing-lg) py-(--spacing-xl)')],
    [
      hairline(h),
      h.div([h.Class('flex items-center gap-(--spacing-md)')], tailBody(tail, h)),
      hairline(h),
    ],
  )
