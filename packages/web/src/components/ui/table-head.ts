/**
 * Table Head — the Library's column header (master `36e23128f2187522`). The
 * design fixes the widths (16 / 520 / 64 / 112 / 112 / 112 / 72 across 16px
 * gaps), so they live here once and `library-row.ts` reads the same table: a
 * head and a row that disagree on a column width are a table that jitters.
 *
 * The checkbox is tri-state over the *current page* — off, some, all. The
 * design does not say which set it covers and both readings are defensible;
 * the page's row list is what a header checkbox means, so the caller counts
 * rows it is actually holding and nothing else.
 *
 * The sorted column prints a `↓` and reads `color.text.primary`; the rest read
 * `color.text.secondary`.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils'

import { checkbox } from './checkbox'

/** One column's identity. `photograph` takes the slack, which is what the
 *  design's 520px column is. */
export interface TableColumn {
  key: TableColumnKey
  label: string
}

export type TableColumnKey = 'photograph' | 'ratio' | 'taken' | 'size' | 'status'

/** Every column width in one table, so `library-row.ts` reads the head's
 *  widths rather than restating them: a head and a row that disagree on a
 *  column width are a table that jitters. The design's pixels (520 / 64 / 112 /
 *  112 / 112) sit on Tailwind's spacing scale. */
export const columnWidths = {
  photograph: 'w-130',
  ratio: 'w-16',
  taken: 'w-28',
  size: 'w-28',
  status: 'w-28',
} as const satisfies Readonly<Record<TableColumnKey, string>>

export const tableColumns: ReadonlyArray<TableColumn> = [
  { key: 'photograph', label: 'PHOTOGRAPH' },
  { key: 'ratio', label: 'RATIO' },
  { key: 'taken', label: 'TAKEN' },
  { key: 'size', label: 'SIZE' },
  { key: 'status', label: 'STATUS' },
]

/** The row-action column: two 36px Icon Buttons. */
export const tableActionsWidthClass = 'w-18 shrink-0'

/** The select-all box, the same 16px the rows carry. */
export const tableCheckboxWidthClass = 'w-4 shrink-0'

export const tableHeadClass =
  'flex items-center gap-(--spacing-lg) border-b border-role-rule px-(--spacing-md) pt-(--spacing-md) pb-(--spacing-sm)'

export type TableHeadConfig<M> = Readonly<{
  /** The page's select-all box. Omit it and the head opens on a 16px spacer. */
  selection?: Readonly<{
    isChecked: boolean
    isIndeterminate?: boolean
    ariaLabel: string
    /** Dispatched with the new state. Required: a head with a select-all box
     *  that toggles nothing is a lie. Omit the whole `selection` instead. */
    onToggle: M
  }>
  /** Column key the result is ordered by, if any. */
  sortedBy?: string
  /** Which way the sorted column orders. `desc` prints `↓` — the design's own
   *  `TAKEN ↓` — and `asc` prints `↑`. Defaults to `desc`. */
  sortDirection?: 'asc' | 'desc'
  /** Turns the sorted column's label into a button that flips the direction.
   *  Omit it and the head is a label: a header that looks clickable and does
   *  nothing is worse than one that does not. */
  onToggleSort?: M
  className?: string
}>

/** The Library's column header. */
export const tableHead = <M>(config: TableHeadConfig<M>, h: HtmlBuilder<M>): Html => {
  const { selection } = config
  return h.div(
    [h.Class(cn(tableHeadClass, config.className)), h.DataAttribute('slot', 'table-head')],
    [
      ...(selection === undefined
        ? [h.span([h.AriaHidden(true), h.Class(tableCheckboxWidthClass)])]
        : [
            checkbox(
              {
                id: 'library-select-all',
                isChecked: selection.isChecked,
                ...(selection.isIndeterminate === true && { isIndeterminate: true }),
                onToggle: () => selection.onToggle,
                label: selection.ariaLabel,
                labelClass: 'sr-only',
                wrapperClass: tableCheckboxWidthClass,
              },
              h,
            ),
          ]),
      ...tableColumns.map((column) => {
        const isSorted = column.key === config.sortedBy
        // The design sets the sort mark in the same text run as the label —
        // `TAKEN ↓`, not a glyph beside it. The direction is the SORT select's
        // own fact; the head reflects it and, when the caller wires the
        // toggle, flips it.
        const mark = isSorted ? (config.sortDirection === 'asc' ? '↑' : '↓') : ''
        const text = mark === '' ? column.label : `${column.label} ${mark}`
        const labelClass = cn(
          'type-kicker',
          isSorted ? 'text-role-text-primary' : 'text-role-text-secondary',
        )
        return h.div(
          [h.Key(column.key), h.Class(cn('flex shrink-0 items-center', columnWidths[column.key]))],
          [
            isSorted && config.onToggleSort !== undefined
              ? h.button(
                  [
                    h.Type('button'),
                    h.OnClick(config.onToggleSort),
                    h.AriaLabel(`Sort by ${column.label}`),
                    h.Class(cn(labelClass, 'cursor-pointer')),
                  ],
                  [text],
                )
              : h.span([h.Class(labelClass)], [text]),
          ],
        )
      }),
      h.span([h.AriaHidden(true), h.Class(tableActionsWidthClass)]),
    ],
  )
}
