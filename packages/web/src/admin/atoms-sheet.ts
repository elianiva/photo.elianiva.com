/**
 * The atoms sheet's specimen data, and the state it opens in.
 *
 * The values are the canvas's own, so a drift from the design shows up as a
 * diff here rather than as a screenshot nobody compares. They sit beside the
 * view rather than inside it because `update.ts` initialises the Model from
 * them, and the update core does not import views.
 */

import * as Segment from '@/components/ui/segment'
import type * as Status from '@/components/ui/status'
import type * as Swatch from '@/components/ui/swatch'

import type { AtomsState } from './model'

// ---------------------------------------------------------------------------
// specimens — the design's own values, so a drift shows up as a diff
// ---------------------------------------------------------------------------

export const PHOTOGRAPH_TITLE = 'Jakarta, the last of the sun on Jalan Pintu Besar'

/** What the operator reads a Mat colour as. The design writes the name in
 *  `$typography.caption` beside the swatch it has chosen. */
export const MAT_LABELS: Readonly<Record<Swatch.MatColour, string>> = {
  white: 'White',
  paper: 'Paper',
  ink: 'Ink',
}

export const matColours: ReadonlyArray<Swatch.MatColour> = ['white', 'paper', 'ink']

/** The Library table's shape: the design's `1–7 OF 412`, seven rows a page. */
export const TOTAL_PHOTOS = 412
export const PAGE_SIZE = 7

/** How many pages `TOTAL_PHOTOS` makes, so the Pager's ends are the real ones. */
export const pageCount = (): number => Math.ceil(TOTAL_PHOTOS / PAGE_SIZE)

/** One row's composed values. `NO. 024` is the Photo Number, `DSCF4821.JPG`
 *  the original filename and `KOTA TUA, JAKARTA` the uppercased place, which
 *  is exactly the composition #25 asks the Library page for. */
export interface SpecimenRow {
  fileLine: string
  ratio: string
  taken: string
  size: string
  status: Status.StatusVariant
}

export const specimenRows: ReadonlyArray<SpecimenRow> = [
  {
    fileLine: 'NO. 024 · DSCF4821.JPG · KOTA TUA, JAKARTA',
    ratio: '3:2',
    taken: '31 AUG 2025',
    size: '18.4 → 2.1 MB',
    status: 'published',
  },
  {
    fileLine: 'NO. 025 · DSCF4822.JPG · KOTA TUA, JAKARTA',
    ratio: '2:3',
    taken: '01 SEP 2025',
    size: '16.1 → 1.8 MB',
    status: 'draft',
  },
  {
    fileLine: 'NO. 026 · DSCF4830.JPG · ISTIKLAL, JAKARTA',
    ratio: '4:3',
    taken: '04 SEP 2025',
    size: '14.7 → 1.6 MB',
    status: 'scheduled',
  },
  {
    fileLine: 'NO. 027 · DSCF4831.JPG · ISTIKLAL, JAKARTA',
    ratio: '3:4',
    taken: '06 SEP 2025',
    size: '15.2 → 1.7 MB',
    status: 'published',
  },
  {
    fileLine: 'NO. 028 · DSCF4840.JPG · SURABAYA, JAWA TIMUR',
    ratio: '16:9',
    taken: '11 SEP 2025',
    size: '12.9 → 1.4 MB',
    status: 'failed',
  },
  {
    fileLine: 'NO. 029 · DSCF4844.JPG · SURABAYA, JAWA TIMUR',
    ratio: '9:16',
    taken: '12 SEP 2025',
    size: '13.4 → 1.5 MB',
    status: 'published',
  },
  {
    fileLine: 'NO. 030 · DSCF4851.JPG · UBUD, BALI',
    ratio: '3:2',
    taken: '18 SEP 2025',
    size: '11.8 → 1.2 MB',
    status: 'draft',
  },
]

/** The one table of Segment groups the sheet draws: id, first pick, options and
 *  the box it wears. `initGroups` reads it and the view reads it, so the sheet
 *  cannot declare a group the Model has no state for. */
export interface SheetSegment extends Segment.ViewInputs {
  id: string
  /** The design's selected option, which is the group's initial state. */
  selected: string
}

export const sheetSegments: ReadonlyArray<SheetSegment> = [
  {
    id: 'atoms-status-filter',
    selected: 'all',
    ariaLabel: 'Status filter',
    frame: 'rule',
    options: [
      { value: 'all', label: 'ALL 412' },
      { value: 'published', label: 'PUBLISHED 402' },
      { value: 'draft', label: 'DRAFTS 7' },
      { value: 'scheduled', label: 'SCHEDULED 2' },
      { value: 'failed', label: 'FAILED 1' },
    ],
  },
  {
    id: 'atoms-ratio-filter',
    selected: 'any',
    ariaLabel: 'Ratio filter',
    options: [
      { value: 'any', label: 'ANY' },
      { value: '3:2', label: '3:2' },
      { value: '2:3', label: '2:3' },
      { value: '4:3', label: '4:3' },
      { value: '3:4', label: '3:4' },
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' },
    ],
  },
  {
    id: 'atoms-format',
    selected: 'avif',
    ariaLabel: 'Rendition format',
    // 312px, the Editor inspector's content column, where the design draws the
    // three options as equal thirds.
    className: 'w-78',
    optionClass: 'flex-1',
    options: [
      { value: 'jpeg', label: 'JPEG' },
      { value: 'webp', label: 'WEBP' },
      { value: 'avif', label: 'AVIF' },
    ],
  },
  {
    id: 'atoms-editor-ratio',
    selected: '3:2',
    ariaLabel: 'Ratio',
    className: 'w-full',
    optionClass: 'flex-1',
    options: [
      { value: '3:2', label: '3:2' },
      { value: '2:3', label: '2:3' },
      { value: '4:3', label: '4:3' },
      { value: '3:4', label: '3:4' },
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' },
    ],
  },
  {
    id: 'atoms-editor-format',
    selected: 'avif',
    ariaLabel: 'Rendition format',
    className: 'w-full',
    optionClass: 'flex-1',
    options: [
      { value: 'jpeg', label: 'JPEG' },
      { value: 'webp', label: 'WEBP' },
      { value: 'avif', label: 'AVIF' },
    ],
  },
  {
    id: 'atoms-mat-style',
    selected: 'gallery',
    ariaLabel: 'Mat style',
    options: [
      { value: 'even', label: 'EVEN' },
      { value: 'gallery', label: 'GALLERY' },
      { value: 'square', label: 'SQUARE' },
    ],
  },
  {
    id: 'atoms-editor-status',
    selected: 'scheduled',
    ariaLabel: 'Status',
    options: [
      { value: 'draft', label: 'DRAFT' },
      { value: 'scheduled', label: 'SCHEDULED' },
      { value: 'published', label: 'PUBLISHED' },
    ],
  },
]

export const initSheetSegments = (): Segment.Groups =>
  Segment.initGroups(sheetSegments.map(({ id, selected }) => ({ id, selected })))

/** The sheet's own state. The design's chosen values, so the sheet opens in
 *  the state the canvas draws: the first Segment options picked, EXIF and the
 *  Border on, the white Mat chosen, nothing selected, page one. */
export const initAtomsState = (): AtomsState => ({
  page: 1,
  selectedRowIndexes: [],
  switches: {
    'atoms-border': true,
    'atoms-exif': true,
    'atoms-gps': false,
  },
  inputs: {
    'atoms-field-title': PHOTOGRAPH_TITLE,
  },
  matColour: 'white',
})

/** The rows on the sheet's current page, paired with the Photo Number they
 *  carry. `specimenRows` is the shape of one page; a second page would extend
 *  it, which is why the sheet slices it by `PAGE_SIZE` rather than indexing a
 *  flat list of 412. */
export const specimenRowsOnPage = (
  page: number,
): ReadonlyArray<{ row: SpecimenRow; index: number }> => {
  const first = (page - 1) * PAGE_SIZE
  return specimenRows.map((row, offset) => ({ row, index: first + offset }))
}

/** The indexes of the specimen rows on the sheet's current page. The head's
 *  select-all box is scoped to exactly these — the page, not the whole 412. */
export const specimenRowIndexes = (page: number): ReadonlyArray<number> =>
  specimenRowsOnPage(page).map(({ index }) => index)
