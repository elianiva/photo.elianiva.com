import { Combobox as FoldkitCombobox } from '@foldkit/ui'
import type { AnchorConfig } from '@foldkit/ui/combobox'
import type { Option } from 'effect/Option'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { icon } from '@/lib/icons'
import { Check, ChevronDown } from 'lucide'
import { cn } from '@/lib/utils'

// Re-export the @foldkit/ui Combobox surface. Create a bundle once per
// item type:
//
//   export const CityCombobox = Combobox.create<City>()
//   export const CityMultiCombobox = Combobox.Multi.create<City>()

export const create = FoldkitCombobox.create
export const Multi = FoldkitCombobox.Multi
export const init = (config: InitConfig): Model =>
  FoldkitCombobox.init({ isAnimated: true, ...config })
export const inputId = FoldkitCombobox.inputId
export const Model = FoldkitCombobox.Model
export type Model = typeof Model.Type
export const Message = FoldkitCombobox.Message
export type Message = typeof Message.Type
export const OutMessage = FoldkitCombobox.OutMessage
export type OutMessage = typeof OutMessage.Type

export type Bundle<Item extends string = string> = FoldkitCombobox.Bundle<Item>
export type InitConfig = FoldkitCombobox.InitConfig
export type ViewInputs<Item extends string = string> = FoldkitCombobox.ViewInputs<Item>
export type ItemConfig = FoldkitCombobox.ItemConfig
export type GroupHeading = FoldkitCombobox.GroupHeading

// foldkit deltas: items highlight via data-active (upstream
// data-highlighted:) per the derivation mapping. Gaps vs upstream: no chips
// UI for multi-select, no clear button, no Empty row; filtering is
// parent-owned.

/** The `Select` atom, wide: the same kicker label and 1px `color.outline`
 *  bottom rule as `Field`, the value in `$typography.exif`, and a 14px caret
 *  in `color.text.secondary`. The listbox is that box lifted onto a
 *  `color.hairline` surface, its active row in `color.surface.hover`. */
export const comboboxInputClass =
  'placeholder:text-role-text-disabled focus-visible:border-role-rule focus-visible:ring-0 aria-invalid:border-role-error disabled:border-role-hairline disabled:text-role-text-disabled h-9 w-full min-w-0 border-0 border-b border-role-outline bg-transparent py-(--spacing-sm) pr-(--spacing-xl) type-exif outline-none transition-colors duration-(--motion-duration-fast) disabled:cursor-not-allowed'

export const comboboxButtonClass =
  'absolute inset-y-0 right-0 flex items-center pr-(--spacing-sm) text-role-text-secondary transition-colors duration-(--motion-duration-fast) hover:text-role-text-primary disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-3.5'

export const comboboxItemsClass =
  'bg-role-surface-container text-role-on-surface data-enter:animate-in data-leave:animate-out data-leave:fade-out-0 data-enter:fade-in-0 data-leave:zoom-out-95 data-enter:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 max-h-72 border border-role-hairline p-(--spacing-sm) z-50 min-w-56 outline-hidden'

export const comboboxItemsAnimatedClass = comboboxItemsClass

export const comboboxItemClass =
  'data-active:bg-role-surface-hover data-active:text-role-on-surface gap-(--spacing-sm) py-(--spacing-xs) pr-(--spacing-lg) pl-(--spacing-xs) type-exif flex w-full cursor-default select-none outline-hidden data-disabled:pointer-events-none data-disabled:text-role-text-disabled data-selected:text-role-text-primary'

export const comboboxGroupHeadingClass =
  'type-kicker text-role-text-secondary px-(--spacing-sm) py-(--spacing-xs)'

export const comboboxSeparatorClass = 'bg-role-hairline -mx-1 my-1 h-px'

export const comboboxItemsScrollClass = 'no-scrollbar max-h-72 scroll-py-1 overflow-y-auto p-1'

export const comboboxBackdropClass = 'fixed inset-0 z-0'

export const comboboxWrapperClass = 'relative w-full'

export const comboboxInputWrapperClass = 'relative'

export const COMBOBOX_ANCHOR: AnchorConfig = {
  placement: 'bottom-start',
  gap: 8,
  padding: 8,
  // Render in place (inside the nearest positioned wrapper) instead of the
  // body-level portal root: native <dialog> panels live in the top layer,
  // which no z-index can outrank, so portaled popups would be unclickable
  // behind Dialog/Sheet surfaces.
  portal: false,
}

export const comboboxChevron = <M>(h: HtmlBuilder<M>): Html =>
  h.span([h.Class('shrink-0 text-role-text-secondary')], [icon(h, ChevronDown, 'size-3.5')])

export const comboboxCheck = <M>(h: HtmlBuilder<M>): Html =>
  h.span(
    [h.Class('absolute right-(--spacing-sm) flex size-4 items-center justify-center')],
    [icon(h, Check, 'size-3.5 text-role-text-primary')],
  )

type CommonConfig<Item extends string> = Readonly<{
  items: ReadonlyArray<Item>
  restingInputValue: string
  itemToConfig: (
    item: Item,
    context: Readonly<{
      isActive: boolean
      isDisabled: boolean
      isReadOnly: boolean
      isSelected: boolean
    }>,
  ) => ItemConfig
  itemToValue: (item: Item, index: number) => Item
  itemToDisplayText: (item: Item, index: number) => string
  anchor?: AnchorConfig
  isItemDisabled?: (item: Item, index: number) => boolean
  inputPlaceholder?: string
  buttonContent?: Html
  isAnimated?: boolean
  isDisabled?: boolean
  isReadOnly?: boolean
  isInvalid?: boolean
  openOnFocus?: boolean
  ariaLabel?: string
  ariaLabelledBy?: string
  itemGroupKey?: (item: Item, index: number) => string
  groupToHeading?: (groupKey: string) => GroupHeading | undefined
  formName?: string
  inputClass?: string
  itemsClass?: string
  itemsScrollClass?: string
  itemClass?: string
  groupClass?: string
  separatorClass?: string
  backdropClass?: string
  wrapperClass?: string
  inputWrapperClass?: string
}>

const common = <Item extends string>(config: CommonConfig<Item>) => ({
  items: config.items,
  restingInputValue: config.restingInputValue,
  itemToValue: config.itemToValue,
  itemToDisplayText: config.itemToDisplayText,
  anchor: config.anchor ?? COMBOBOX_ANCHOR,
  ...(config.isItemDisabled !== undefined && { isItemDisabled: config.isItemDisabled }),
  ...(config.inputPlaceholder !== undefined && { inputPlaceholder: config.inputPlaceholder }),
  ...(config.buttonContent !== undefined && { buttonContent: config.buttonContent }),
  ...(config.formName !== undefined && { formName: config.formName }),
  ...(config.isDisabled !== undefined && { isDisabled: config.isDisabled }),
  ...(config.isReadOnly !== undefined && { isReadOnly: config.isReadOnly }),
  ...(config.isInvalid !== undefined && { isInvalid: config.isInvalid }),
  ...(config.openOnFocus !== undefined && { openOnFocus: config.openOnFocus }),
  ...(config.ariaLabel !== undefined && { ariaLabel: config.ariaLabel }),
  ...(config.ariaLabelledBy !== undefined && { ariaLabelledBy: config.ariaLabelledBy }),
  ...(config.itemGroupKey !== undefined && { itemGroupKey: config.itemGroupKey }),
  ...(config.groupToHeading !== undefined && { groupToHeading: config.groupToHeading }),
  inputClassName: cn(comboboxInputClass, config.inputClass),
  itemsClassName: cn(
    config.isAnimated !== false ? comboboxItemsAnimatedClass : comboboxItemsClass,
    config.itemsClass,
  ),
  itemsScrollClassName: config.itemsScrollClass ?? comboboxItemsScrollClass,
  itemToConfig: (item: Item, context: Parameters<CommonConfig<Item>['itemToConfig']>[1]) => {
    const { className, content } = config.itemToConfig(item, context)
    return { className: cn(comboboxItemClass, config.itemClass, className), content }
  },
  groupClassName: cn(comboboxGroupHeadingClass, config.groupClass),
  separatorClassName: cn(comboboxSeparatorClass, config.separatorClass),
  buttonClassName: comboboxButtonClass,
  inputWrapperClassName: cn(comboboxInputWrapperClass, config.inputWrapperClass),
  backdropClassName: cn(comboboxBackdropClass, config.backdropClass),
  className: cn(comboboxWrapperClass, config.wrapperClass),
})

export type SingleViewInputsConfig<Item extends string> = CommonConfig<Item> &
  Readonly<{
    maybeSelectedValue: Option<Item>
  }>

/** Build styled single-select `Combobox.ViewInputs`.
 *  Mirrors the shadcn v4 `combobox.tsx` trigger/content/item behavior:
 *  chevron trigger, check indicator on the selected item, scrollable list
 *  with max-height, grouping + separator support, and disabled/invalid/
 *  read-only + aria-label states. Filtering is parent-owned: pass the
 *  already-filtered `items` each render. The panel is hidden when `items`
 *  is empty (no empty-state row — show it outside the combobox if needed). */
export const viewInputs = <Item extends string>(
  config: SingleViewInputsConfig<Item>,
): ViewInputs<Item> => ({
  ...common(config),
  maybeSelectedValue: config.maybeSelectedValue,
})

export type MultiViewInputsConfig<Item extends string> = CommonConfig<Item> &
  Readonly<{
    selectedValues: ReadonlyArray<Item>
  }>

/** Build styled multi-select `Combobox.Multi` view inputs.
 *  Mirrors the same trigger/list/item styling as the single-select
 *  variant; the input rests empty after each commit and the parent
 *  toggles membership on `Selected` out-messages. Supports grouping and
 *  the same disabled/invalid/read-only states. */
export const multiViewInputs = <Item extends string>(
  config: MultiViewInputsConfig<Item>,
): FoldkitCombobox.Multi.ViewInputs<Item> => ({
  ...common(config),
  selectedValues: config.selectedValues,
})
