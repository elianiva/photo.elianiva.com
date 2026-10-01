import { Dialog as FoldkitDialog } from '@foldkit/ui'
import type { Attribute, ChildAttribute, Html, HtmlBuilder } from 'foldkit/html'

type Child = Html | string

import { cn } from '@/lib/utils'

// Re-export the @foldkit/ui Dialog submodel surface so a foldcn Dialog is a
// drop-in for wiring `h.submodel`.

export const Model = FoldkitDialog.Model
export type Model = typeof Model.Type

export const Message = FoldkitDialog.Message
export type Message = typeof Message.Type

export const OutMessage = FoldkitDialog.OutMessage
export type OutMessage = typeof OutMessage.Type

export const init = (config: InitConfig): Model =>
  FoldkitDialog.init({ isAnimated: true, ...config })
export const update = FoldkitDialog.update
export const open = FoldkitDialog.open
export const close = FoldkitDialog.close
export const titleId = FoldkitDialog.titleId
export const descriptionId = FoldkitDialog.descriptionId
export const view = FoldkitDialog.view

export type InitConfig = FoldkitDialog.InitConfig
export type RenderInfo = FoldkitDialog.RenderInfo

/** foldkit delta: the host <dialog> element's own chrome (upstream Root renders
 *  nothing). Backdrop/panel are fixed-position; this only neutralizes the
 *  native dialog box. */
export const dialogClass = 'bg-transparent p-0 open:flex items-center justify-center'

// The @foldkit/ui Dialog defers Animation submodel attributes onto the
// backdrop/panel elements: `data-enter` while entering, `data-leave` while
// leaving (never `data-state`). The sync script rewrites upstream's
// `data-open:`/`data-closed:` animation utilities to these windows during token
// sync; persistent `data-open:` styling passes through untouched.
/** A Dialog is a `Panel` in the design's language: the panel sits on
 *  `color.surface` inside a `color.hairline` box with no corner radius, and
 *  the scrim is the design's own `color.shadow` rather than a black alpha. */
export const dialogBackdropClass =
  'data-enter:animate-in data-leave:animate-out data-leave:fade-out-0 data-enter:fade-in-0 bg-role-shadow/40 duration-100 supports-backdrop-filter:backdrop-blur-xs fixed inset-0 isolate z-50'

export const dialogPanelClass =
  'bg-role-surface text-role-on-surface data-enter:animate-in data-leave:animate-out data-leave:fade-out-0 data-enter:fade-in-0 data-leave:zoom-out-95 data-enter:zoom-in-95 grid max-w-[calc(100%-2rem)] gap-4 border border-role-hairline p-4 type-ui duration-100 sm:max-w-sm fixed top-1/2 left-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 outline-none'

/** Upstream renders its close control as a ghost button; the Desk's is the
 * `Icon Button` ghost kind: 36px, round, an 18px mark. */
export const dialogCloseButtonClass =
  'text-role-text-secondary absolute top-3 right-3 flex size-9 items-center justify-center rounded-full outline-none transition-colors duration-120 hover:bg-role-surface-hover hover:text-role-text-primary focus-visible:ring-[3px] focus-visible:ring-role-focus/50 [&_svg:not([class*="size-"])]:size-4'

export const dialogTitleClass = 'type-section text-role-text-primary'

export const dialogDescriptionClass =
  'type-caption text-role-text-secondary *:[a]:underline *:[a]:underline-offset-4 *:[a:hover]:text-role-text-primary'

export const dialogHeaderClass = 'gap-2 flex flex-col'

export const dialogFooterClass =
  'border-role-hairline -mx-4 -mb-4 border-t p-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'

// These abstract away element types, base classes, and attribute spreading.
// Use inside `styledViewInputs` content callbacks:
//
//   content: (render, h) => [
//     Dialog.header({}, [
//       Dialog.title({ attributes: render.title }, ['Title'], h),
//       Dialog.description({ attributes: render.description }, ['Subtitle'], h),
//     ], h),
//     Dialog.footer({}, [button(...)], h),
//   ]
//
// Every builder follows one shape: `(config, children, h)`. Attribute
// bundles handed to you by `styledViewInputs` go in `config.attributes`.

type StyleConfig<M> = Readonly<{
  className?: string
  /** Submodel-provided attributes (from the `styledViewInputs` content
   *  callback render bundle) to merge onto the element. */
  attributes?: ReadonlyArray<Attribute<M> | ChildAttribute>
}>

/** Dialog header wrapper. */
export const header = <M>(
  config: StyleConfig<M>,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [h.DataAttribute('slot', 'dialog-header'), h.Class(cn(dialogHeaderClass, config.className))],
    children,
  )

/** Dialog title — merges with the submodel's title attributes. */
export const title = <M>(
  config: StyleConfig<M>,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.h2(
    [
      ...(config.attributes ?? []),
      h.DataAttribute('slot', 'dialog-title'),
      h.Class(cn(dialogTitleClass, config.className)),
    ],
    children,
  )

/** Dialog description — merges with the submodel's description attributes. */
export const description = <M>(
  config: StyleConfig<M>,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.p(
    [
      ...(config.attributes ?? []),
      h.DataAttribute('slot', 'dialog-description'),
      h.Class(cn(dialogDescriptionClass, config.className)),
    ],
    children,
  )

/** Dialog footer wrapper. */
export const footer = <M>(
  config: StyleConfig<M>,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [h.DataAttribute('slot', 'dialog-footer'), h.Class(cn(dialogFooterClass, config.className))],
    children,
  )

/** Close button — merges with the submodel's closeButton attributes. */
export const closeButton = <M>(
  config: StyleConfig<M>,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<M>,
): Html =>
  h.button(
    [
      ...(config.attributes ?? []),
      h.DataAttribute('slot', 'dialog-close'),
      h.Class(cn(dialogCloseButtonClass, config.className)),
    ],
    children,
  )

export type DialogContent<M> = Readonly<{
  closeButton: ReadonlyArray<Attribute<M> | ChildAttribute>
  title: ReadonlyArray<Attribute<M> | ChildAttribute>
  description: ReadonlyArray<Attribute<M> | ChildAttribute>
}>

export type StyledViewInputs<M> = Readonly<{
  /** Panel content. Receives the close-button, title and description
   *  attribute bundles to spread onto your own elements, or pass to
   *  Dialog.title / Dialog.description / Dialog.closeButton helpers via
   *  their `attributes` config field. */
  content: (render: DialogContent<M>, h: HtmlBuilder<M>) => ReadonlyArray<Child>
  className?: string
  backdropClass?: string
  panelClass?: string
}>

/** Build styled `Dialog.ViewInputs`. Pass your view's `h` so the content
 *  callback can dispatch your app's own messages (e.g. a destructive
 *  action button next to the dialog's `closeButton`). */
export const styledViewInputs = <M>(
  viewInputs: StyledViewInputs<M>,
  h: HtmlBuilder<M>,
): FoldkitDialog.ViewInputs => ({
  toView: ({ dialog, backdrop, panel, closeButton, title, description, isVisible }) =>
    h.dialog(
      [
        ...dialog,
        h.DataAttribute('slot', 'dialog'),
        h.Class(cn(dialogClass, viewInputs.className)),
      ],
      isVisible
        ? [
            h.div([
              ...backdrop,
              h.DataAttribute('slot', 'dialog-overlay'),
              h.Class(cn(dialogBackdropClass, viewInputs.backdropClass)),
            ]),
            h.div(
              [
                ...panel,
                h.DataAttribute('slot', 'dialog-content'),
                h.Class(cn(dialogPanelClass, viewInputs.panelClass)),
              ],
              viewInputs.content({ closeButton, title, description }, h),
            ),
          ]
        : [],
    ),
})
