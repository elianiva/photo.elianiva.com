/**
 * Select — the Desk's dropdown (the canvas's `Select` master): a kicker label
 * over a 36px box with 8px of vertical padding, a 1px `color.outline` bottom
 * rule, the value in `$typography.exif` reading `color.text.primary`, and a 14px
 * caret in `color.text.secondary`. No box of its own and no corner radius.
 *
 * A native `<select>`, and the reason is the Settings page's `SECTIONS`
 * repeater: a row's `kind` is a Select, and the number of rows is authored, so
 * a control that owns its state would need one submodel per row and there is no
 * fixed set of them to declare. The native element takes the popup, the
 * keyboard, the mobile wheel and the value semantics for free, and the value
 * itself lives in the page's own draft — which is where a `Segment` group id
 * would otherwise have gone.
 *
 * The caret rides the combobox atom's caret box rather than a second one: it is
 * the same 14px chevron in the same place, and there is one class for it.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'
import { ChevronDown } from 'lucide'

import { icon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { comboboxButtonClass } from './combobox'

export const selectLabelClass = 'type-kicker text-role-text-secondary'

/** `-webkit-appearance` is spelled out because the built CSS has to carry it:
 *  `appearance-none` emits the standard property alone, and a Safari that
 *  honours only its own prefix draws the native arrow on top of the design's
 *  caret — two carets, silently. */
export const selectBoxClass =
  'focus-visible:border-role-rule disabled:text-role-text-disabled h-9 w-full min-w-0 appearance-none border-0 border-b border-role-outline bg-transparent py-(--spacing-sm) pr-(--spacing-xl) type-exif text-role-text-primary outline-none transition-colors duration-(--motion-duration-fast) disabled:cursor-not-allowed [-webkit-appearance:none]'

export type SelectOption = Readonly<{
  /** What the page acts on — a rendition format, a section kind, a byte count. */
  value: string
  /** What the option prints, in the same `$typography.exif` the box reads. */
  label: string
}>

export type SelectConfig<M> = Readonly<{
  id: string
  label: string
  value: string
  options: ReadonlyArray<SelectOption>
  onChange: (value: string) => M
  isDisabled?: boolean
  className?: string
}>

/** One dropdown. The label is the select's own label, so the control has one
 *  accessible name rather than a label and a value to keep in step. */
export const select = <M>(config: SelectConfig<M>, h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Class(cn('flex w-full flex-col gap-(--spacing-sm)', config.className))],
    [
      h.label([h.For(config.id), h.Class(selectLabelClass)], [config.label]),
      h.div(
        [h.Class('relative w-full')],
        [
          h.select(
            [
              h.Id(config.id),
              h.Value(config.value),
              h.OnChange(config.onChange),
              ...(config.isDisabled === true ? [h.Disabled(true)] : []),
              h.Class(selectBoxClass),
              h.DataAttribute('slot', 'select'),
            ],
            config.options.map((option) =>
              h.option(
                [h.Value(option.value), h.Selected(option.value === config.value)],
                [option.label],
              ),
            ),
          ),
          h.span(
            [h.AriaHidden(true), h.Class(cn(comboboxButtonClass, 'pointer-events-none'))],
            [icon(h, ChevronDown, 'size-3.5')],
          ),
        ],
      ),
    ],
  )
