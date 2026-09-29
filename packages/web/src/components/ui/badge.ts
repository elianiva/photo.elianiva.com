/**
 * Badge, broadsheet edition. The design's tag is `Ratio Tag`: a 1px
 * `color.outline` box around 4/8 of padding, holding one `$typography.exif`
 * label in `color.text.secondary`, with no corner radius and no fill.
 *
 * The three variants are the three role pairs the Desk reads a label in —
 * a set value (`default`), a muted one (`secondary`), a failed one
 * (`destructive`, on `color.accent`).
 */
import type { Html, HtmlBuilder } from 'foldkit/html'

type Child = Html | string

import { cn } from '@/lib/utils'

/** Badge variant keys — keep in sync with `badgeVariants`. */
export const badgeVariantKeys = ['default', 'secondary', 'destructive'] as const

export const badgeVariants: Record<BadgeVariant, string> = {
  default: 'border-role-outline text-role-text-primary',
  secondary: 'border-role-hairline text-role-text-secondary',
  destructive: 'border-role-accent text-role-accent',
}

export type BadgeVariant = (typeof badgeVariantKeys)[number]

export const badgeClass =
  'border bg-transparent px-(--spacing-sm) py-(--spacing-xs) type-exif whitespace-nowrap inline-flex w-fit shrink-0 items-center justify-center gap-1 transition-colors duration-(--motion-duration-fast) focus-visible:border-role-focus focus-visible:ring-[3px] focus-visible:ring-role-focus/50 [&>svg]:pointer-events-none [&>svg]:shrink-0'

type StyleConfig = Readonly<{ className?: string; variant?: BadgeVariant }>

/** Styled badge built as a themed `<span>` (mirrors the shadcn v4 `badge.tsx`
 *  default element). For a link badge, render an `<a>` child and apply
 *  `badgeClass` via `cn` — foldcn has no Radix `Slot`. */
export const badge = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.span(
    [
      h.Class(cn(badgeClass, badgeVariants[config.variant ?? 'default'], config.className)),
      h.DataAttribute('slot', 'badge'),
      h.DataAttribute('variant', config.variant ?? 'default'),
    ],
    children,
  )
