/**
 * The Library table — `Table Head` → `Library Row` × N → `Pager`, with the Bulk
 * Bar above the head whenever something is ticked. Design frame
 * `af93a41c4ee3f4a1`; the atoms it composes are `table-head.ts`,
 * `library-row.ts` and `pager.ts` from #23, so every column width, every state
 * and the `1–7 OF 412` line are theirs and this module is the page that hands
 * them values.
 *
 * Three row-scoped things the design states once and this module makes explicit:
 *
 *   - Clicking a row toggles its selection. The row is the selection target and
 *     the pencil is the Editor; they are different gestures on different
 *     elements, and `libraryRow`'s `onSelect` / `onEdit` are different messages.
 *   - The head's box is tri-state over *this page*, not over the filtered total.
 *   - `OF 412` is the filtered total from `ListLibraryRows`, and the Pager's
 *     range is the page's own first and last row.
 *
 * Two compositions the design states that no column carries: the original
 * filename, derived from `r2Key` rather than stored, and the Mat-less `SIZE`
 * cell, which prints the original's byte count because no read returns the
 * PREVIEW Rendition's. Both are commented where they happen.
 *
 * The tile grid this replaces stays on disk — `views/grid.ts` is #27's to
 * re-introduce as the grid view, and the error and empty-library states below
 * are its own, reused rather than duplicated.
 */

import type { Html, HtmlBuilder } from 'foldkit/html'
import type { PhotoWithTags } from '@photo/shared'

import * as Button from '@/components/ui/button'
import { checkbox } from '@/components/ui/checkbox'
import * as Dialog from '@/components/ui/dialog'
import { Empty } from '@/components/ui/empty'
import { libraryRow, libraryRowClass } from '@/components/ui/library-row'
import { pager } from '@/components/ui/pager'
import type { StatusVariant } from '@/components/ui/status'
import {
  columnWidths,
  tableActionsWidthClass,
  tableCheckboxWidthClass,
  tableHead,
} from '@/components/ui/table-head'
import { thumbUrl } from '@/lib/image'
import { cn } from '@/lib/utils'

import { LIBRARY_PAGE_SIZE, Message as M } from '../model'
import type { Model, Msg } from '../model'
import { grid } from './grid'
import type { Child } from './shared'
import { formatBytes } from './shared'

// ---------------------------------------------------------------------------
// row values
// ---------------------------------------------------------------------------

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** `31 AUG 2025`. `takenAt` is `YYYY-MM-DD` TEXT, so the three parts are read
 *  off the string rather than through a zone: the day a Photograph was taken
 *  must not depend on the reader's locale or offset. */
export const formatTaken = (takenAt: string | undefined): string => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(takenAt ?? '')
  if (parts === null) return '—'
  const month = MONTHS[Number(parts[2]) - 1]
  return month === undefined ? '—' : `${parts[3]} ${month} ${parts[1]}`
}

/** The operator's original filename, derived from `r2Key` rather than stored
 *  as a column: the key an upload already writes is
 *  `originals/{id}-{slug}.{ext}`, so the name is recoverable from the file that
 *  is actually in R2, and a fourth copy of it cannot drift from that. */
export const originalFilename = (r2Key: string): string => {
  const base = r2Key.slice(r2Key.lastIndexOf('/') + 1)
  return base.replace(/^[0-9A-Za-z]+-/, '')
}

/** `NO. 024 · DSCF4821.JPG · KOTA TUA, JAKARTA`, composed from the Photo
 *  Number, the original filename and the place. A Photograph carrying only some
 *  of them prints only those — the design's own `Untitled` row reads
 *  `DSCF4583.JPG` — rather than a line of separators with gaps in it. */
export const fileLine = (photo: PhotoWithTags): string => {
  const number = photo.number
  return [
    number === undefined || number === null ? '' : `NO. ${String(number).padStart(3, '0')}`,
    originalFilename(photo.r2Key),
    (photo.metadata?.location ?? '').trim().toUpperCase(),
  ]
    .filter((part) => part !== '')
    .join(' · ')
}

/** `scheduled` is deliberately unreachable: it is a display label over a draft
 *  with a future publish time and nothing records a publish time yet
 *  (CONTEXT.md, Status). */
const statusVariant = (photo: PhotoWithTags): StatusVariant =>
  photo.status === 'published' ? 'published' : photo.status === 'failed' ? 'failed' : 'draft'

const row = (photo: PhotoWithTags, model: Model, h: HtmlBuilder<Msg>): Child =>
  libraryRow(
    {
      id: photo.id,
      isSelected: model.selected.includes(photo.id),
      onToggleSelection: M.ToggledRowSelection({ id: photo.id }),
      onSelect: M.ToggledRowSelection({ id: photo.id }),
      thumb: { src: thumbUrl(photo), alt: photo.title },
      title: photo.title,
      fileLine: fileLine(photo),
      // A Ratio nobody has set yet prints the design's own `—` rather than a
      // box around a value the row does not carry.
      ratio: photo.ratio ?? '—',
      taken: formatTaken(photo.takenAt),
      // The design pairs the original with the PREVIEW Rendition
      // (`18.4 → 2.1 MB`). No column and no RPC returns the Rendition's byte
      // count, so the cell prints the one size it can read. Named on issue #25.
      size: photo.bytes === undefined || photo.bytes === null ? '—' : formatBytes(photo.bytes),
      status: statusVariant(photo),
      onEdit: M.OpenedPhoto({ id: photo.id }),
      onMenu: M.OpenedRowMenu({ id: photo.id }),
    },
    h,
  )

// ---------------------------------------------------------------------------
// the Bulk Bar
// ---------------------------------------------------------------------------

/** The Bulk Bar (master `2ee1012a86fa8715`). The design draws it inverted —
 *  `ds(, theme(dark))` — even on the light Library, and one `data-theme` on
 *  this element is the generated dark block saying the same thing: the role
 *  tokens below it resolve to their dark branch and nothing above it moves.
 *
 *  The box beside `2 SELECTED` is the design's own `state(on)`, so it reads as
 *  "a selection exists" and unticking it is `Clear` — which is the affordance
 *  printed beside it anyway.
 */
const bulkBar = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const count = model.selected.length
  return h.div(
    [
      h.Attribute('data-theme', 'dark'),
      h.DataAttribute('slot', 'bulk-bar'),
      h.Class(
        'flex items-center justify-between gap-(--spacing-lg) bg-role-surface py-(--spacing-sm) pr-(--spacing-md) pl-(--spacing-md)',
      ),
    ],
    [
      h.div(
        [h.Class('flex items-center gap-(--spacing-lg)')],
        [
          checkbox(
            {
              id: 'bulk-bar-selection',
              isChecked: true,
              onToggle: () => M.ClearedSelection(),
              label: `Clear the ${String(count)} selected`,
              labelClass: 'sr-only',
              wrapperClass: tableCheckboxWidthClass,
            },
            h,
          ),
          h.span([h.Class('type-kicker text-role-text-primary')], [`${String(count)} SELECTED`]),
          h.button(
            [
              h.Type('button'),
              h.OnClick(M.ClearedSelection()),
              h.Class(
                'type-caption cursor-pointer italic text-role-text-disabled transition-colors duration-(--motion-duration-fast) hover:text-role-text-primary',
              ),
            ],
            ['Clear'],
          ),
        ],
      ),
      h.div(
        [h.Class('flex items-center gap-(--spacing-xs)')],
        [
          // `Discard` here means "drop the selection" and nothing else. The
          // Editor's `Discard` — discard unsaved edits — is a different control
          // about a different thing; the collision is the design's.
          Button.button({ onClick: M.ClearedSelection(), variant: 'ghost' }, 'Discard', h),
          Button.button({ onClick: M.AddBorderToSelection(), variant: 'ghost' }, 'Add border', h),
          // The design's `Move to series`, re-pointed at `Add tag`: a Series
          // page *is* a Tag page (ADR 0008), so the grouping entity is the Tag.
          Button.button({ onClick: M.OpenedAddTag(), variant: 'ghost' }, 'Add tag', h),
          Button.button(
            { onClick: M.RequestBulkTrash({ count }), variant: 'destructive' },
            'Delete',
            h,
          ),
        ],
      ),
    ],
  )
}

/** The `Add tag` picker. A Dialog holding one box per Tag, because the design
 *  draws a single ghost button and no picker at all, and the Admin already
 *  creates Tags from the sidebar — inline create here would be a second
 *  convention for one thing. */
const addTagDialog = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.submodel({
    slotId: 'admin-add-tag-dialog',
    model: model.addTagDialog,
    view: Dialog.view,
    viewInputs: Dialog.styledViewInputs<Msg>(
      {
        panelClass: 'w-full max-w-sm',
        content: (render, innerH) => [
          h.div(
            [h.Class('flex flex-col gap-(--spacing-lg)')],
            [
              h.div(
                [h.Class('flex items-start justify-between gap-(--spacing-sm)')],
                [
                  Dialog.title({ attributes: render.title }, ['Add tag'], innerH),
                  Dialog.closeButton({ attributes: render.closeButton }, ['×'], innerH),
                ],
              ),
              model.tags.length === 0
                ? Dialog.description(
                    { attributes: render.description },
                    ['No Tags yet. Create one from the sidebar first.'],
                    innerH,
                  )
                : h.div(
                    [h.Role('group'), h.AriaLabel('Tags'), h.Class('flex flex-col')],
                    model.tags.map((tag) =>
                      checkbox(
                        {
                          id: `add-tag-${tag.id}`,
                          isChecked: model.addTagIds.includes(tag.id),
                          onToggle: () => M.ToggledAddTag({ id: tag.id }),
                          label: tag.label,
                          wrapperClass: 'py-(--spacing-xs)',
                        },
                        innerH,
                      ),
                    ),
                  ),
              h.div(
                [h.Class('flex justify-end gap-(--spacing-sm)')],
                [
                  Button.button(
                    {
                      onClick: M.GotAddTagDialogMessage({
                        message: Dialog.Message.RequestedClose(),
                      }),
                      variant: 'secondary',
                      attributes: [h.DataAttribute('slot', 'add-tag-cancel')],
                    },
                    'Cancel',
                    innerH,
                  ),
                  Button.button(
                    {
                      onClick: M.ConfirmAddTag(),
                      variant: 'default',
                      isDisabled: model.addTagIds.length === 0,
                      attributes: [h.DataAttribute('slot', 'add-tag-confirm')],
                    },
                    'Add tag',
                    innerH,
                  ),
                ],
              ),
            ],
          ),
        ],
      },
      h,
    ),
    toParentMessage: (message) => M.GotAddTagDialogMessage({ message }),
  })

/** The row `⋯` menu. `Publish` / `Unpublish` is the one row-scoped lifecycle
 *  move (`SetPhotoStatus`); `Move to Trash` is the destructive one and goes
 *  through the shared confirm Dialog rather than acting here. */
const rowMenu = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const photo = model.photos.find((candidate) => candidate.id === model.rowMenuId)
  return h.submodel({
    slotId: 'admin-row-menu',
    model: model.rowMenu,
    view: Dialog.view,
    viewInputs: Dialog.styledViewInputs<Msg>(
      {
        panelClass: 'w-full max-w-sm',
        content: (render, innerH) => [
          h.div(
            [h.Class('flex flex-col gap-(--spacing-lg)')],
            [
              h.div(
                [h.Class('flex items-start justify-between gap-(--spacing-sm)')],
                [
                  Dialog.title(
                    { attributes: render.title },
                    [photo === undefined ? 'Photograph' : photo.title],
                    innerH,
                  ),
                  Dialog.closeButton({ attributes: render.closeButton }, ['×'], innerH),
                ],
              ),
              h.div(
                [h.Class('flex flex-col')],
                photo === undefined
                  ? []
                  : [
                      Button.button(
                        {
                          onClick: M.SetRowStatus({
                            id: photo.id,
                            status: photo.status === 'published' ? 'draft' : 'published',
                          }),
                          variant: 'ghost',
                          className: 'justify-start',
                        },
                        photo.status === 'published' ? 'Unpublish' : 'Publish',
                        innerH,
                      ),
                      Button.button(
                        {
                          onClick: M.RequestedRowTrash({ id: photo.id, title: photo.title }),
                          variant: 'destructive',
                          className: 'justify-start',
                        },
                        'Move to Trash',
                        innerH,
                      ),
                    ],
              ),
            ],
          ),
        ],
      },
      h,
    ),
    toParentMessage: (message) => M.GotRowMenuMessage({ message }),
  })
}

// ---------------------------------------------------------------------------
// states
// ---------------------------------------------------------------------------

/** Whether anything narrows the list. #26 owns the whole filter state and the
 *  URL it will live in; the two filters the Admin has today are the sidebar's
 *  Tags and the Page Head's search. */
const hasFilter = (model: Model): boolean =>
  model.activeTagIds.length > 0 || model.searchQuery.trim() !== ''

/** The design's loading state: rows, not a spinner, drawn on the Library Row's
 *  own geometry so the Table Head's column widths hold while the page arrives
 *  and the table does not jump when it does. */
const skeletonTable = (h: HtmlBuilder<Msg>): Child => {
  const block = 'bg-role-surface-container animate-pulse'
  const one = (extra: string): Html => h.div([h.Class(cn('h-3', block, extra))], [])
  const skeletonRow = (): Child =>
    h.div(
      [
        h.Class(libraryRowClass),
        h.AriaHidden(true),
        h.DataAttribute('slot', 'library-skeleton-row'),
      ],
      [
        h.span([h.Class(tableCheckboxWidthClass)]),
        h.div([h.Class(cn('size-16 shrink-0', block))]),
        h.div(
          [h.Class('flex min-w-0 flex-1 flex-col gap-(--spacing-xs)')],
          [one('h-4 w-2/3'), one('w-1/3')],
        ),
        h.div([h.Class(cn('flex shrink-0 items-center', columnWidths.ratio))], [one('h-5 w-10')]),
        h.span([h.Class(cn('shrink-0', columnWidths.taken))], [one('w-16')]),
        h.span([h.Class(cn('shrink-0', columnWidths.size))], [one('w-16')]),
        h.span([h.Class(cn('shrink-0', columnWidths.status))]),
        h.span([h.Class(tableActionsWidthClass)]),
      ],
    )
  return h.div(
    [h.DataAttribute('slot', 'library-skeleton')],
    [tableHead({}, h), ...Array.from({ length: LIBRARY_PAGE_SIZE }, skeletonRow)],
  )
}

/** Nothing for the current filter. Not the same claim as an empty library: this
 *  one says the query is wrong and offers the way back, so it gets its own
 *  copy rather than the empty library's. #28 owns both bodies. */
const noMatchTable = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('mt-(--spacing-3xl)')],
    [
      Empty(
        { className: 'border border-dashed border-role-outline p-(--spacing-3xl)' },
        [
          Empty.header({}, [], h),
          Empty.title({}, ['Nothing matches this filter'], h),
          Empty.description(
            {},
            [
              'The Library has Photographs; this filter selects none of them.',
              ...(model.activeTagIds.length > 0
                ? [
                    h.button(
                      [
                        h.OnClick(M.ToggledTagFilter({ id: model.activeTagIds[0] ?? '' })),
                        h.Class(
                          'type-caption underline underline-offset-4 hover:text-role-text-primary',
                        ),
                      ],
                      ['Clear the Tag filter'],
                    ),
                  ]
                : []),
            ],
            h,
          ),
        ],
        h,
      ),
    ],
  )

// ---------------------------------------------------------------------------
// the table
// ---------------------------------------------------------------------------

export const libraryTable = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const body: Child =
    model.status === 'loading'
      ? skeletonTable(h)
      : model.status === 'error'
        ? // The error state and its Retry are the grid's, and they are still
          // the truth about a list that could not be read.
          grid(model, h)
        : model.photos.length === 0
          ? hasFilter(model)
            ? noMatchTable(model, h)
            : grid(model, h)
          : h.div(
              [h.DataAttribute('slot', 'library-table')],
              [
                ...(model.selected.length > 0 ? [bulkBar(model, h)] : []),
                tableHead(
                  {
                    selection: headSelection(model),
                    sortedBy: 'taken',
                  },
                  h,
                ),
                ...model.photos.map((photo) => row(photo, model, h)),
                pager({ ...pagerPage(model), className: 'border-t border-role-hairline' }, h),
              ],
            )
  return h.div([], [body, rowMenu(model, h), addTagDialog(model, h)])
}

/** The head's tri-state box, measured over the page. `1–7 OF 412` is a page of
 *  seven out of a filtered total, so "all" means the seven the operator can
 *  see — ticking past them would be a selection over rows this page is not
 *  showing. */
const headSelection = (model: Model) => {
  const ids = model.photos.map((photo) => photo.id)
  const ticked = ids.filter((id) => model.selected.includes(id)).length
  return {
    isChecked: ids.length > 0 && ticked === ids.length,
    ...(ticked > 0 && ticked < ids.length ? { isIndeterminate: true } : {}),
    ariaLabel: 'Select every photograph on this page',
    onToggle: M.ToggledPageSelection(),
  }
}

/** The Pager's own arithmetic: the page's first and last row, and the filtered
 *  total behind them. */
const pagerPage = (model: Model) => {
  const from = model.libraryPage * LIBRARY_PAGE_SIZE + 1
  return {
    from,
    to: from + model.photos.length - 1,
    total: model.libraryTotal,
    onPrevious: M.SteppedLibraryPage({ delta: -1 }),
    onNext: M.SteppedLibraryPage({ delta: 1 }),
    isPreviousDisabled: model.libraryPage === 0,
    isNextDisabled: model.nextCursor === null,
  }
}
