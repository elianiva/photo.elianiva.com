/**
 * The Library's page footer, shared by the table and the grid. Both views draw
 * the same page of the same `ListLibraryRows` read, so they must page it the
 * same way and from the same keyset cursors — a grid that appended rows while
 * the table replaced them would leave the two views disagreeing about which
 * page they were on. `from`/`to` are the page's own first and last row;
 * `total` is the filtered total behind them.
 */

import type { HtmlBuilder } from 'foldkit/html'

import { pager } from '@/components/ui/pager'

import { LIBRARY_PAGE_SIZE, Message as M } from '../model'
import type { Model, Msg } from '../model'
import type { Child } from './shared'

export const libraryPager = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const from = model.libraryPage * LIBRARY_PAGE_SIZE + 1
  return pager(
    {
      from,
      to: from + model.photos.length - 1,
      total: model.libraryTotal,
      onPrevious: M.SteppedLibraryPage({ delta: -1 }),
      onNext: M.SteppedLibraryPage({ delta: 1 }),
      isPreviousDisabled: model.libraryPage === 0,
      isNextDisabled: model.nextCursor === null,
      className: 'border-t border-role-hairline',
    },
    h,
  )
}
