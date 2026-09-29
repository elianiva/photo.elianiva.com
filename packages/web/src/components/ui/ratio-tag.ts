/**
 * Ratio Tag — the design's boxed Ratio (master `6f207a44edbfb342`). A 1px
 * `color.outline` box around 4/8 of padding, no fill and no corner radius,
 * holding one `$typography.exif` label in `color.text.secondary`.
 *
 * It is the vendored `Badge` box read in the Ratio Tag's colour pair, so the
 * tag and the Badge a Photo's Tags wear stay the same geometry.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils'

import { badgeClass } from './badge'

export type RatioTagConfig = Readonly<{
  /** A Photo's Ratio. The six-value union lands with the Photo service, so
   *  this atom takes the value it is given rather than declaring a second
   *  Ratio (CONTEXT.md, Ratio). */
  ratio: string
  className?: string
}>

/** A Photo's Ratio, boxed. */
export const ratioTag = <M>(config: RatioTagConfig, h: HtmlBuilder<M>): Html =>
  h.span(
    [
      h.Class(
        cn(badgeClass, 'w-fit border-role-outline text-role-text-secondary', config.className),
      ),
      h.DataAttribute('slot', 'ratio-tag'),
    ],
    [config.ratio],
  )
