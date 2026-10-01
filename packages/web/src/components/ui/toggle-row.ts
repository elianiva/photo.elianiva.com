/**
 * Toggle Row — a label and the design's Toggle (master `4f1560a618c27a91`): one
 * line, label left, 34×20 pill right, `$typography.ui` in `color.text.secondary`
 * and no box of its own. Used by Upload Options, Editor Export and Settings.
 *
 * It is the vendored `switch` laid out as a row, so the label is the switch's
 * own label: one control, one accessible name, no second text node to keep in
 * step. The design's desktop row is 28px tall, 8px of padding and a gap of 8.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils'

import { switch_ } from './switch'

export const toggleRowClass = 'flex items-center justify-between gap-2 py-1'

export type ToggleRowConfig<M> = Readonly<{
  id: string
  label: string
  isChecked: boolean
  onToggle: (isChecked: boolean) => M
  isDisabled?: boolean
  className?: string
}>

/** A label and the Toggle that flips it. */
export const toggleRow = <M>(config: ToggleRowConfig<M>, h: HtmlBuilder<M>): Html =>
  switch_(
    {
      id: config.id,
      isChecked: config.isChecked,
      onToggle: config.onToggle,
      label: config.label,
      ...(config.isDisabled === true && { isDisabled: true }),
      wrapperClass: cn(toggleRowClass, 'w-full', config.className),
      labelClass: 'type-ui text-role-text-secondary',
    },
    h,
  )
