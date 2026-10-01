/**
 * Drop Zone — the design's upload strip (master `38385a020abcd472`), the
 * vendored `file-drop` dressed as one: a 1px dashed `color.outline` box with no
 * fill and no corner radius, holding a 16px `color.text.secondary` upload mark,
 * the italic `$typography.caption` line in `color.text.primary`, and the
 * `$typography.exif` constraints in `color.text.secondary` — the rules a file
 * has to meet, which are information rather than a disabled control, and
 * `color.text.disabled` is 3.6:1 on the page's surface.
 *
 * The atom owns the strip's composition, not its copy: `message` and
 * `constraints` are the caller's, so the upload rules (JPEG only, the size
 * ceiling) are stated where they are decided rather than baked in here.
 */
import { Upload } from 'lucide'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { icon } from '@/lib/icons'

import * as FileDrop from './file-drop'

type Child = Html | string

export type DropZoneConfig = Readonly<{
  /** The call to action — `Drop photographs to upload`. */
  message: string
  /** What the field will take — `JPEG · UP TO 80 MB`. */
  constraints: string
  multiple?: boolean
  accept?: ReadonlyArray<string>
  isDisabled?: boolean
  className?: string
}>

/** The Drop Zone's three parts, as a horizontal strip. */
export const dropZoneContent = <M>(
  config: Pick<DropZoneConfig, 'message' | 'constraints'>,
  h: HtmlBuilder<M>,
): ReadonlyArray<Child> => [
  icon(h, Upload, 'size-4 shrink-0 text-role-text-secondary'),
  h.span([h.Class('type-caption italic text-role-text-primary')], [config.message]),
  h.span([h.Class('type-exif text-role-text-secondary')], [config.constraints]),
]

/** View inputs for the vendored FileDrop, drawn as the design's strip. */
export const dropZone = <M>(config: DropZoneConfig, h: HtmlBuilder<M>): FileDrop.ViewInputs =>
  FileDrop.styledViewInputs<M>(
    {
      ...(config.multiple !== undefined && { multiple: config.multiple }),
      ...(config.accept !== undefined && { accept: config.accept }),
      ...(config.isDisabled !== undefined && { isDisabled: config.isDisabled }),
      ...(config.className !== undefined && { className: config.className }),
      content: dropZoneContent(config, h),
    },
    h,
  )
