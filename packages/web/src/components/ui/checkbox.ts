/**
 * Checkbox, broadsheet edition. Vendored from the `@foldcn` registry and
 * re-cut to the design's `Checkbox` (master `74f6c9993ee394f4`):
 *
 *   off    16px square, 1px `color.outline` box, no fill, no corner radius
 *   on     the same box filled `color.primary`, a 12px `color.on-primary` check
 *   mixed  as `on`, with a bar instead of the check
 *
 * The Desk has no rounded control, so the registry's `rounded-[4px]` is gone.
 * Every colour is a `role-*` token, so the box follows the theme scope with no
 * `dark:` variant: the dark branch of each role is the mirror the generator
 * already emits.
 *
 * foldkit delta: it emits `aria-disabled`/`data-disabled` rather than native
 * `disabled`, and `data-checked` / `data-indeterminate` for state.
 */
import { Checkbox as FoldkitCheckbox } from '@foldkit/ui'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Check, Minus } from 'lucide'

import { icon } from '@/lib/icons'
import { cn } from '@/lib/utils'

export const checkboxClass =
  'aria-invalid:border-role-error aria-invalid:ring-role-error/20 data-checked:border-role-primary data-checked:bg-role-primary data-checked:text-role-on-primary data-disabled:cursor-not-allowed data-disabled:opacity-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-role-focus focus-visible:ring-[3px] focus-visible:ring-role-focus/50 outline-none size-4 shrink-0 border border-role-outline bg-transparent text-role-on-primary transition-colors duration-120'

export const checkboxIndicatorClass = '[&>svg]:size-3 grid place-content-center transition-none'

export type CheckboxConfig<M> = Readonly<{
  id: string
  isChecked: boolean
  onToggle: (isChecked: boolean) => M
  /** Accessible name. Rendered visually hidden when `labelClass` is `sr-only`
   *  — the Desk's table rows name the Photo, not the column. */
  label: string
  isDisabled?: boolean
  isReadOnly?: boolean
  isIndeterminate?: boolean
  name?: string
  value?: string
  className?: string
  labelClass?: string
  wrapperClass?: string
}>

/** Styled checkbox with label, built on the @foldkit/ui Checkbox helper. */
export const checkbox = <M>(config: CheckboxConfig<M>, h: HtmlBuilder<M>): Html =>
  FoldkitCheckbox.view<M>(
    {
      id: config.id,
      isChecked: config.isChecked,
      onToggle: config.onToggle,
      ...(config.isIndeterminate !== undefined && { isIndeterminate: config.isIndeterminate }),
      ...(config.isDisabled !== undefined && { isDisabled: config.isDisabled }),
      ...(config.isReadOnly !== undefined && { isReadOnly: config.isReadOnly }),
      ...(config.name !== undefined && { name: config.name }),
      ...(config.value !== undefined && { value: config.value }),
      toView: (attributes) =>
        h.div(
          [h.Class(cn('flex flex-col', config.wrapperClass))],
          [
            h.div(
              [h.Class('flex items-center gap-2')],
              [
                h.button(
                  [
                    ...attributes.checkbox,
                    h.DataAttribute('slot', 'checkbox'),
                    h.Class(cn(checkboxClass, config.className)),
                  ],
                  config.isChecked || config.isIndeterminate === true
                    ? [
                        h.span(
                          [
                            h.DataAttribute('slot', 'checkbox-indicator'),
                            h.Class(checkboxIndicatorClass),
                          ],
                          [icon(h, config.isIndeterminate === true ? Minus : Check, 'size-3')],
                        ),
                      ]
                    : [],
                ),
                ...(attributes.hiddenInput.length > 0
                  ? [h.input([...attributes.hiddenInput])]
                  : []),
                h.label(
                  [
                    ...attributes.label,
                    h.DataAttribute('slot', 'label'),
                    h.Class(cn('type-ui select-none', config.labelClass)),
                  ],
                  [config.label],
                ),
              ],
            ),
          ],
        ),
    },
    h,
  )
