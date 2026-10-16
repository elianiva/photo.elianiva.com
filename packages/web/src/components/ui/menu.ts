/** Stateful submodel — import the whole module as a namespace and wire its
 *  Model/Message/init/update into your app:
 *  `import * as Menu from '@/components/ui/menu'`
 */
import { Menu as FoldkitMenu } from '@foldkit/ui'
import type { AnchorConfig } from '@foldkit/ui/menu'
import { childAttributes, inertHtml, type Html } from 'foldkit/html'

import { cn } from '@/lib/utils'

// Re-export the @foldkit/ui Menu surface. Create a bundle once per item type:
//
//   export const ActionMenu = Menu.create<"Edit" | "Delete">()
//
// foldcn `menu` re-keyed onto the Desk's role tokens (no radius, hairline rule). foldkit deltas: items highlight via data-active (upstream uses focus:) —
// prefix adjusted per docs/deriving-from-base.md; the panel's data-side is
// emitted here from the anchor placement (foldkit anchors expose placement,
// not side). Gaps vs upstream: no checkbox/radio/submenu/
// destructive/inset item kinds (primitive-level). Flat item path uses correct
// tokens/slots; per-item data-slot (dropdown-menu-item etc) cannot be stamped —
// primitive has no per-item attribute hook (documented gap). Sub-trigger uses
// data-popup-open per upstream but foldkit emits data-open — compat via style
// token's data-open handling (see cn-compat.css).

export const create = FoldkitMenu.create
export const init = (config: InitConfig): Model => FoldkitMenu.init({ isAnimated: true, ...config })
export const buttonId = FoldkitMenu.buttonId
export const Model = FoldkitMenu.Model
export type Model = typeof Model.Type
export const Message = FoldkitMenu.Message
export type Message = typeof Message.Type
export const OutMessage = FoldkitMenu.OutMessage
export type OutMessage = typeof OutMessage.Type

export type Bundle<Item extends string = string> = FoldkitMenu.Bundle<Item>
export type InitConfig = FoldkitMenu.InitConfig
export type ViewInputs<Item extends string = string> = FoldkitMenu.ViewInputs<Item>
export type ItemConfig = FoldkitMenu.ItemConfig
export type GroupHeading = FoldkitMenu.GroupHeading

/** The Desk's trigger is the ghost Icon Button's box: square, no radius, the
 *  `surface.hover` fill — the same one every other icon control wears. */
export const menuTriggerClass =
  'focus-visible:border-role-focus focus-visible:ring-role-focus/50 inline-flex shrink-0 cursor-pointer items-center justify-center border border-transparent bg-clip-padding text-role-text-primary outline-none transition-colors duration-120 select-none hover:bg-role-surface-hover focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 aria-expanded:bg-role-surface-hover [&_svg:not([class*="size-"])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0'

/** The panel is a `color.surface` box inside a `color.hairline` rule with no
 *  corner radius, like the Sheet and the Dialog beside it. */
export const menuItemsClass =
  'data-enter:opacity-0 data-leave:opacity-0 border border-role-hairline bg-role-surface p-1 text-role-on-surface shadow-md transition-opacity duration-100 z-50 max-h-(--available-height) min-w-44 origin-(--transform-origin) overflow-x-hidden overflow-y-auto outline-none data-closed:overflow-hidden'

export const menuItemsAnimatedClass = menuItemsClass

/** `data-variant="destructive"` is not stampable per item (the primitive has no
 *  per-item attribute hook), so a destructive item passes `text-role-error` in
 *  its own `className`. */
export const menuItemClass =
  'type-ui gap-2 px-3 py-2 [&_svg:not([class*="size-"])]:size-4 relative flex cursor-pointer items-center outline-hidden select-none data-active:bg-role-surface-hover data-disabled:pointer-events-none data-disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0'

export const menuSeparatorClass = 'bg-role-hairline -mx-1 my-1 h-px'

export const menuHeadingClass = 'type-label text-role-text-secondary px-3 py-1'

export const menuLabelClass = menuHeadingClass

export const menuBackdropClass = 'fixed inset-0 z-0'

export const menuWrapperClass = 'relative inline-block'

export const MENU_ANCHOR: AnchorConfig = {
  placement: 'bottom-start',
  gap: 4,
  padding: 8,
}

export type MenuViewInputsConfig<Item extends string> = Readonly<{
  items: ReadonlyArray<Item>
  itemToConfig: ViewInputs<Item>['itemToConfig']
  buttonContent: Html
  anchor?: AnchorConfig
  isItemDisabled?: (item: Item, index: number) => boolean
  itemToSearchText?: (item: Item, index: number) => string
  isButtonDisabled?: boolean
  isAnimated?: boolean
  itemGroupKey?: (item: Item, index: number) => string
  groupToHeading?: (groupKey: string) => GroupHeading | undefined
  triggerClass?: string
  /** Accessible name of a glyph-only trigger. */
  triggerLabel?: string
  itemsClass?: string
  itemClass?: string
  backdropClass?: string
  wrapperClass?: string
  separatorClass?: string
  groupClass?: string
  ariaLabel?: string
  ariaLabelledBy?: string
}>

/** Build styled `Menu.ViewInputs` with foldcn's classes baked in. */
export const viewInputs = <Item extends string>(
  config: MenuViewInputsConfig<Item>,
): ViewInputs<Item> => {
  // Upstream slide-in variants key on data-side; foldkit anchors expose
  // placement ("bottom-start"), so derive the physical side here.
  const anchor = config.anchor ?? MENU_ANCHOR
  const side = (anchor.placement ?? 'bottom').split('-')[0] || 'bottom'
  return {
    items: config.items,
    anchor,
    ...(config.isItemDisabled === undefined ? {} : { isItemDisabled: config.isItemDisabled }),
    ...(config.itemToSearchText === undefined ? {} : { itemToSearchText: config.itemToSearchText }),
    ...(config.isButtonDisabled === undefined ? {} : { isButtonDisabled: config.isButtonDisabled }),
    buttonContent: config.buttonContent,
    ...(config.itemGroupKey === undefined ? {} : { itemGroupKey: config.itemGroupKey }),
    ...(config.groupToHeading === undefined
      ? {}
      : {
          groupToHeading: (groupKey: string) => {
            const heading = config.groupToHeading?.(groupKey)
            if (!heading) return undefined
            return {
              content: heading.content,
              className: cn(menuHeadingClass, heading.className),
            }
          },
        }),
    ...(config.ariaLabel === undefined ? {} : { ariaLabel: config.ariaLabel }),
    ...(config.ariaLabelledBy === undefined ? {} : { ariaLabelledBy: config.ariaLabelledBy }),
    buttonClassName: cn(menuTriggerClass, config.triggerClass),
    buttonAttributes: childAttributes([
      inertHtml.DataAttribute('slot', 'dropdown-menu-trigger'),
      ...(config.triggerLabel === undefined ? [] : [inertHtml.AriaLabel(config.triggerLabel)]),
    ]),
    itemsClassName: cn(
      config.isAnimated !== false ? menuItemsAnimatedClass : menuItemsClass,
      config.itemsClass,
    ),
    itemsAttributes: childAttributes([
      inertHtml.DataAttribute('slot', 'dropdown-menu-content'),
      inertHtml.DataAttribute('side', side),
    ]),
    itemToConfig: (item, context) => {
      const { className, content } = config.itemToConfig(item, context)
      return { className: cn(menuItemClass, config.itemClass, className), content }
    },
    separatorClassName: cn(menuSeparatorClass, config.separatorClass),
    separatorAttributes: childAttributes([
      inertHtml.DataAttribute('slot', 'dropdown-menu-separator'),
    ]),
    ...(config.groupClass === undefined ? {} : { groupClassName: config.groupClass }),
    groupAttributes: childAttributes([inertHtml.DataAttribute('slot', 'dropdown-menu-group')]),
    backdropClassName: cn(menuBackdropClass, config.backdropClass),
    className: cn(menuWrapperClass, config.wrapperClass),
    attributes: childAttributes([inertHtml.DataAttribute('slot', 'dropdown-menu')]),
  }
}
