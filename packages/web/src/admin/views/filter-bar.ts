/**
 * The Library's Filter Bar (`Desk Filter Bar` master `6cabf557894bf636`). Two
 * tiers of choice groups: the ones that narrow the list, then the ones that
 * decide how it is read.
 *
 * Every one of them is the same atom — `Segment`, one height, drawn as a row
 * of rounded pills (`shape: 'pill'`), a label naming it — because they used not to be, and the
 * row read as four unrelated controls: two segments in boxes of different
 * greys at 28px, a native dropdown at 36px wearing a bottom rule, and a pair of
 * round icon buttons. Two heights, three frames, two shapes. Worse, the grid's
 * density picker was not in the bar at all: it floated on a row of its own,
 * above it and right-aligned, so the one control that changed with the view
 * sat outside the bar that changed with it.
 *
 * The rule now: a choice is a `Segment`, and in the Library's bar a `Segment` is a pill.
 *
 * Two tiers rather than one row is the measure's decision, not a leftover: the
 * page column is `max-w-[1080px]` — the Library table's own width, at every
 * viewport — and the five groups need about 1285px of it, so no window makes
 * them one line. Letting the clusters wrap on their own is exactly what left
 * the sort and the view toggle stranded on a third line with nothing relating
 * them to the filters above. Stacked by construction, every group keeps its
 * own left edge and the bar reads as two rows on purpose.
 *
 * Three deviations from the drawing, all stated:
 *
 *   - The `SERIES` select is not rendered. A Series has no entity (decision 5);
 *     grouping is Tags, and a Tag is picked where it is applied — the upload
 *     dialog's combo and the Library's own Bulk Bar — not as a filter over the
 *     rows beside it.
 *   - `SCHEDULED` is drawn without a count. `scheduled` is not a stored Status
 *     (decision 3): nothing records a publish time, so there is no number to
 *     print and the segment selects nothing. #16 booked the consequence and
 *     #29's Scheduled page is the honest empty state that follows.
 *   - SORT is a `Segment` and not the drawing's Select. Two orderings is a pair
 *     of choices, and a dropdown is a control for a set too large to print; at
 *     36px with a bottom rule it was also the one thing in the bar that was not
 *     the height of everything beside it. Its labels drop `FIRST` for the same
 *     reason — `NEWEST` under a `SORT` label says it.
 *
 * Every filter here is the URL's, not the bar's: a pick builds the Library's
 * query and the Model reads it back, so a reload lands on the same filtered
 * page.
 */

import type { HtmlBuilder } from 'foldkit/html'
import { LayoutGrid, List } from 'lucide'

import * as Segment from '@/components/ui/segment'

import { Message as M } from '../model'
import type { GridCols, Model, Msg } from '../model'
import { LIBRARY_RATIO_FILTERS } from '../route'
import type { LibraryRatioFilter, LibraryStatusFilter } from '../route'
import { libraryViewOf } from '../route'
import type { Child } from './shared'

/** The five Status segments, counts inline. `ALL` and the three stored
 *  Statuses carry one; `SCHEDULED` does not, because there is nothing to
 *  count. */
const statusOptions = (model: Model): ReadonlyArray<Segment.SegmentOption<LibraryStatusFilter>> => {
  const { total, byStatus } = model.counts
  return [
    { value: 'all', label: `ALL ${String(total)}` },
    { value: 'published', label: `PUBLISHED ${String(byStatus.published)}` },
    { value: 'draft', label: `DRAFTS ${String(byStatus.draft)}` },
    { value: 'scheduled', label: 'SCHEDULED' },
    { value: 'failed', label: `FAILED ${String(byStatus.failed)}` },
  ]
}

/** `ANY` first, then the six supported values in the design's order. */
const ratioOptions: ReadonlyArray<Segment.SegmentOption<LibraryRatioFilter>> =
  LIBRARY_RATIO_FILTERS.map((value) => ({
    value,
    label: value === 'any' ? 'ANY' : value,
  }))

const SORT_OPTIONS = [
  { value: 'newest', label: 'NEWEST' },
  { value: 'oldest', label: 'OLDEST' },
] as const

/** The two views, as glyphs. The words stay in the accessible name, so the
 *  pair reads as `List view` / `Grid view` rather than as two unlabelled
 *  squares. */
const VIEW_OPTIONS = [
  { value: 'list', label: 'List view', icon: List },
  { value: 'grid', label: 'Grid view', icon: LayoutGrid },
] as const

/** The grid's 2–6 square-tile columns, a preference persisted on change. The
 *  numbers print as they are and are named by `ariaLabel`, because `4` on its
 *  own is not a thing to read aloud. The values are the Model's own `GridCols`,
 *  so a pick is typed as the column count rather than parsed back out of a
 *  string. */
const COL_CHOICES: ReadonlyArray<GridCols> = [2, 3, 4, 5, 6]

const colsOptions: ReadonlyArray<Segment.SegmentOption<GridCols>> = COL_CHOICES.map((cols) => ({
  value: cols,
  label: String(cols),
  ariaLabel: `${String(cols)} columns`,
}))

/** A tier of the bar: one row of groups, wrapping as a unit. */
const tierClass = 'flex flex-wrap items-end gap-x-6 gap-y-3'

export const libraryFilterBar = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const view = libraryViewOf(model.route)
  return h.div(
    [
      h.DataAttribute('slot', 'library-filter-bar'),
      // Two tiers, stacked, and that is the shape the measure allows rather
      // than a wrap that happened: the page column is `max-w-[1080px]` — the
      // Library table's own width — and the five groups need about 1285px of
      // it, so no viewport makes them one row. Letting the clusters wrap on
      // their own is what left the sort and the view toggle stranded on a
      // third line with nothing relating them to the filters above.
      h.Class('mt-6 flex flex-col gap-y-4'),
    ],
    [
      h.div(
        [h.Class(tierClass)],
        [
          Segment.segmentGroup(
            {
              selected: model.statusFilter,
              options: statusOptions(model),
              label: 'STATUS',
              ariaLabel: 'Status filter',
              shape: 'pill',
            },
            (value) => M.SelectedStatusFilter({ value }),
            h,
          ),
          Segment.segmentGroup(
            {
              selected: model.ratioFilter,
              options: ratioOptions,
              label: 'RATIO',
              ariaLabel: 'Ratio filter',
              shape: 'pill',
            },
            (value) => M.SelectedRatioFilter({ value }),
            h,
          ),
        ],
      ),
      h.div(
        [h.Class(tierClass)],
        [
          Segment.segmentGroup(
            {
              selected: model.sortFilter,
              options: SORT_OPTIONS,
              label: 'SORT',
              ariaLabel: 'Sort',
              shape: 'pill',
            },
            (value) => M.SelectedSortFilter({ value }),
            h,
          ),
          Segment.segmentGroup(
            {
              selected: view,
              options: VIEW_OPTIONS,
              label: 'VIEW',
              ariaLabel: 'View',
              shape: 'pill',
            },
            (value) => M.SelectedView({ view: value === 'grid' ? 'grid' : 'list' }),
            h,
          ),
          // Only in the grid, because only the grid has a density. It is in the
          // bar rather than on a row above it: the density is the grid's, so it
          // is read beside the choice that turns the grid on.
          ...(view === 'grid'
            ? [
                Segment.segmentGroup(
                  {
                    selected: model.cols,
                    options: colsOptions,
                    label: 'DENSITY',
                    ariaLabel: 'Grid density',
                    shape: 'pill',
                  },
                  (cols) => M.SelectedCols({ cols }),
                  h,
                ),
              ]
            : []),
        ],
      ),
    ],
  )
}
