/**
 * A Library with no Photographs at all — design frame `b473b2e8ce68277f`,
 * element `2161077797e7c26b`. Not the filtered-empty state, which is a
 * different claim about a Library that has Photographs and is hiding them
 * (`library-table.ts` owns that one).
 *
 * The two pickers are real: a `<label>` wrapping a hidden file input opens the
 * OS picker where a `<button>` cannot. Both route through the upload queue's
 * own intake, so size limits, the file cap, dedupe and previews are the drop
 * zone's behaviour rather than a second copy of it.
 */

import type { HtmlBuilder } from 'foldkit/html'
import { Images } from 'lucide'
import { PHOTO_RATIOS } from '@photo/shared'

import * as Button from '@/components/ui/button'
import { Empty } from '@/components/ui/empty'
import { icon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { Message as M, UPLOAD_ACCEPT } from '../model'
import type { Msg } from '../model'
import type { Child } from './shared'

/** A `<label>` wrapping a file input is what opens a picker; a `<button>` that
 *  dispatched a message could not. `buttonClass` supplies the geometry, and
 *  `has-[:focus-visible]:` re-aims the Button's keyboard ring at the label —
 *  the input inside it is what actually takes focus. */
const pickerFocusClass =
  'has-[:focus-visible]:border-role-focus has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-role-focus/50'

type PickerConfig = Readonly<{
  variant: Button.ButtonVariant
  label: string
  /** `webkitdirectory`: the picker answers with a folder's photographs rather
   *  than with one multi-select of files. */
  isDirectory?: boolean
}>

const picker = (config: PickerConfig, h: HtmlBuilder<Msg>): Child =>
  h.label(
    [
      h.Class(
        cn(
          Button.buttonClass(config.variant),
          // A `<label>` is inline, so unlike a `<button>` it does not centre its
          // text in the 36px box on its own.
          'inline-flex cursor-pointer items-center justify-center whitespace-nowrap',
          pickerFocusClass,
        ),
      ),
    ],
    [
      config.label,
      h.input([
        h.Type('file'),
        h.Class('sr-only'),
        h.Multiple(true),
        h.Accept(UPLOAD_ACCEPT.join(',')),
        h.OnFileChange((files) => M.ImportedFiles({ files: [...files] })),
        ...(config.isDirectory === true ? [h.Attribute('webkitdirectory', '')] : []),
      ]),
    ],
  )

/** The Ratio whitelist as the promise the design prints, read off
 *  `PHOTO_RATIOS` rather than written out so a change to the whitelist cannot
 *  leave this sentence behind. */
const ratioPromise = `${PHOTO_RATIOS.join(' · ')} · ORIGINALS ARE KEPT`

export const libraryEmpty = (h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('mt-6 flex flex-col gap-6')],
    [
      Empty(
        // `flex-none` because the atom's `flex-1` would otherwise let the
        // 240px height lose to a zero flex-basis.
        { className: 'h-[240px] flex-none gap-2 p-6' },
        [
          Empty.media(
            // The icon variant's 48px box and `mb-1` are not the
            // design's: a 32px mark with only the container's own 8px above it.
            { variant: 'icon', className: 'mb-0 size-8' },
            [icon(h, Images, 'size-8')],
            h,
          ),
          Empty.title({}, ['No photographs yet'], h),
          // The design's own max is the block's full inner width, not the
          // atom's `max-w-sm`.
          Empty.description(
            { className: 'w-full' },
            ['Drop your first photograph, or choose files from this computer.'],
            h,
          ),
          Empty.content(
            { className: 'max-w-none flex-row justify-center' },
            [
              picker({ variant: 'default', label: 'Choose files' }, h),
              picker({ variant: 'secondary', label: 'Import from a folder', isDirectory: true }, h),
            ],
            h,
          ),
        ],
        h,
      ),
      h.p([h.Class('w-full text-center type-exif text-role-text-disabled')], [ratioPromise]),
    ],
  )
