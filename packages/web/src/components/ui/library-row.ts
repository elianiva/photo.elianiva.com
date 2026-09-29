/**
 * Library Row — one Photo in the Library table (master `d8102c6e776b1223`), the
 * most complex atom in the set: a select box, a 64×64 thumb, the Title Block
 * (title over `NO. 024 · DSCF4821.JPG · KOTA TUA, JAKARTA`), the boxed Ratio, the
 * taken date, the size, the Status, and two ghost Icon Buttons.
 *
 * Two states. Default is a `color.hairline` rule under the row; selected fills
 * `color.surface.container` and lifts the thumb onto `color.surface`. The row's
 * widths come from `table-head.ts`, so a head and a row can never disagree on
 * a column.
 *
 * The row holds no state of its own — it is presentational, and every value on
 * it is composed by the page that owns the Photo. The `NO.` line in particular
 * is the page's to compose from the Photo Number, the original filename and the
 * place (see #25).
 *
 * `onSelect` makes the whole row a selection target, the way the design's frame
 * shows two rows ticked by clicking them. It rides a full-bleed button rather
 * than a click handler on the row element: the select box, the pencil and the
 * `⋯` all sit *inside* the row, and a bubbling click would run the row's
 * toggle and the control's own in the same gesture — a tick on the box that
 * visibly changes nothing, which is worse than no row click at all. The
 * controls above the overlay are the two `z-10` cells.
 */
import { MoreHorizontal, Pencil } from 'lucide'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils'

import { checkbox } from './checkbox'
import { iconButton } from './icon-button'
import { ratioTag } from './ratio-tag'
import { status } from './status'
import type { StatusVariant } from './status'
import { columnWidths, tableActionsWidthClass, tableCheckboxWidthClass } from './table-head'

export const libraryRowClass =
  'relative flex items-center gap-(--spacing-lg) border-b border-role-hairline px-(--spacing-md) py-(--spacing-md)'

/** The two cells that sit above the row's selection overlay. */
const overSelectionClass = 'relative z-10'

export type LibraryRowInputs<M> = Readonly<{
  id: string
  isSelected: boolean
  /** Dispatched when the select box is ticked. */
  onToggleSelection: M
  /** The Photo's PREVIEW rendition. Absent before the rendition exists, in
   *  which case the row shows its surface alone — the same box the grid paints
   *  while the preview is still being fetched. */
  thumb: Readonly<{ src?: string; alt: string }>
  title: string
  /** The `NO. 024 · DSCF4821.JPG · KOTA TUA, JAKARTA` line under the title. */
  fileLine: string
  ratio: string
  taken: string
  size: string
  status: StatusVariant
  onEdit?: M
  onMenu?: M
  /** Dispatched when the row itself is clicked. Omit it and the row is not a
   *  selection target and the design's selected state is unreachable by hand. */
  onSelect?: M
  className?: string
}>

/** One Photo in the Library table. */
export const libraryRow = <M>(inputs: LibraryRowInputs<M>, h: HtmlBuilder<M>): Html =>
  h.div(
    [
      h.Class(
        cn(
          libraryRowClass,
          inputs.isSelected ? 'bg-role-surface-container' : 'bg-transparent',
          inputs.className,
        ),
      ),
      h.DataAttribute('slot', 'library-row'),
      h.DataAttribute('selected', String(inputs.isSelected)),
    ],
    [
      ...(inputs.onSelect === undefined
        ? []
        : [
            h.button(
              [
                h.Type('button'),
                h.OnClick(inputs.onSelect),
                h.AriaLabel(`Select ${inputs.title}`),
                h.DataAttribute('slot', 'library-row-select'),
                h.Class(
                  'focus-visible:ring-role-focus/50 absolute inset-0 cursor-pointer focus-visible:ring-[3px] focus-visible:outline-none',
                ),
              ],
              [],
            ),
          ]),
      checkbox(
        {
          id: `library-row-${inputs.id}`,
          isChecked: inputs.isSelected,
          onToggle: () => inputs.onToggleSelection,
          label: inputs.thumb.alt,
          labelClass: 'sr-only',
          wrapperClass: cn(tableCheckboxWidthClass, overSelectionClass),
        },
        h,
      ),
      // A PREVIEW that has not landed yet is the surface alone, so the box is a
      // div: an <img> with no src paints the browser's broken-image glyph and
      // repeats the alt text inside it.
      inputs.thumb.src === undefined
        ? h.div([
            h.AriaHidden(true),
            h.Class(
              cn(
                'size-16 shrink-0',
                inputs.isSelected ? 'bg-role-surface' : 'bg-role-surface-container',
              ),
            ),
          ])
        : h.img([
            h.Src(inputs.thumb.src),
            h.Alt(inputs.thumb.alt),
            h.Attribute('loading', 'lazy'),
            h.Attribute('decoding', 'async'),
            h.Class(
              cn(
                'size-16 shrink-0 object-cover',
                inputs.isSelected ? 'bg-role-surface' : 'bg-role-surface-container',
              ),
            ),
          ]),
      h.div(
        // The photograph column is the one that flexes: the head's 520px is the
        // checkbox, the thumb and this block together, so the block takes the
        // remainder and the Ratio column below stays aligned either way.
        [h.Class('flex min-w-0 flex-1 flex-col gap-(--spacing-xs)')],
        [
          h.span([h.Class('type-body text-role-text-primary')], [inputs.title]),
          h.span([h.Class('type-exif text-role-text-disabled')], [inputs.fileLine]),
        ],
      ),
      h.div(
        [h.Class(cn('flex shrink-0 items-center', columnWidths.ratio))],
        [ratioTag({ ratio: inputs.ratio }, h)],
      ),
      h.span(
        [
          h.Class(
            cn('type-exif shrink-0 tabular-nums text-role-text-secondary', columnWidths.taken),
          ),
        ],
        [inputs.taken],
      ),
      h.span(
        [
          h.Class(
            cn('type-exif shrink-0 tabular-nums text-role-text-secondary', columnWidths.size),
          ),
        ],
        [inputs.size],
      ),
      h.div(
        [h.Class(cn('flex shrink-0 items-center', columnWidths.status))],
        [status({ variant: inputs.status }, h)],
      ),
      h.div(
        [
          h.Class(
            cn(
              'flex shrink-0 items-center justify-end',
              tableActionsWidthClass,
              overSelectionClass,
            ),
          ),
        ],
        [
          ...(inputs.onEdit === undefined
            ? []
            : [
                iconButton(
                  {
                    ariaLabel: `Edit ${inputs.title}`,
                    kind: 'ghost',
                    onClick: inputs.onEdit,
                  },
                  Pencil,
                  h,
                ),
              ]),
          ...(inputs.onMenu === undefined
            ? []
            : [
                iconButton(
                  {
                    ariaLabel: `More actions for ${inputs.title}`,
                    kind: 'ghost',
                    onClick: inputs.onMenu,
                  },
                  MoreHorizontal,
                  h,
                ),
              ]),
        ],
      ),
    ],
  )
