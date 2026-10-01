import type { Html, HtmlBuilder } from 'foldkit/html'

type Child = Html | string

import { cn } from '@/lib/utils'

/** The canvas draws the empty state twice — `b473b2e8ce68277f`, the Library's,
 *  and the Series panel inside `cf5a3dff0a49583f` — and both title it in
 *  `$typography.section.sm` (24px): a dashed `color.outline` well holding a
 *  `color.text.disabled` mark, that title, and a `$typography.caption` line in
 *  `color.text.secondary`. */
export const emptyClass =
  'gap-4 border border-dashed border-role-outline p-12 flex w-full min-w-0 flex-1 flex-col items-center justify-center text-center text-balance'

export const emptyHeaderClass = 'gap-2 flex max-w-sm flex-col items-center'

export const emptyMediaVariantKeys = ['default', 'icon'] as const
export type EmptyMediaVariant = (typeof emptyMediaVariantKeys)[number]

export const emptyMediaClass =
  'mb-1 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0'

export const emptyMediaVariants: Record<EmptyMediaVariant, string> = {
  default: 'bg-transparent',
  icon: 'flex size-12 shrink-0 items-center justify-center text-role-text-disabled [&_svg:not([class*="size-"])]:size-8',
}

export const emptyTitleClass = 'type-section-sm text-role-text-primary'

export const emptyDescriptionClass =
  'type-caption text-role-text-secondary [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-role-text-primary'

export const emptyContentClass =
  'gap-2 type-caption flex w-full max-w-sm min-w-0 flex-col items-center text-balance'

type StyleConfig = Readonly<{ className?: string }>

type EmptyMediaConfig = Readonly<{ variant?: EmptyMediaVariant; className?: string }>

const emptyContainer = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div([h.Class(cn(emptyClass, config.className)), h.DataAttribute('slot', 'empty')], children)

const emptyHeader = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [h.Class(cn(emptyHeaderClass, config.className)), h.DataAttribute('slot', 'empty-header')],
    children,
  )

const emptyMedia = <M>(
  config: EmptyMediaConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [
      h.Class(
        cn(emptyMediaClass, emptyMediaVariants[config.variant ?? 'default'], config.className),
      ),
      h.DataAttribute('slot', 'empty-icon'),
      h.DataAttribute('variant', config.variant ?? 'default'),
    ],
    children,
  )

const emptyTitle = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [h.Class(cn(emptyTitleClass, config.className)), h.DataAttribute('slot', 'empty-title')],
    children,
  )

const emptyDescription = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [
      h.Class(cn(emptyDescriptionClass, config.className)),
      h.DataAttribute('slot', 'empty-description'),
    ],
    children,
  )

const emptyContent = <M>(
  config: StyleConfig,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [h.Class(cn(emptyContentClass, config.className)), h.DataAttribute('slot', 'empty-content')],
    children,
  )

/** Styled empty state — `Empty.header`, `Empty.media`, `Empty.title`,
 *  `Empty.description`, `Empty.content` sub-builders. Mirrors the shadcn v4
 *  `empty.tsx`. */
export const Empty = Object.assign(emptyContainer, {
  header: emptyHeader,
  media: emptyMedia,
  title: emptyTitle,
  description: emptyDescription,
  content: emptyContent,
})
