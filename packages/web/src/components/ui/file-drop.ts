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
  'group/file-drop flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card px-6 py-10 text-center text-card-foreground outline-none transition-colors hover:border-primary/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[drag-over]:border-primary data-[drag-over]:bg-accent data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50'

export const fileDropPrimaryTextClass = 'text-base font-medium'

export const fileDropSecondaryTextClass = 'text-sm text-muted-foreground'

export const fileRowClass =
  'group/file-row flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2'

export const fileNameClass = 'truncate text-sm font-medium'

export const fileSizeClass = 'text-xs text-muted-foreground'

export const fileRemoveButtonClass =
  'inline-flex items-center justify-center rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-destructive focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0'

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
