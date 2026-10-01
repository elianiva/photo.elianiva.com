/**
 * `/admin/atoms` — the Desk's design-system sheet. Every atom in
 * `components/ui`, drawn once in the place the design draws it, at the design's
 * own size and in its own broadsheet branch.
 *
 * The sheet exists because the atoms have no product page yet: the Library
 * table is #25, the Page Head is #24, the Editor panels are #30–#34. Until each
 * of those lands there is nothing else that would render an atom at its real
 * width, and a component nobody has drawn is a component nobody has checked.
 *
 * Nothing here is a mock. The Segment groups, the Table Head's tri-state box,
 * the rows, the Pager's page maths and the Drop Zone are the real atoms with
 * real messages behind them; the specimen values are the design's own, so a
 * drift from the canvas shows up as a diff. The Editor panel is drawn in the
 * dark branch so every atom is proved to follow the theme scope.
 *
 * Nothing links here yet; #24 owns the sidebar.
 */

import type { Html, HtmlBuilder } from 'foldkit/html'
import { Upload } from 'lucide'

import * as DropZone from '@/components/ui/drop-zone'
import * as FileDrop from '@/components/ui/file-drop'
import * as IconButton from '@/components/ui/icon-button'
import * as Input from '@/components/ui/input'
import * as LibraryRow from '@/components/ui/library-row'
import * as NavLink from '@/components/ui/nav-link'
import * as Pager from '@/components/ui/pager'
import * as RatioTag from '@/components/ui/ratio-tag'
import * as Search from '@/components/ui/search'
import * as Segment from '@/components/ui/segment'
import * as SpecRow from '@/components/ui/spec-row'
import * as Status from '@/components/ui/status'
import * as Swatch from '@/components/ui/swatch'
import * as TableHead from '@/components/ui/table-head'
import * as Textarea from '@/components/ui/textarea'
import * as ToggleRow from '@/components/ui/toggle-row'

import { cn } from '@/lib/utils'

import {
  MAT_LABELS,
  PAGE_SIZE,
  PHOTOGRAPH_TITLE,
  TOTAL_PHOTOS,
  matColours,
  pageCount,
  sheetSegments,
  specimenRowsOnPage,
  type SheetSegment,
} from '../atoms-sheet'
import { atomsRouter } from '../route'
import { Message as M, UPLOAD_CONSTRAINTS } from '../model'
import type { Model, Msg } from '../model'
import type { Child } from './shared'

const sheetSegment = (model: Model, group: SheetSegment, h: HtmlBuilder<Msg>): Html => {
  const { id, selected, ...viewInputs } = group
  return h.submodel({
    slotId: id,
    model: Segment.readGroup(model.segmentGroups, id) ?? Segment.init({ id, selected }),
    view: Segment.view,
    viewInputs,
    toParentMessage: (message) => M.GotSegmentMessage({ groupId: id, message }),
  })
}

const segmentNamed = (id: string): SheetSegment => {
  const group = sheetSegments.find((candidate) => candidate.id === id)
  if (group === undefined) throw new Error(`the atoms sheet has no Segment group "${id}"`)
  return group
}

// ---------------------------------------------------------------------------
// sheet furniture
// ---------------------------------------------------------------------------

/** A named band: the atom's name over a 3px `color.rule` rule, its states
 *  beneath. The design's specimen cells, in the Admin's own gutters. */
const band = (name: string, h: HtmlBuilder<Msg>, ...children: ReadonlyArray<Child>): Html =>
  h.section(
    [h.Class('mt-(--spacing-2xl) flex flex-col gap-(--spacing-lg)')],
    [
      h.h3(
        [
          h.Class(
            'type-kicker border-b-[3px] border-b-role-rule pb-(--spacing-sm) text-role-text-primary',
          ),
        ],
        [name],
      ),
      h.div([h.Class('flex flex-col gap-(--spacing-lg)')], children),
    ],
  )

/** A specimen's name over its atom. `items-start` keeps a content-sized atom at
 *  its own width; the Editor panel passes `STRETCH`, because there the design's
 *  controls fill the 312px inspector column. */
const labelled = (
  label: string,
  body: Child,
  h: HtmlBuilder<Msg>,
  className = 'items-start',
): Html =>
  h.div(
    [h.Class(cn('flex flex-col gap-(--spacing-sm)', className))],
    [h.span([h.Class('type-kicker text-role-text-disabled')], [label]), body],
  )

/** The alignment the Editor inspector's rows use: its controls are `fill` of the
 *  panel's content column, not content-sized. */
const STRETCH = 'items-stretch'

/** A wrapping row of variants — the design's specimen cell layout. */
const variants = (h: HtmlBuilder<Msg>, ...children: ReadonlyArray<Child>): Html =>
  h.div([h.Class('flex flex-wrap items-center gap-(--spacing-md)')], children)

/** The Editor is the one broadsheet branch that is dark, so the sheet draws a
 *  panel in it and every atom above proves it follows the theme scope. */
const darkPanel = (body: Child, h: HtmlBuilder<Msg>): Html =>
  h.div(
    [
      h.Attribute('data-theme', 'dark'),
      // `w-fit`, not a full row: the design's Inspector is 360px and the panel
      // is drawn at that width, not at the sheet's.
      h.Class('w-fit bg-role-surface-container p-(--spacing-xl) text-role-text-primary'),
    ],
    [body],
  )

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------

const segmentBand = (model: Model, h: HtmlBuilder<Msg>): Html =>
  band(
    'Segment',
    h,
    labelled(
      'Status filter · color.rule box',
      sheetSegment(model, segmentNamed('atoms-status-filter'), h),
      h,
    ),
    labelled(
      'Ratio filter · color.outline box',
      sheetSegment(model, segmentNamed('atoms-ratio-filter'), h),
      h,
    ),
    labelled('Format · equal thirds', sheetSegment(model, segmentNamed('atoms-format'), h), h),
  )

const statusBand = (h: HtmlBuilder<Msg>): Html =>
  band(
    'Status',
    h,
    variants(
      h,
      ...Status.statusVariantKeys.map((variant) =>
        Status.status({ variant, className: 'min-w-32' }, h),
      ),
    ),
  )

const ratioTagBand = (h: HtmlBuilder<Msg>): Html =>
  band(
    'Ratio Tag',
    h,
    variants(
      h,
      ...['3:2', '2:3', '4:3', '3:4', '16:9', '9:16'].map((ratio) =>
        RatioTag.ratioTag({ ratio }, h),
      ),
    ),
  )

const iconButtonBand = (h: HtmlBuilder<Msg>): Html =>
  band(
    'Icon Button',
    h,
    variants(
      h,
      ...IconButton.iconButtonKindKeys.map((kind) =>
        IconButton.iconButton({ ariaLabel: `${kind} icon button`, title: kind, kind }, Upload, h),
      ),
    ),
  )

const navLinkBand = (h: HtmlBuilder<Msg>): Html =>
  band(
    'Nav Link',
    h,
    variants(
      h,
      NavLink.navLink({ href: atomsRouter(), label: 'STREET', state: 'active' }, h),
      NavLink.navLink({ href: atomsRouter(), label: 'LANDSCAPE', state: 'default' }, h),
    ),
  )

const specRowBand = (h: HtmlBuilder<Msg>): Html =>
  band(
    'Spec Row',
    h,
    h.dl(
      [h.Class('flex w-130 flex-col')],
      [
        SpecRow.specRow({ label: 'APERTURE', value: 'F/1.8' }, h),
        SpecRow.specRow({ label: 'SHUTTER', value: '1/250 s' }, h),
        SpecRow.specRow({ label: 'ISO', value: '400' }, h),
        SpecRow.specRow({ label: 'FOCAL LENGTH', value: '35 mm' }, h),
      ],
    ),
  )

const fieldBand = (model: Model, h: HtmlBuilder<Msg>): Html =>
  band(
    'Field',
    h,
    variants(
      h,
      h.div(
        [h.Class('w-72')],
        [
          // The design's TITLE Field is the master at two lines: the value is
          // `$typography.body` prose and it wraps. Drawn as the growing
          // `Textarea` the Editor's own TITLE uses, so the sheet shows the
          // 78.41px the canvas draws rather than a one-line input.
          Textarea.textarea(
            {
              id: 'atoms-field-title',
              label: 'TITLE',
              value: model.atoms.inputs['atoms-field-title'] ?? PHOTOGRAPH_TITLE,
              className: 'min-h-9',
              onInput: (value) => M.SetAtomInput({ id: 'atoms-field-title', value }),
            },
            h,
          ),
        ],
      ),
      h.div(
        [h.Class('w-72')],
        [
          Input.input(
            {
              id: 'atoms-field-place',
              label: 'PLACE',
              value: model.atoms.inputs['atoms-field-place'] ?? '',
              placeholder: 'Kota Tua, Jakarta',
              onInput: (value) => M.SetAtomInput({ id: 'atoms-field-place', value }),
            },
            h,
          ),
        ],
      ),
    ),
  )

const toggleRowBand = (model: Model, h: HtmlBuilder<Msg>): Html =>
  band(
    'Toggle Row',
    h,
    variants(
      h,
      h.div(
        [h.Class('w-90')],
        [
          ToggleRow.toggleRow(
            {
              id: 'atoms-exif',
              label: 'Keep EXIF data',
              isChecked: model.atoms.switches['atoms-exif'] ?? true,
              onToggle: (isChecked) => M.ToggledAtomSwitch({ id: 'atoms-exif', isChecked }),
            },
            h,
          ),
          ToggleRow.toggleRow(
            {
              id: 'atoms-gps',
              label: 'Remove GPS location',
              isChecked: model.atoms.switches['atoms-gps'] ?? false,
              onToggle: (isChecked) => M.ToggledAtomSwitch({ id: 'atoms-gps', isChecked }),
            },
            h,
          ),
        ],
      ),
    ),
  )

const swatchRow = (model: Model, h: HtmlBuilder<Msg>): Html =>
  variants(
    h,
    ...matColours.map((colour) =>
      Swatch.swatch(
        {
          colour,
          label: MAT_LABELS[colour],
          isSelected: model.atoms.matColour === colour,
          onSelect: M.PickedAtomMat({ colour }),
        },
        h,
      ),
    ),
  )

const swatchBand = (model: Model, h: HtmlBuilder<Msg>): Html =>
  band('Swatch', h, swatchRow(model, h))

const searchBand = (model: Model, h: HtmlBuilder<Msg>): Html =>
  band(
    'Search',
    h,
    variants(
      h,
      h.div(
        [h.Class('w-65')],
        [
          Search.search(
            {
              id: 'atoms-search',
              value: model.atoms.inputs['atoms-search'] ?? '',
              onInput: (value) => M.SetAtomInput({ id: 'atoms-search', value }),
              placeholder: 'Search photographs',
            },
            h,
          ),
        ],
      ),
      h.div(
        [h.Class('w-65')],
        [
          // The keycap is drawn because the page that owns the shortcut asks for
          // it; here it is the specimen's own address bar hint.
          Search.search(
            {
              id: 'atoms-search-hint',
              value: model.atoms.inputs['atoms-search-hint'] ?? '',
              onInput: (value) => M.SetAtomInput({ id: 'atoms-search-hint', value }),
              placeholder: 'Search photographs',
              hint: '⌘K',
            },
            h,
          ),
        ],
      ),
    ),
  )

const dropZoneBand = (model: Model, h: HtmlBuilder<Msg>): Html =>
  band(
    'Drop Zone',
    h,
    h.submodel({
      slotId: 'atoms-drop-zone',
      model: model.fileDrop,
      view: FileDrop.view,
      viewInputs: DropZone.dropZone(
        {
          message: 'Drop photographs to upload',
          constraints: UPLOAD_CONSTRAINTS,
          accept: ['image/jpeg'],
          className: 'flex-row justify-start',
        },
        h,
      ),
      toParentMessage: (message) => M.GotFileDropMessage({ message }),
    }),
  )

/** The Library table: the head, this page's rows, and the Pager. The numbers
 *  are the design's (`1–7 OF 412`, seven to a page), so the head's tri-state
 *  box and the Pager's disabled ends are the real ones. */
const tableBand = (model: Model, h: HtmlBuilder<Msg>): Html => {
  const { page } = model.atoms
  const pages = pageCount()
  const firstIndex = (page - 1) * PAGE_SIZE
  const rows = specimenRowsOnPage(page)
  const selected = model.atoms.selectedRowIndexes
  return band(
    'Table Head · Library Row · Pager',
    h,
    h.div(
      // The design's Library table is 1128px wide inside a 1440px frame, and the
      // head's own fixed columns sum to exactly that, so the band is drawn at
      // its natural width rather than inside the public content gutter. #25
      // owns the Library's real page width.
      [h.Class('w-max')],
      [
        TableHead.tableHead(
          {
            selection: {
              isChecked: rows.length > 0 && rows.every(({ index }) => selected.includes(index)),
              isIndeterminate: selected.length > 0 && selected.length < rows.length,
              ariaLabel: 'Select every Photo on this page',
              onToggle: M.ToggledAtomSelection({}),
            },
            sortedBy: 'taken',
          },
          h,
        ),
        ...rows.map(({ row, index }) =>
          LibraryRow.libraryRow(
            {
              id: `atoms-row-${String(index)}`,
              isSelected: selected.includes(index),
              onToggleSelection: M.ToggledAtomRow({ index }),
              // No PREVIEW yet: the row paints the same surface box the grid
              // paints while the rendition is still being fetched.
              thumb: { alt: `${PHOTOGRAPH_TITLE} — ${row.fileLine}` },
              title: PHOTOGRAPH_TITLE,
              fileLine: row.fileLine,
              ratio: row.ratio,
              taken: row.taken,
              size: row.size,
              status: row.status,
            },
            h,
          ),
        ),
        Pager.pager(
          {
            from: firstIndex + 1,
            to: Math.min(firstIndex + rows.length, TOTAL_PHOTOS),
            total: TOTAL_PHOTOS,
            ...(page > 1 && { onPrevious: M.SteppedAtomPage({ page: page - 1 }) }),
            ...(page < pages && { onNext: M.SteppedAtomPage({ page: page + 1 }) }),
            isPreviousDisabled: page === 1,
            isNextDisabled: page === pages,
          },
          h,
        ),
      ],
    ),
  )
}

/** The Editor inspector in the dark branch: Nav Links, a Ratio filter, the
 *  Border panel's Toggle Row and Mat Swatches, the Details panel's Field and
 *  status group, and the Export panel's Spec Rows. */
const editorPanelBand = (model: Model, h: HtmlBuilder<Msg>): Html =>
  band(
    'Editor panel · dark branch',
    h,
    darkPanel(
      h.div(
        // 312px: the design's Inspector is 360px including its own 24px
        // padding, and every control inside it is `fill` of what is left.
        [h.Class('flex w-78 flex-col gap-(--spacing-xl)')],
        [
          h.div(
            [
              h.Class(
                'flex items-center gap-(--spacing-lg) border-b border-role-hairline pb-(--spacing-md)',
              ),
            ],
            [
              NavLink.navLink({ href: atomsRouter(), label: 'EDIT', state: 'active' }, h),
              NavLink.navLink({ href: atomsRouter(), label: 'DETAILS', state: 'default' }, h),
              NavLink.navLink({ href: atomsRouter(), label: 'HISTORY', state: 'default' }, h),
            ],
          ),
          labelled('Crop', sheetSegment(model, segmentNamed('atoms-editor-ratio'), h), h, STRETCH),
          labelled(
            'Border',
            h.div(
              [h.Class('flex flex-col gap-(--spacing-md)')],
              [
                h.div(
                  [h.Class('flex items-center justify-between gap-(--spacing-sm)')],
                  [
                    h.span([h.Class('type-kicker text-role-text-primary')], ['BORDER']),
                    ToggleRow.toggleRow(
                      {
                        id: 'atoms-border',
                        label: 'Border',
                        isChecked: model.atoms.switches['atoms-border'] ?? true,
                        onToggle: (isChecked) =>
                          M.ToggledAtomSwitch({ id: 'atoms-border', isChecked }),
                      },
                      h,
                    ),
                  ],
                ),
                h.div(
                  [h.Class('flex items-center gap-(--spacing-sm)')],
                  [
                    ...matColours.map((colour) =>
                      Swatch.swatch(
                        {
                          colour,
                          label: MAT_LABELS[colour],
                          isSelected: model.atoms.matColour === colour,
                          onSelect: M.PickedAtomMat({ colour }),
                        },
                        h,
                      ),
                    ),
                    h.span(
                      [h.Class('type-caption italic text-role-text-secondary')],
                      [MAT_LABELS[model.atoms.matColour]],
                    ),
                  ],
                ),
                labelled(
                  'Mat Style',
                  sheetSegment(model, segmentNamed('atoms-mat-style'), h),
                  h,
                  STRETCH,
                ),
              ],
            ),
            h,
            STRETCH,
          ),
          labelled(
            'Export',
            h.div(
              [h.Class('flex flex-col gap-(--spacing-md)')],
              [
                sheetSegment(model, segmentNamed('atoms-editor-format'), h),
                ToggleRow.toggleRow(
                  {
                    id: 'atoms-editor-exif',
                    label: 'Keep EXIF data',
                    isChecked: model.atoms.switches['atoms-editor-exif'] ?? false,
                    onToggle: (isChecked) =>
                      M.ToggledAtomSwitch({ id: 'atoms-editor-exif', isChecked }),
                  },
                  h,
                ),
                h.dl(
                  [h.Class('flex flex-col')],
                  [
                    SpecRow.specRow({ label: 'ORIGINAL', value: '6000 × 4000 · 18.4 MB' }, h),
                    SpecRow.specRow({ label: 'PREVIEW', value: '1200 × 800 · 412 KB' }, h),
                    SpecRow.specRow({ label: 'FULL', value: '6000 × 4000 · 2.1 MB' }, h),
                  ],
                ),
              ],
            ),
            h,
            STRETCH,
          ),
          labelled(
            'Details',
            h.div(
              [h.Class('flex flex-col gap-(--spacing-md)')],
              [
                Textarea.textarea(
                  {
                    id: 'atoms-editor-title',
                    label: 'TITLE',
                    value: model.atoms.inputs['atoms-editor-title'] ?? PHOTOGRAPH_TITLE,
                    className: 'min-h-9',
                    onInput: (value) => M.SetAtomInput({ id: 'atoms-editor-title', value }),
                  },
                  h,
                ),
                sheetSegment(model, segmentNamed('atoms-editor-status'), h),
                h.p(
                  [h.Class('type-exif-sm text-role-text-disabled')],
                  ['NO. 024 · SET AT UPLOAD · NEVER REUSED'],
                ),
              ],
            ),
            h,
            STRETCH,
          ),
        ],
      ),
      h,
    ),
  )

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------

export const atomsPage = (model: Model, h: HtmlBuilder<Msg>): Html =>
  h.div(
    [h.Class('flex flex-col')],
    [
      h.h1([h.Class('mt-(--spacing-2xl) type-section text-role-text-primary')], ['Atoms']),
      h.p(
        [h.Class('mt-(--spacing-xs) type-deck max-w-prose text-role-text-secondary')],
        ['Every atom of the Desk, drawn at its own size. Nothing on this page links anywhere yet.'],
      ),
      segmentBand(model, h),
      statusBand(h),
      ratioTagBand(h),
      iconButtonBand(h),
      navLinkBand(h),
      specRowBand(h),
      fieldBand(model, h),
      toggleRowBand(model, h),
      swatchBand(model, h),
      searchBand(model, h),
      dropZoneBand(model, h),
      tableBand(model, h),
      editorPanelBand(model, h),
    ],
  )
