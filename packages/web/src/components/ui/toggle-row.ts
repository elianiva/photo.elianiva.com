/**
 * Toggle Row — a label and the design's Toggle (master `4f1560a618c27a91`): one
 * line, label left, 34×20 pill right (the switch's DOM order is reversed to get there), `$typography.ui` in `color.text.secondary`
 * and no box of its own. Used by Upload Options, Editor Export and Settings.
 *
 * It is the vendored `switch` laid out as a row, so the label is the switch's
 * own label: one control, one accessible name, no second text node to keep in
 * step. The design's desktop row is 28px tall, 8px of padding and a gap of 8.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils'

import { switch_ } from './switch'

/** The switch is the wrapper's first child, so `flex-row-reverse` is what puts
 *  the label on the left and the pill on the right. */
export const toggleRowClass = 'flex flex-row-reverse items-center justify-between gap-4 py-1'

export type ToggleRowConfig<M> = Readonly<{
  id: string
  label: string
  /** A sentence under the label saying what the switch does. */
  description?: string
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
      ...(config.description !== undefined && { description: config.description }),
      ...(config.isDisabled === true && { isDisabled: true }),
      wrapperClass: cn(toggleRowClass, 'w-full', config.className),
      labelClass: 'type-ui text-role-text-secondary',
    },
    h,
  )
