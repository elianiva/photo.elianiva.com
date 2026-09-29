/**
 * Spec Row — the design's label-left, value-right row (master
 * `7d93b9a0052154a9`). 12px of gap between them, 8px of vertical padding, and
 * a 1px `color.hairline` rule under the pair. The label is a
 * `$typography.kicker` in `color.text.disabled`; the value is `$typography.exif`
 * in `color.text.primary`, ranged right.
 *
 * The row carries `dt` / `dd`, so it goes inside a `<dl>` — the design groups
 * these rows under a panel head (`SIZES`, and the Photo page's own facts), and
 * a label/value pair is a description list.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils'

export const specRowClass =
  'flex items-center justify-between gap-(--spacing-md) border-b border-role-hairline py-(--spacing-sm)'

export type SpecRowConfig = Readonly<{
  label: string
  value: string
  className?: string
}>

/** One label/value pair. Place inside a `<dl>`. */
export const specRow = <M>(config: SpecRowConfig, h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Class(cn(specRowClass, config.className)), h.DataAttribute('slot', 'spec-row')],
    [
      h.dt([h.Class('type-kicker text-role-text-disabled')], [config.label]),
      h.dd([h.Class('type-exif text-right text-role-text-primary tabular-nums')], [config.value]),
    ],
  )
