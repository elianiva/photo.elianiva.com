/**
 * Icon Button — the design's 36px round control (master `f3b5eec3452af4e3`),
 * the Desk's only icon affordance. Three kinds, one geometry:
 *
 *   ghost    no box, `color.text.primary`, fills `color.surface.hover`
 *   outline  1px `color.rule` box, `color.text.primary`, fills
 *            `color.surface.hover`
 *   filled   `color.primary` box, `color.on-primary` icon, hover
 *            `color.primary.hover`
 *
 * The circle is `radius.full` — the one rounded control the Desk has, and the
 * one the design draws. `Button` is the rectangular one; reach for this when
 * the affordance is a single glyph with no label beside it.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { IconNode } from 'lucide'

import { icon } from '@/lib/icons'
import { cn } from '@/lib/utils'

/** Icon Button kind keys. Sync with `iconButtonVariants` is compiler-enforced:
 *  the record is `Record<IconButtonKind, string>` (missing key = error) and
 *  annotated object literals reject unknown keys. */
export const iconButtonKindKeys = ['ghost', 'outline', 'filled'] as const
export type IconButtonKind = (typeof iconButtonKindKeys)[number]

export const iconButtonVariants: Record<IconButtonKind, string> = {
  ghost: 'text-role-text-primary hover:bg-role-surface-hover',
  outline: 'border border-role-rule text-role-text-primary hover:bg-role-surface-hover',
  filled: 'bg-role-primary text-role-on-primary hover:bg-role-primary-hover',
}

/** The 18px icon slot the design gives the glyph inside the 36px circle. */
export const iconButtonIconClass = 'size-[18px]'

const iconButtonBase =
  'aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-role-focus focus-visible:ring-role-focus/50 inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding transition-colors duration-(--motion-duration-fast) outline-none focus-visible:ring-[3px]'

export type IconButtonConfig<M> = Readonly<{
  onClick?: M
  isDisabled?: boolean
  type?: 'button' | 'submit' | 'reset'
  isAutofocus?: boolean
  /** Required: a glyph-only control still needs an accessible name. */
  ariaLabel: string
  title?: string
  kind?: IconButtonKind
  className?: string
  /** Overrides the 18px slot for a glyph the design draws off-scale. */
  iconClass?: string
}>

/** Styled icon button built as a plain `button` — @foldkit/ui has no icon
 *  button, and `Button` carries the rectangular Desk geometry. */
export const iconButton = <M>(
  config: IconButtonConfig<M>,
  glyph: IconNode,
  h: HtmlBuilder<M>,
): Html =>
  h.button(
    [
      h.Type(config.type ?? 'button'),
      h.AriaLabel(config.ariaLabel),
      ...(config.title === undefined ? [] : [h.Title(config.title)]),
      ...(config.onClick === undefined ? [] : [h.OnClick(config.onClick)]),
      ...(config.isDisabled === true ? [h.Disabled(true)] : []),
      ...(config.isAutofocus === true ? [h.Autofocus(true)] : []),
      h.Class(cn(iconButtonBase, iconButtonVariants[config.kind ?? 'ghost'], config.className)),
      h.DataAttribute('slot', 'icon-button'),
      h.DataAttribute('kind', config.kind ?? 'ghost'),
    ],
    [icon(h, glyph, cn(iconButtonIconClass, config.iconClass))],
  )
