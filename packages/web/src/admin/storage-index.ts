/**
 * The Storage block's CSV index: the document it downloads.
 *
 * The block's other output — the `412 FRAMES · 4.2 GB OF 21 GB` figure — was
 * read off `SUM(bytes)`, which only an upload writes, so it is gone; the block
 * now counts rows off `GetCounts` instead.
 */

import type { PhotoIndexRow } from '@photo/shared'

/** The index's columns, in the order the issue names them. `taken_at` is
 *  `takenAt`'s column spelling — a CSV is read in a spreadsheet, not decoded
 *  through a schema. */
export const CSV_COLUMNS = [
  'number',
  'title',
  'slug',
  'ratio',
  'taken_at',
  'place',
  'tags',
  'bytes',
] as const

export const CSV_INDEX_FILENAME = 'photo-index.csv'

/** RFC 4180 quoting: a value is quoted when it carries a comma, a quote or a
 *  newline, and an embedded quote is doubled. A caption with an apostrophe in
 *  it is the common case; a place with a comma in it is not rare. */
const csvCell = (value: string | number | null): string => {
  const text = value === null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** The index document: a header row and one row per Photo, in the order
 *  `ListPhotoIndex` returned them, which is Photo Number ascending. The `tags`
 *  cell joins a Photo's labels with ` · ` — the separator the public Folio uses,
 *  so a row reads here the way it reads there. */
export const csvIndex = (rows: ReadonlyArray<PhotoIndexRow>): string =>
  [
    CSV_COLUMNS.join(','),
    ...rows.map((row) =>
      [
        row.number,
        row.title,
        row.slug,
        row.ratio,
        row.takenAt,
        row.place,
        row.tags.join(' · '),
        row.bytes,
      ]
        .map(csvCell)
        .join(','),
    ),
  ].join('\n')

/** Hand the document to the browser as a download. A Blob rather than a data
 *  URL, and a revoked URL afterwards rather than a leaked one: the index is a
 *  few hundred rows and a data URL of it would sit in the history for ever. */
export const downloadCsv = (filename: string, document: string): void => {
  const url = URL.createObjectURL(new Blob([document], { type: 'text/csv;charset=utf-8' }))
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
