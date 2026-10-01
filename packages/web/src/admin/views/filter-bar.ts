/**
 * The Library's Filter Bar (`Desk Filter Bar` master `6cabf557894bf636`, the
 * `filters(basic)` variant). One 36px row: the Status Segment, the Ratio
 * Segment behind a `RATIO` kicker, then the SORT select and the list/grid
 * toggle on the right.
 *
 * The `full` variant — two rows, with the design's `SERIES` select — stays in
 * the design; this is the single-row one the issue calls for, and a narrow
 * width can reintroduce `full` from the drawing rather than from a second
 * invention here.
 *
 * Two deviations from the drawing, both stated:
 *
 *   - The `SERIES` select is not rendered. A Series has no entity (decision 5);
 *     grouping is Tags, and the tags are the sidebar's filter (`A4`). Filling
 *     that slot with a tag filter would be a second copy of a control that
 *     already exists rather than a replacement for one that does not.
 *   - `SCHEDULED` is drawn without a count. `scheduled` is not a stored Status
 *     (decision 3): nothing records a publish time, so there is no number to
 *     print and the segment selects nothing. #16 booked the consequence and
 *     #29's Scheduled page is the honest empty state that follows.
 *
 * Every filter here is the URL's, not the bar's: a pick builds the Library's
 * query and the Model reads it back, so a reload lands on the same filtered
 * page. The tag set is the one filter that lives elsewhere — the sidebar owns
 * it, and the bar deliberately omits it.
 */

import type { HtmlBuilder } from 'foldkit/html'
import { LayoutGrid, List } from 'lucide'

import { iconButton } from '@/components/ui/icon-button'
import * as Segment from '@/components/ui/segment'
import * as Select from '@/components/ui/select'

import { Message as M } from '../model'
import type { Model, Msg } from '../model'
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
  { value: 'newest', label: 'NEWEST FIRST' },
  { value: 'oldest', label: 'OLDEST FIRST' },
] as const

/** The list/grid toggle: the active view is the filled Icon Button and the
 *  other is the ghost one, which is the drawing's own pair. */
const viewToggle = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const view = libraryViewOf(model.route)
  return h.div(
    [h.Role('group'), h.AriaLabel('View')],
    [
      iconButton(
        {
          kind: view === 'list' ? 'filled' : 'ghost',
          isPressed: view === 'list',
          onClick: M.SelectedView({ view: 'list' }),
          ariaLabel: 'List view',
        },
        List,
        h,
      ),
      iconButton(
        {
          kind: view === 'grid' ? 'filled' : 'ghost',
          isPressed: view === 'grid',
          onClick: M.SelectedView({ view: 'grid' }),
          ariaLabel: 'Grid view',
        },
        LayoutGrid,
        h,
      ),
    ],
  )
}

export const libraryFilterBar = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [
      h.DataAttribute('slot', 'library-filter-bar'),
      h.Class('mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-2'),
    ],
    [
      h.div(
        [h.Class('flex flex-wrap items-center gap-x-6 gap-y-2')],
        [
          Segment.segmentGroup(
            {
              selected: model.statusFilter,
              options: statusOptions(model),
              ariaLabel: 'Status filter',
              frame: 'rule',
            },
            (value) => M.SelectedStatusFilter({ value }),
            h,
          ),
          h.div(
            [h.Class('flex items-center gap-2')],
            [
              h.span([h.Class('type-kicker text-role-text-disabled')], ['RATIO']),
              Segment.segmentGroup(
                {
                  selected: model.ratioFilter,
                  options: ratioOptions,
                  ariaLabel: 'Ratio filter',
                },
                (value) => M.SelectedRatioFilter({ value }),
                h,
              ),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('flex items-center gap-4')],
        [
          // The design's Select is a kicker over a box; the `basic` bar is one
          // 36px row, so the kicker sits beside the box rather than above it.
          Select.select<Msg>(
            {
              id: 'library-sort',
              label: 'SORT',
              value: model.sortFilter,
              options: SORT_OPTIONS,
              onChange: (value) =>
                M.SelectedSortFilter({ value: value === 'oldest' ? 'oldest' : 'newest' }),
              className: 'w-auto flex-row items-center gap-2',
            },
            h,
          ),
          viewToggle(model, h),
        ],
      ),
    ],
  )
