/**
 * Field, broadsheet edition. The design's `Field` is a kicker label over an
 * underlined box:
 *
 *   label    `$typography.kicker` in `color.text.secondary`, lifting to
 *            `color.text.primary` while the box is focused
 *   box      8px of vertical padding on a 1px `color.outline` bottom rule,
 *            thickening to 1.5px of `color.rule` on focus, no fill, no radius
 *   value    `$typography.body` — the Field's value is prose (a title, a place,
 *            a slug), which is what the design's `Field` master
 *            (`cb46079a5eae06e4`) and its call sites set. `textarea` is the
 *            same rule on a box that grows with its content.
 */
import { Input as FoldkitInput } from '@foldkit/ui'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils'

export const inputClass =
  'placeholder:text-role-text-disabled focus-visible:border-role-rule focus-visible:ring-0 aria-invalid:border-role-error disabled:border-role-hairline disabled:text-role-text-disabled data-disabled:border-role-hairline data-disabled:text-role-text-disabled h-9 border-0 border-b border-role-outline bg-transparent px-0 pb-(--spacing-sm) pt-(--spacing-sm) type-body w-full min-w-0 outline-none transition-colors duration-(--motion-duration-fast) disabled:pointer-events-none disabled:cursor-not-allowed'

/** Same string as the `label` item's component classes (upstream label.tsx). */
/** Upstream string re-keyed for foldkit: the label precedes the control, so
 *  upstream's native peer-disabled sibling variant can never match; disabled
 *  state flows from the wrapper (group/field + data-disabled, mirroring
 *  switch.ts). */
export const inputLabelClass =
  'type-kicker text-role-text-secondary transition-colors duration-(--motion-duration-fast) flex items-center select-none group-data-[disabled]:opacity-50 group-data-[disabled]/field:pointer-events-none group-data-[disabled]/field:cursor-not-allowed group-data-[disabled]/field:opacity-50 group-focus-within/field:text-role-text-primary'

export const inputDescriptionClass = 'type-exif text-role-text-disabled'

export const inputWrapperClass = 'group/field flex flex-col gap-(--spacing-xs) w-full'

export type InputConfig<M> = Readonly<{
  id: string
  label: string
  description?: string
  onInput?: (value: string) => M
  value?: string
  isDisabled?: boolean
  isReadOnly?: boolean
  isInvalid?: boolean
  isAutofocus?: boolean
  name?: string
  type?: string
  placeholder?: string
  className?: string
  labelClass?: string
  descriptionClass?: string
  wrapperClass?: string
}>

/** Styled text input with label and optional description, built on the
 *  @foldkit/ui Input helper. */
export const input = <M>(config: InputConfig<M>, h: HtmlBuilder<M>): Html =>
  FoldkitInput.view<M>(
    {
      id: config.id,
      ...(config.onInput !== undefined && { onInput: config.onInput }),
      ...(config.value !== undefined && { value: config.value }),
      ...(config.isDisabled !== undefined && { isDisabled: config.isDisabled }),
      ...(config.isReadOnly !== undefined && { isReadOnly: config.isReadOnly }),
      ...(config.isInvalid !== undefined && { isInvalid: config.isInvalid }),
      ...(config.isAutofocus !== undefined && { isAutofocus: config.isAutofocus }),
      ...(config.name !== undefined && { name: config.name }),
      ...(config.type !== undefined && { type: config.type }),
      ...(config.placeholder !== undefined && { placeholder: config.placeholder }),
      toView: (attributes) =>
        h.div(
          [
            h.Class(cn(inputWrapperClass, config.wrapperClass)),
            ...(config.isDisabled ? [h.DataAttribute('disabled', '')] : []),
          ],
          [
            h.label(
              [
                ...attributes.label,
                h.DataAttribute('slot', 'label'),
                h.Class(cn(inputLabelClass, config.labelClass)),
              ],
              [config.label],
            ),
            h.input([
              ...attributes.input,
              h.DataAttribute('slot', 'input'),
              h.Class(cn(inputClass, config.className)),
            ]),
            config.description === undefined
              ? h.empty
              : h.span(
                  [
                    ...attributes.description,
                    h.Class(cn(inputDescriptionClass, config.descriptionClass)),
                  ],
                  [config.description],
                ),
          ],
        ),
    },
    h,
  )
