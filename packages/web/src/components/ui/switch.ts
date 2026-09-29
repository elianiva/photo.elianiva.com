/**
 * Switch, broadsheet edition. Vendored from the `@foldcn` registry and re-cut
 * to the design's `Toggle` (master `52b8cb8abcba5c06`):
 *
 *   off  a 34×20 pill on a 1px `color.outline` ring, a 12px
 *        `color.text.disabled` knob resting at the left
 *   on   the same pill filled `color.primary`, a 12px `color.on-primary` knob
 *        flush right — 14px of travel inside 4px of padding
 *
 * The registry's 32×18.4 box and 16px knob are the shadcn default; the Desk's
 * control is the design's, so both are re-stated here. Every colour is a
 * `role-*` token, so the pill follows the theme scope with no `dark:` variant.
 *
 * foldkit deltas: it emits `aria-disabled`/`data-disabled` instead of native
 * `disabled`, and only `data-checked` (never `data-unchecked`) on the root
 * button, so this view hand-emits `data-unchecked` when off. The travel and
 * knob-colour variants key on the thumb's own `data-checked`, which the view
 * mirrors there as upstream does.
 */
import { Switch as FoldkitSwitch } from '@foldkit/ui'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils'

export const switchSizeKeys = ['default', 'sm'] as const
export type SwitchSize = (typeof switchSizeKeys)[number]

export const switchClass =
  'aria-invalid:border-role-error aria-invalid:ring-role-error/20 data-checked:border-role-primary data-checked:bg-role-primary data-disabled:cursor-not-allowed data-disabled:opacity-50 focus-visible:border-role-focus focus-visible:ring-[3px] focus-visible:ring-role-focus/50 outline-none inline-flex h-5 w-[34px] shrink-0 items-center rounded-full border border-role-outline bg-transparent p-(--spacing-xs) transition-colors duration-(--motion-duration-fast)'

export const switchThumbClass =
  'data-checked:translate-x-3.5 data-checked:bg-role-on-primary pointer-events-none block size-3 rounded-full bg-role-text-disabled transition-transform duration-(--motion-duration-fast)'

export const switchLabelClass = 'type-ui select-none group-data-[disabled]:opacity-50'

export const switchDescriptionClass = 'type-exif text-role-text-disabled'

export const switchWrapperClass = 'flex items-center gap-(--spacing-lg)'

export const switchTextWrapperClass = 'flex flex-col gap-(--spacing-xs)'

export type SwitchConfig<M> = Readonly<{
  id: string
  isChecked: boolean
  onToggle: (isChecked: boolean) => M
  label: string
  description?: string
  isDisabled?: boolean
  isReadOnly?: boolean
  name?: string
  value?: string
  size?: SwitchSize
  className?: string
  thumbClass?: string
  labelClass?: string
  descriptionClass?: string
  wrapperClass?: string
}>

/** Styled switch with label, built on the @foldkit/ui Switch helper. */
export const switch_ = <M>(config: SwitchConfig<M>, h: HtmlBuilder<M>): Html =>
  FoldkitSwitch.view<M>(
    {
      id: config.id,
      hasDescription: config.description !== undefined,
      isChecked: config.isChecked,
      onToggle: config.onToggle,
      ...(config.isDisabled !== undefined && { isDisabled: config.isDisabled }),
      ...(config.isReadOnly !== undefined && { isReadOnly: config.isReadOnly }),
      ...(config.name !== undefined && { name: config.name }),
      ...(config.value !== undefined && { value: config.value }),
      toView: (attributes) =>
        h.div(
          [
            h.Class(cn(switchWrapperClass, config.wrapperClass)),
            ...(config.isDisabled ? [h.DataAttribute('disabled', '')] : []),
          ],
          [
            h.button(
              [
                ...attributes.button,
                h.DataAttribute('slot', 'switch'),
                h.DataAttribute('size', config.size ?? 'default'),
                ...(config.isChecked ? [] : [h.DataAttribute('unchecked', '')]),
                h.Class(cn(switchClass, config.className)),
              ],
              [
                h.span([
                  h.DataAttribute('slot', 'switch-thumb'),
                  h.DataAttribute(config.isChecked ? 'checked' : 'unchecked', ''),
                  h.Class(cn(switchThumbClass, config.thumbClass)),
                ]),
              ],
            ),
            ...(attributes.hiddenInput.length > 0 ? [h.input([...attributes.hiddenInput])] : []),
            h.div(
              [h.Class(switchTextWrapperClass)],
              [
                h.label(
                  [...attributes.label, h.Class(cn(switchLabelClass, config.labelClass))],
                  [config.label],
                ),
                config.description === undefined
                  ? h.empty
                  : h.p(
                      [
                        ...attributes.description,
                        h.Class(cn(switchDescriptionClass, config.descriptionClass)),
                      ],
                      [config.description],
                    ),
              ],
            ),
          ],
        ),
    },
    h,
  )
