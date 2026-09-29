/**
 * The Storage block's two outputs: the figure it reports, and the CSV index it
 * downloads.
 *
 * The figure is `GetStorageUsage`'s `photos` and `bytes` against its `capBytes`
 * — the same payload the sidebar's meter reads, so the two cannot report
 * different caps however the design draws them. The rendering is the meter's
 * own convention: decimal gigabytes, the cap rounded to a whole number, which
 * is why `STORAGE_CAP_BYTES`'s 20 GiB prints as `21 GB` here as it does there.
 * The design's `20 GB` in this block and its `50 GB` in the meter are the
 * canvas disagreeing with itself; one constant and one convention settle it.
 */

import type { PhotoIndexRow } from '@photo/shared'

/** `412 FRAMES · 4.2 GB OF 21 GB` — the design's sentence, over live numbers. */
export const storageFigure = (usage: {
  readonly photos: number
  readonly bytes: number
  readonly capBytes: number
}): string =>
  `${String(usage.photos)} FRAMES · ${(usage.bytes / 1e9).toFixed(1)} GB OF ${Math.round(usage.capBytes / 1e9).toString()} GB`

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
