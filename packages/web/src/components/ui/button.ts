/**
 * Button, broadsheet edition. The design gives four kinds and one geometry,
 * with no corner radius on any of them:
 *
 *   default     fill `color.primary`, label `color.on-primary`, hover
 *               `color.primary.hover`
 *   secondary   1px `color.rule` box, label `color.text.primary`, hover
 *               `color.surface.hover`
 *   ghost       no box, label `color.text.primary`, hover `color.surface.hover`
 *   destructive 1px `color.accent` box, label `color.accent`, fills with
 *               `color.accent` and `color.on-accent` on hover
 *
 * The label is `$typography.ui`; the box is 8/16 of padding around a 36px
 * line. Disabled drops a filled label to `color.surface.container.high`, a
 * boxed label to `color.hairline`, and every label to `color.text.disabled`.
 *
 * Every colour is a `role-*` token, so the whole table follows the theme
 * scope with no `dark:` variant: the dark branch of each role is the mirror
 * the generator already emits.
 */
import { Button as FoldkitButton } from '@foldkit/ui'
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils'

/** Button variant keys. Sync with `buttonVariants` is compiler-enforced:
 *  `buttonVariants` is `Record<ButtonVariant, string>` (missing key = error)
 *  and annotated object literals reject unknown keys. */
export const buttonVariantKeys = ['default', 'secondary', 'ghost', 'destructive'] as const

export const buttonVariants: Record<ButtonVariant, string> = {
  default:
    'bg-role-primary text-role-on-primary hover:bg-role-primary-hover disabled:bg-role-surface-container-high',
  secondary:
    'border border-role-rule text-role-text-primary hover:bg-role-surface-hover hover:border-role-rule disabled:border-role-hairline',
  ghost: 'text-role-text-primary hover:bg-role-surface-hover',
  destructive:
    'border border-role-accent text-role-accent hover:bg-role-accent hover:text-role-on-accent disabled:border-role-hairline',
}

export type ButtonVariant = (typeof buttonVariantKeys)[number]

const buttonBase =
  'focus-visible:border-role-focus focus-visible:ring-role-focus/50 aria-invalid:ring-role-error/20 aria-invalid:border-role-error disabled:text-role-text-disabled data-disabled:text-role-text-disabled h-9 gap-(--spacing-sm) border border-transparent bg-clip-padding px-(--spacing-lg) type-ui transition-colors duration-(--motion-duration-fast) outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed data-disabled:pointer-events-none [&_svg:not([class*="size-"])]:size-4'

export type ButtonConfig<M> = Readonly<{
  onClick?: M
  isDisabled?: boolean
  type?: 'button' | 'submit' | 'reset'
  isAutofocus?: boolean
  variant?: ButtonVariant
  className?: string
  /** Extra attributes merged onto the button element (ids, handlers,
   *  popoover anchors, …). */
  attributes?: ReadonlyArray<Attribute<M>>
}>

/** Styled button built on the @foldkit/ui Button helper. */
export const button = <M>(config: ButtonConfig<M>, label: Html | string, h: HtmlBuilder<M>): Html =>
  FoldkitButton.view<M>(
    {
      ...(config.onClick !== undefined && { onClick: config.onClick }),
      ...(config.isDisabled !== undefined && { isDisabled: config.isDisabled }),
      ...(config.type !== undefined && { type: config.type }),
      ...(config.isAutofocus !== undefined && { isAutofocus: config.isAutofocus }),
      toView: (attributes) =>
        h.button(
          [
            ...attributes.button,
            h.Class(cn(buttonBase, buttonVariants[config.variant ?? 'default'], config.className)),
            h.DataAttribute('slot', 'button'),
            ...(config.attributes ?? []),
          ],
          [label],
        ),
    },
    h,
  )
