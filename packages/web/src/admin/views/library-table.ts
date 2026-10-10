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
 * The tile grid beside it — `views/grid.ts` — is the other view over the same
 * read, reachable from the Library's view toggle; both draw the shared Pager
 * and the shared error / filtered-empty states, so switching views keeps the
 * page, the rows and the message in step.
 */

import type { Html, HtmlBuilder } from 'foldkit/html'
import type { PhotoWithTags } from '@photo/shared'

import * as Button from '@/components/ui/button'
import { checkbox } from '@/components/ui/checkbox'
import * as Dialog from '@/components/ui/dialog'
import * as Input from '@/components/ui/input'
import { libraryRow, libraryRowClass } from '@/components/ui/library-row'
import type { StatusVariant } from '@/components/ui/status'
import {
  columnWidths,
  tableActionsWidthClass,
  tableCheckboxWidthClass,
  tableHead,
} from '@/components/ui/table-head'
import { smallUrl } from '@/lib/image'
import { cn } from '@/lib/utils'

import { bulkDetailsPatch, parseExifNumber, parseShutter } from '../editor'
import { LIBRARY_PAGE_SIZE, Message as M } from '../model'
import type { BulkDetailField, Model, Msg } from '../model'
import { libraryEmpty } from './library-empty'
import { libraryPager } from './library-pager'
import { libraryError, libraryIsEmpty, libraryNoMatch } from './library-states'
import type { Child } from './shared'

// ---------------------------------------------------------------------------
// row values
// ---------------------------------------------------------------------------

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** `31 AUG 2025`. The three parts are read off the string rather than through a
 *  zone: the day a Photograph was taken must not depend on the reader's locale
 *  or offset. Only the leading `YYYY-MM-DD` is read, so a stored value that
 *  carries a time as well — `2026-06-11T14:27`, which is what the upload writes
 *  when the file's own EXIF names an hour — prints its day rather than a dash.
 *  `@photo/shared`'s `dayMonth` reads the same prefix for the same reason. */
export const formatTaken = (takenAt: string | undefined): string => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(takenAt?.trim() ?? '')
  if (parts === null) return '—'
  const month = MONTHS[Number(parts[2]) - 1]
  return month === undefined ? '—' : `${parts[3]} ${month} ${parts[1]}`
}

/** The leading id an upload mints for the key. The upload composes
 *  `originals/{uuid}-{slug}.{ext}` from a fresh `crypto.randomUUID()`, so the
 *  id is a UUID and never this Photo's own id — the name is what is left once
 *  the whole uuid is off, not once its first dash-segment is. */
const KEY_UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i

/** The operator's original filename, derived from `r2Key` rather than stored
 *  as a column: the key an upload already writes is
 *  `originals/{uuid}-{slug}.{ext}`, so the name is recoverable from the file
 *  that is actually in R2, and a fourth copy of it cannot drift from that. A
 *  key that carries no uuid — a seeded row, an original placed in R2 by hand —
 *  is already a name and is printed whole. */
export const originalFilename = (r2Key: string): string => {
  const base = r2Key.slice(r2Key.lastIndexOf('/') + 1)
  return base.replace(KEY_UUID_PREFIX, '')
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
      thumb: { src: smallUrl(photo), alt: photo.title },
      title: photo.title,
      fileLine: fileLine(photo),
      // A Ratio nobody has set yet prints the design's own `—` rather than a
      // box around a value the row does not carry.
      ratio: photo.ratio ?? '—',
      taken: formatTaken(photo.takenAt),
      // The design's `SIZE` cell pairs the original's bytes with the PREVIEW
      // Rendition's (`18.4 → 2.1 MB`). No read returns the Rendition's, and the
      // original's is a column only an upload writes — every row of the Library
      // as it stands read `—`. The measured frame is always there, so the cell
      // prints that instead. Named on issue #25.
      dimensions: `${String(photo.width)} × ${String(photo.height)}`,
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
 *  `ds(, theme(dark))` — against the page it sits on, and one `data-theme` on
 *  this element is the opposite scope saying the same thing: the role tokens below
 *  it resolve to their dark branch and nothing above it moves.
 *
 *  The box beside `2 SELECTED` is the design's own `state(on)`, so it reads as
 *  "a selection exists" and unticking it is `Clear` — which is the affordance
 *  printed beside it anyway.
 */
export const bulkBar = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const count = model.selected.length
  return h.div(
    [
      h.Attribute('data-theme', 'light'),
      h.DataAttribute('slot', 'bulk-bar'),
      h.Class('flex items-center justify-between gap-4 bg-role-surface py-2 pr-3 pl-3'),
    ],
    [
      h.div(
        [h.Class('flex items-center gap-4')],
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
          h.span([h.Class('type-label text-role-text-primary')], [`${String(count)} SELECTED`]),
          h.button(
            [
              h.Type('button'),
              h.OnClick(M.ClearedSelection()),
              h.Class(
                'type-caption cursor-pointer italic text-role-text-disabled transition-colors duration-120 hover:text-role-text-primary',
              ),
            ],
            ['Clear'],
          ),
        ],
      ),
      h.div(
        [h.Class('flex items-center gap-1')],
        [
          // `Discard` here means "drop the selection" and nothing else. The
          // Editor's `Discard` — discard unsaved edits — is a different control
          // about a different thing; the collision is the design's.
          Button.button({ onClick: M.ClearedSelection(), variant: 'ghost' }, 'Discard', h),
          Button.button({ onClick: M.AddBorderToSelection(), variant: 'ghost' }, 'Add border', h),
          Button.button(
            { onClick: M.SetSelectionStatus({ status: 'draft' }), variant: 'ghost' },
            'Unpublish',
            h,
          ),
          Button.button(
            { onClick: M.SetSelectionStatus({ status: 'published' }), variant: 'accent' },
            'Publish',
            h,
          ),
          // The design's `Move to series`, re-pointed at `Add tag`: a Series
          // page *is* a Tag page (ADR 0006), so the grouping entity is the Tag.
          Button.button({ onClick: M.OpenedAddTag(), variant: 'ghost' }, 'Edit', h),
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

/** The Bulk Bar's `Edit` dialog: Tags to add, Tags to remove and the details
 *  to set, applied to every ticked Photo in one confirm. A Dialog because the
 *  design draws a single ghost button and no picker. Every field is optional
 *  and a blank one leaves each Photo's own value alone, so the dialog can only
 *  ever add information, never blank it. A Tag is created inline from the
 *  upload Dialog's combo, so the one place a new label is typed is the one
 *  place a Tag comes from — a second create field here would be a second
 *  convention for one thing. */
const detailField = (
  model: Model,
  field: BulkDetailField,
  label: string,
  h: HtmlBuilder<Msg>,
  options: { type?: 'date'; placeholder?: string; invalid?: boolean } = {},
): Child =>
  Input.input(
    {
      id: `bulk-edit-${field}`,
      label,
      value: model.bulkDetails[field],
      className: 'h-auto',
      placeholder: options.placeholder ?? 'Leave unchanged',
      isInvalid: options.invalid === true,
      ...(options.type === undefined ? {} : { type: options.type }),
      onInput: (value) => M.SetBulkDetail({ field, value }),
    },
    h,
  )

export const addTagDialog = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const { patch, invalid } = bulkDetailsPatch(model.bulkDetails)
  const nothing =
    model.addTagIds.length === 0 &&
    model.removeTagIds.length === 0 &&
    Object.keys(patch).length === 0
  const numberInvalid = (field: 'focalLength' | 'aperture' | 'iso'): boolean =>
    parseExifNumber(model.bulkDetails[field]) === undefined
  const tagList = (
    heading: string,
    ids: ReadonlyArray<string>,
    prefix: string,
    toggle: (id: string) => Msg,
    innerH: HtmlBuilder<Msg>,
  ): Child =>
    h.div(
      [h.Role('group'), h.AriaLabel(heading), h.Class('flex flex-col')],
      [
        h.span([h.Class('type-label text-role-text-secondary')], [heading.toUpperCase()]),
        ...model.tags.map((tag) =>
          checkbox(
            {
              id: `${prefix}-${tag.id}`,
              isChecked: ids.includes(tag.id),
              onToggle: () => toggle(tag.id),
              label: tag.label,
              wrapperClass: 'py-1',
            },
            innerH,
          ),
        ),
      ],
    )
  return h.submodel({
    slotId: 'admin-add-tag-dialog',
    model: model.addTagDialog,
    view: Dialog.view,
    viewInputs: Dialog.styledViewInputs<Msg>(
      {
        panelClass: 'max-h-[90dvh] w-full max-w-md overflow-y-auto',
        content: (render, innerH) => [
          h.div(
            [h.Class('flex flex-col gap-5')],
            [
              h.div(
                [h.Class('flex items-start justify-between gap-2')],
                [
                  Dialog.title(
                    { attributes: render.title },
                    [`Edit ${String(model.selected.length)} selected`],
                    innerH,
                  ),
                  Dialog.closeButton({ attributes: render.closeButton }, ['×'], innerH),
                ],
              ),
              Dialog.description(
                { attributes: render.description },
                ['Only what you fill in changes. Blank fields leave each photograph as it is.'],
                innerH,
              ),
              model.tags.length === 0
                ? h.p(
                    [h.Class('type-body m-0 text-role-text-secondary italic')],
                    ['No tags yet. Type a new label in the upload dialog to create one.'],
                  )
                : h.div(
                    [h.Class('grid grid-cols-2 gap-4')],
                    [
                      tagList(
                        'Add tags',
                        model.addTagIds,
                        'add-tag',
                        (id) => M.ToggledAddTag({ id }),
                        innerH,
                      ),
                      tagList(
                        'Remove tags',
                        model.removeTagIds,
                        'remove-tag',
                        (id) => M.ToggledRemoveTag({ id }),
                        innerH,
                      ),
                    ],
                  ),
              detailField(model, 'location', 'PLACE', h),
              detailField(model, 'takenAt', 'TAKEN', h, { type: 'date', placeholder: '' }),
              detailField(model, 'camera', 'CAMERA', h),
              detailField(model, 'lens', 'LENS', h),
              h.div(
                [h.Class('grid grid-cols-2 gap-3')],
                [
                  detailField(model, 'focalLength', 'FOCAL LENGTH (MM)', h, {
                    invalid: numberInvalid('focalLength'),
                  }),
                  detailField(model, 'aperture', 'APERTURE (F/)', h, {
                    invalid: numberInvalid('aperture'),
                  }),
                  detailField(model, 'shutter', 'SHUTTER (S)', h, {
                    placeholder: 'Leave unchanged · 1/250',
                    invalid: parseShutter(model.bulkDetails.shutter) === undefined,
                  }),
                  detailField(model, 'iso', 'ISO', h, { invalid: numberInvalid('iso') }),
                ],
              ),
              h.div(
                [h.Class('flex justify-end gap-2')],
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
                      isDisabled: nothing || invalid,
                      attributes: [h.DataAttribute('slot', 'add-tag-confirm')],
                    },
                    'Apply',
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
}

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
            [h.Class('flex flex-col gap-4')],
            [
              h.div(
                [h.Class('flex items-start justify-between gap-2')],
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
        h.div([h.Class('flex min-w-0 flex-1 flex-col gap-1')], [one('h-4 w-2/3'), one('w-1/3')]),
        h.div(
          [h.Class(cn('flex shrink-0 items-center max-md:hidden', columnWidths.ratio))],
          [one('h-5 w-10')],
        ),
        h.span([h.Class(cn('shrink-0 max-md:hidden', columnWidths.taken))], [one('w-16')]),
        h.span([h.Class(cn('shrink-0 max-md:hidden', columnWidths.dimensions))], [one('w-16')]),
        h.span([h.Class(cn('shrink-0 max-md:hidden', columnWidths.status))]),
        h.span([h.Class(tableActionsWidthClass)]),
      ],
    )
  return h.div(
    [h.DataAttribute('slot', 'library-skeleton')],
    [tableHead({}, h), ...Array.from({ length: LIBRARY_PAGE_SIZE }, skeletonRow)],
  )
}

// ---------------------------------------------------------------------------
// the table
// ---------------------------------------------------------------------------

export const libraryTable = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const body: Child =
    model.status === 'loading'
      ? skeletonTable(h)
      : model.status === 'error'
        ? libraryError(model, h)
        : model.photos.length === 0
          ? libraryIsEmpty(model)
            ? libraryEmpty(h)
            : libraryNoMatch(model, h)
          : h.div(
              [h.DataAttribute('slot', 'library-table')],
              [
                ...(model.selected.length > 0 ? [bulkBar(model, h)] : []),
                tableHead(
                  {
                    selection: headSelection(model),
                    sortedBy: 'taken',
                    sortDirection: model.sortFilter === 'oldest' ? 'asc' : 'desc',
                    onToggleSort: M.ToggledSort(),
                  },
                  h,
                ),
                ...model.photos.map((photo) => row(photo, model, h)),
                libraryPager(model, h),
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
