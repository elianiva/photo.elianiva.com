/**
 * The Library states that are not rows, shared by the two views. The table and
 * the grid are two arrangements of one `ListLibraryRows` read, so a read that
 * failed, a filtered read that matched nothing, and the test for "is anything
 * narrowing the list at all" must say the same thing in either mode rather than
 * drifting apart. The empty *library* — no Photographs at all — is its own
 * module (`library-empty.ts`) because the design gives it real pickers.
 */

import type { HtmlBuilder } from 'foldkit/html'

import * as Button from '@/components/ui/button'
import { Empty } from '@/components/ui/empty'

import { Message as M, libraryFiltersOfModel } from '../model'
import type { Model, Msg } from '../model'
import type { Child } from './shared'

/** Whether anything narrows the list. The sidebar's Tag set and the Page
 *  Head's committed search are two of them; the Filter Bar's Status and Ratio
 *  are the rest. Sort is not here: it orders the list rather than selecting
 *  none of it, so it cannot be why a row is missing. */
export const libraryHasFilter = (model: Model): boolean => {
  const filters = libraryFiltersOfModel(model)
  return (
    filters.status !== 'all' ||
    filters.ratio !== 'any' ||
    filters.tagIds.length > 0 ||
    filters.q.trim() !== ''
  )
}

/** A Library with no Photographs at all: nothing narrows the list and the
 *  filtered total — which, with no filter, *is* the Library — is zero. Not the
 *  same predicate as "the filter matched nothing": that one is a filter hiding
 *  a Library that has Photographs. */
export const libraryIsEmpty = (model: Model): boolean =>
  !libraryHasFilter(model) && model.libraryTotal === 0

/** A read the Admin could not finish (`FailedRpc`). Its Retry re-runs the one
 *  Library read, so the two views share the recovery as well as the message. */
export const libraryError = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [
      h.Class(
        'mt-12 border border-role-accent bg-role-error-container p-4 type-ui text-role-error',
      ),
    ],
    [
      h.p([], [model.error ?? 'Failed to load photos']),
      Button.button(
        { onClick: M.RetryFetch(), variant: 'secondary', className: 'mt-3' },
        'Retry',
        h,
      ),
    ],
  )

/** Nothing for the current filter. Not the same claim as an empty Library: this
 *  one says the query is wrong and offers the way back, so it gets its own
 *  copy rather than the empty Library's. One state for both views — the design
 *  draws the same words and the same clear, whatever arrangement is behind it. */
export const libraryNoMatch = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('mt-12')],
    [
      Empty(
        { className: 'border border-dashed border-role-outline p-12' },
        [
          Empty.header({}, [], h),
          Empty.title({}, ['Nothing matches this filter'], h),
          Empty.description(
            {},
            [
              'There are photographs here, this filter just does not pick any of them.',
              ...(model.activeTagIds.length > 0
                ? [
                    h.button(
                      [
                        h.OnClick(M.ToggledTagFilter({ id: model.activeTagIds[0] ?? '' })),
                        h.Class(
                          'type-caption underline underline-offset-4 hover:text-role-text-primary',
                        ),
                      ],
                      ['Clear the tag filter'],
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
