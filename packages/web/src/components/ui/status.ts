/**
 * Status — where a Photo sits in the publish lifecycle, as the Desk prints it
 * (master `bd6e0534ca3ace0a`). A 6px dot 8px ahead of a `$typography.kicker`
 * label, in four variants.
 *
 *   published  dot and label `color.text.primary`  — a set, solid mark
 *   draft      an empty ring and label `color.text.disabled`
 *   scheduled  a solid dot `color.text.disabled` under a
 *              `color.text.secondary` label — the "set but not yet" reading
 *   failed     dot and label `color.accent`
 *
 * `scheduled` is a display-only label over `draft` (CONTEXT.md, Status), so
 * the caller passes `scheduled` only for a draft with a future publish time.
 * Nothing here knows that: the atom renders the variant it is handed.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils'

/** Status variant keys. Sync with `statusVariants` is compiler-enforced. */
export const statusVariantKeys = ['published', 'draft', 'scheduled', 'failed'] as const
export type StatusVariant = (typeof statusVariantKeys)[number]

export const statusVariants: Record<StatusVariant, string> = {
  published: 'text-role-text-primary',
  draft: 'text-role-text-disabled',
  scheduled: 'text-role-text-secondary',
  failed: 'text-role-accent',
}

/** The dot is its own line: draft is a ring, published a fill. */
const dotVariants: Record<StatusVariant, string> = {
  published: 'bg-role-text-primary',
  draft: 'border border-role-text-disabled',
  scheduled: 'bg-role-text-disabled',
  failed: 'bg-role-accent',
}

/** What the Desk prints. The design sets every label in caps. */
export const statusLabels: Record<StatusVariant, string> = {
  published: 'PUBLISHED',
  draft: 'DRAFT',
  scheduled: 'SCHEDULED',
  failed: 'FAILED',
}

export type StatusConfig = Readonly<{
  variant: StatusVariant
  className?: string
}>

/** A Photo's Status, as a dot and its label. */
export const status = <M>(config: StatusConfig, h: HtmlBuilder<M>): Html =>
  h.div(
    [
      h.Class(cn('inline-flex items-center gap-2', config.className)),
      h.DataAttribute('slot', 'status'),
      h.DataAttribute('variant', config.variant),
    ],
    [
      h.span([
        h.AriaHidden(true),
        h.Class(cn('size-1.5 shrink-0 rounded-full', dotVariants[config.variant])),
      ]),
      h.span(
        [h.Class(cn('type-kicker', statusVariants[config.variant]))],
        [statusLabels[config.variant]],
      ),
    ],
  )
