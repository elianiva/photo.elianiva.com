/**
 * Textarea, site edition. The same underlined box as `input`, on a
 * field that grows with its content. The value is set in `$typography.body`
 * rather than `$typography.exif`: a caption is prose, not a value.
 */
import { Textarea as FoldkitTextarea } from '@foldkit/ui'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils'

export const textareaClass =
  'placeholder:text-role-text-disabled focus-visible:border-role-rule focus-visible:ring-0 aria-invalid:border-role-error disabled:border-role-hairline disabled:text-role-text-disabled field-sizing-content min-h-12 w-full min-w-0 border-0 border-b border-role-outline bg-transparent px-0 pb-2 pt-2 type-body outline-none transition-colors duration-120 disabled:cursor-not-allowed'

/** Same string as the `label` item's component classes (upstream label.tsx). */
/** Upstream string re-keyed for foldkit: the label precedes the control, so
 *  upstream's native peer-disabled sibling variant can never match; disabled
 *  state flows from the wrapper (group/field + data-disabled, mirroring
 *  switch.ts). */
export const textareaLabelClass =
  'type-label text-role-text-secondary transition-colors duration-120 flex items-center select-none group-data-[disabled]:opacity-50 group-data-[disabled]/field:pointer-events-none group-data-[disabled]/field:cursor-not-allowed group-data-[disabled]/field:opacity-50 group-focus-within/field:text-role-text-primary'

export const textareaDescriptionClass = 'type-exif text-role-text-disabled'

export const textareaWrapperClass = 'group/field flex flex-col gap-1 w-full'

export type TextareaConfig<M> = Readonly<{
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
  rows?: number
  placeholder?: string
  className?: string
  labelClass?: string
  descriptionClass?: string
  wrapperClass?: string
}>

/** Styled textarea with label and optional description, built on the
 *  @foldkit/ui Textarea helper. */
export const textarea = <M>(config: TextareaConfig<M>, h: HtmlBuilder<M>): Html =>
  FoldkitTextarea.view<M>(
    {
      id: config.id,
      ...(config.onInput !== undefined && { onInput: config.onInput }),
      ...(config.value !== undefined && { value: config.value }),
      ...(config.isDisabled !== undefined && { isDisabled: config.isDisabled }),
      ...(config.isReadOnly !== undefined && { isReadOnly: config.isReadOnly }),
      ...(config.isInvalid !== undefined && { isInvalid: config.isInvalid }),
      ...(config.isAutofocus !== undefined && { isAutofocus: config.isAutofocus }),
      ...(config.name !== undefined && { name: config.name }),
      ...(config.rows !== undefined && { rows: config.rows }),
      ...(config.placeholder !== undefined && { placeholder: config.placeholder }),
      toView: (attributes) =>
        h.div(
          [
            h.Class(cn(textareaWrapperClass, config.wrapperClass)),
            ...(config.isDisabled ? [h.DataAttribute('disabled', '')] : []),
          ],
          [
            h.label(
              [
                ...attributes.label,
                h.DataAttribute('slot', 'label'),
                h.Class(cn(textareaLabelClass, config.labelClass)),
              ],
              [config.label],
            ),
            h.textarea([
              ...attributes.textarea,
              h.DataAttribute('slot', 'textarea'),
              h.Class(cn(textareaClass, config.className)),
            ]),
            config.description === undefined
              ? h.empty
              : h.span(
                  [
                    ...attributes.description,
                    h.Class(cn(textareaDescriptionClass, config.descriptionClass)),
                  ],
                  [config.description],
                ),
          ],
        ),
    },
    h,
  )
