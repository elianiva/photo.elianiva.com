/**
 * Sidebar Item — the design's sidebar row (master `d62f7bc146e0dd21`).
 * One geometry, 36px tall with 8px of vertical and 12px of horizontal
 * padding, and two states:
 *
 *   default  no box, `color.text.secondary` label, `color.text.disabled`
 *            count, filling `color.surface.hover` on hover
 *   active   `color.surface` box with a 2px `color.rule` rule down the
 *            leading edge, label and count in `color.text.primary`
 *
 * The label is `$typography.ui`, the count `$typography.exif`, and the icon
 * slot is 16px. The leading rule is this row's only way of saying "you are
 * here", so the current row is marked by a box and a rule rather than by
 * colour alone.
 *
 * `href` and `onClick` are the two shapes the row takes. A row that navigates
 * gets an `href` — the runtime intercepts the anchor, so a cold load of that
 * URL boots the Admin on the right route — and a row that acts in place (a tag
 * filter, a tag's actions) gets an `onClick` and becomes a button. A row that
 * is both a link and a button is neither, so exactly one is passed.
 */
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'
import type { IconNode } from 'lucide'

import { icon } from '@/lib/icons'
import { cn } from '@/lib/utils'

/** Sidebar Item state keys. Sync with the `*Classes` records is
 *  compiler-enforced: each is `Record<SidebarItemState, string>` and an
 *  annotated object literal rejects unknown keys. */
export const sidebarItemStateKeys = ['active', 'default'] as const
export type SidebarItemState = (typeof sidebarItemStateKeys)[number]

const sidebarItemBase =
  'focus-visible:ring-role-focus/50 flex h-9 w-full items-center gap-3 border-0 border-l-2 border-l-transparent py-2 pr-3 pl-2 text-left transition-colors duration-120 outline-none focus-visible:ring-[3px]'

export const sidebarItemStateClasses: Record<SidebarItemState, string> = {
  active: 'bg-role-surface border-l-role-rule',
  default: 'hover:bg-role-surface-hover',
}

const labelClasses: Record<SidebarItemState, string> = {
  active: 'text-role-text-primary',
  default: 'text-role-text-secondary',
}

/** The count is information, not a disabled control, so it cannot be drawn in
 *  `color.text.disabled`: that token is `#7c766b`, which is 3.6:1 on the rail's
 *  `color.surface.container` — under the 4.5:1 a 10px `$typography.exif` line
 *  needs. `color.text.secondary` is 5.6:1 there. The row still reads as two
 *  weights because the label is `$typography.ui` and the count is
 *  `$typography.exif`, and both go to `color.text.primary` on the active row. */
const countClasses: Record<SidebarItemState, string> = {
  active: 'text-role-text-primary',
  default: 'text-role-text-secondary',
}

export type SidebarItemConfig<M> = Readonly<{
  label: string
  state: SidebarItemState
  /** Navigates. The runtime intercepts the anchor and resolves the URL
   *  against the route table. */
  href?: string
  /** Acts in place. Renders a `button` instead of an `a`. */
  onClick?: M
  icon?: IconNode
  /** The design's count slot. Left out rather than filled with a zero or a
   *  dash when there is no count to report: the slot is reserved, not
   *  mandatory. */
  count?: string
  /** Extra attributes merged onto the row (ids, `aria-pressed`, …). */
  attributes?: ReadonlyArray<Attribute<M>>
  className?: string
}>

/** The icon slot is 16px whether or not the row has a glyph, so a row without
 *  one still lines up with a row that has. */
const iconSlot = <M>(config: SidebarItemConfig<M>, h: HtmlBuilder<M>): Html =>
  config.icon === undefined
    ? h.span([h.AriaHidden(true), h.Class('size-4 shrink-0')], [])
    : icon(h, config.icon, 'size-4 shrink-0 text-role-text-secondary')

/** The design reserves the count slot and prints a blank in it when a row has
 *  no count, so an empty count is a state the row already accounts for.
 *
 *  The count carries its own leading space because a row's accessible name is
 *  its text content joined with nothing: two sibling spans would otherwise
 *  announce "Library412". The space is inside a flex item, where leading
 *  whitespace collapses away, so the row looks exactly as the design draws it. */
const countSlot = <M>(config: SidebarItemConfig<M>, h: HtmlBuilder<M>): ReadonlyArray<Html> =>
  config.count === undefined
    ? []
    : [
        h.span(
          [h.Class(cn('shrink-0 type-exif tabular-nums', countClasses[config.state]))],
          [` ${config.count}`],
        ),
      ]

const rowBody = <M>(config: SidebarItemConfig<M>, h: HtmlBuilder<M>): ReadonlyArray<Html> => [
  iconSlot(config, h),
  h.span(
    [h.Class(cn('min-w-0 flex-1 truncate type-ui', labelClasses[config.state]))],
    [config.label],
  ),
  ...countSlot(config, h),
]

/** One sidebar row, drawn as a link when it navigates and a button when it
 *  acts in place. */
export const sidebarItem = <M>(config: SidebarItemConfig<M>, h: HtmlBuilder<M>): Html => {
  const className = cn(sidebarItemBase, sidebarItemStateClasses[config.state], config.className)
  const shared = [
    h.DataAttribute('slot', 'sidebar-item'),
    h.DataAttribute('state', config.state),
    h.Class(className),
  ]
  if (config.href !== undefined) {
    return h.a(
      [
        h.Href(config.href),
        ...(config.state === 'active' ? [h.AriaCurrent('page')] : []),
        ...shared,
        ...(config.attributes ?? []),
      ],
      rowBody(config, h),
    )
  }
  return h.button(
    [
      h.Type('button'),
      ...(config.onClick === undefined ? [] : [h.OnClick(config.onClick)]),
      ...shared,
      ...(config.attributes ?? []),
    ],
    rowBody(config, h),
  )
}
