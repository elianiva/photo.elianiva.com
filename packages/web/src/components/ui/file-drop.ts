/**
 * FileDrop, broadsheet edition. The design's `Drop Zone` is a 1px dashed
 * `color.outline` box with no fill and no corner radius, 16px of padding
 * around 12px of gap: a 16px `color.text.secondary` upload mark, an
 * `$typography.caption` italic line in `color.text.primary`, and the
 * `$typography.exif` constraints in `color.text.disabled`.
 *
 * The queued file row is the same language at row scale: a `color.hairline`
 * box, `$typography.exif` for the name, `color.text.disabled` for the size.
 */
import { FileDrop as FoldkitFileDrop } from '@foldkit/ui'
import type { Html, HtmlBuilder } from 'foldkit/html'

type Child = Html | string

import { cn } from '@/lib/utils'

// Re-export the @foldkit/ui FileDrop submodel surface.

export const init = FoldkitFileDrop.init
export const update = FoldkitFileDrop.update
export const view = FoldkitFileDrop.view
export const Model = FoldkitFileDrop.Model
export type Model = typeof Model.Type
export const Message = FoldkitFileDrop.Message
export type Message = typeof Message.Type
export const OutMessage = FoldkitFileDrop.OutMessage
export type OutMessage = typeof OutMessage.Type

export type InitConfig = FoldkitFileDrop.InitConfig
export type ViewInputs = FoldkitFileDrop.ViewInputs
export type FileDropAttributes = FoldkitFileDrop.FileDropAttributes

export const fileDropClass =
  'group/file-drop flex cursor-pointer flex-col items-center justify-center gap-3 border border-dashed border-role-outline bg-transparent px-4 py-4 text-center text-role-text-primary outline-none transition-colors duration-120 hover:border-role-rule focus-visible:border-role-focus focus-visible:ring-[3px] focus-visible:ring-role-focus/50 data-[drag-over]:border-role-rule data-[drag-over]:bg-role-surface-container data-[disabled]:cursor-not-allowed data-[disabled]:text-role-text-disabled'

export const fileDropPrimaryTextClass = 'type-caption text-role-text-primary'

export const fileDropSecondaryTextClass = 'type-exif text-role-text-disabled'

export const fileRowClass =
  'group/file-row flex items-center justify-between gap-2 border-b border-role-hairline px-0 py-2'

export const fileNameClass = 'truncate type-exif text-role-text-primary'

export const fileSizeClass = 'type-exif text-role-text-disabled'

export const fileRemoveButtonClass =
  'inline-flex items-center justify-center text-role-text-disabled outline-none transition-colors duration-120 hover:text-role-accent focus-visible:ring-[3px] focus-visible:ring-role-focus/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0'

export type StyledViewInputs = Readonly<{
  multiple?: boolean
  isDisabled?: boolean
  accept?: ReadonlyArray<string>
  /** Drop zone content (hint text, etc.). */
  content: ReadonlyArray<Child>
  className?: string
}>

/** Build styled `FileDrop.ViewInputs`. Pass your view's `h`. */
export const styledViewInputs = <M>(
  viewInputs: StyledViewInputs,
  h: HtmlBuilder<M>,
): ViewInputs => ({
  ...(viewInputs.multiple !== undefined && { multiple: viewInputs.multiple }),
  ...(viewInputs.isDisabled !== undefined && { isDisabled: viewInputs.isDisabled }),
  ...(viewInputs.accept !== undefined && { accept: viewInputs.accept }),
  toView: (attributes) =>
    h.label(
      [
        ...attributes.root,
        h.DataAttribute('slot', 'file-drop'),
        h.Class(cn(fileDropClass, viewInputs.className)),
      ],
      [...viewInputs.content, h.input(attributes.input)],
    ),
})
