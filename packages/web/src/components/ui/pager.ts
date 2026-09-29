/**
 * Pager — the design's page footer (master `a107b63a7aff36de`). `1–7 OF 412` in
 * `$typography.exif` and `color.text.disabled`, and two 36px outline Icon
 * Buttons 8px apart. `OF 412` is the total of the *filtered* result set, so the
 * caller passes that, not the table's row count.
 *
 * The design draws the previous button first, and leftwards, for every page
 * including the first — a page that cannot go back has nothing to undo, and
 * hiding the button moves the count under the operator's cursor.
 */
import { ArrowLeft, ArrowRight } from 'lucide'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils'

import { iconButton } from './icon-button'

export type PagerConfig<M> = Readonly<{
  /** First row on this page, 1-based. */
  from: number
  /** Last row on this page, 1-based. */
  to: number
  /** Rows in the whole filtered result set. */
  total: number
  onPrevious?: M
  onNext?: M
  isPreviousDisabled?: boolean
  isNextDisabled?: boolean
  className?: string
}>

const DASH = '–'

/** `1–7 OF 412`, the range on the left and the whole set on the right. */
export const pagerRange = (config: Pick<PagerConfig<never>, 'from' | 'to' | 'total'>): string =>
  `${String(config.from)}${DASH}${String(config.to)} OF ${String(config.total)}`

/** The page range and the two controls that step it. */
export const pager = <M>(config: PagerConfig<M>, h: HtmlBuilder<M>): Html =>
  h.nav(
    [
      h.AriaLabel('Pagination'),
      h.Class(
        cn(
          'flex items-center justify-between gap-(--spacing-lg) py-(--spacing-lg)',
          config.className,
        ),
      ),
      h.DataAttribute('slot', 'pager'),
    ],
    [
      h.span([h.Class('type-exif tabular-nums text-role-text-disabled')], [pagerRange(config)]),
      h.div(
        [h.Class('flex items-center gap-(--spacing-sm)')],
        [
          iconButton(
            {
              ariaLabel: 'Previous page',
              kind: 'outline',
              ...(config.onPrevious !== undefined && { onClick: config.onPrevious }),
              ...(config.isPreviousDisabled === true && { isDisabled: true }),
            },
            ArrowLeft,
            h,
          ),
          iconButton(
            {
              ariaLabel: 'Next page',
              kind: 'outline',
              ...(config.onNext !== undefined && { onClick: config.onNext }),
              ...(config.isNextDisabled === true && { isDisabled: true }),
            },
            ArrowRight,
            h,
          ),
        ],
      ),
    ],
  )
