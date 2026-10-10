/**
 * The Library's state machine: what a gesture puts in the Model, which RPC it
 * reaches, and which reads follow it. All of it runs through the real
 * `init` / `update`, and the seed is a cold load whose responses have been
 * folded through the same `update` the runtime folds Command results through.
 *
 * What the table *draws* — the rows' columns, the Bulk Bar, the empty and
 * loading states — is a page, and a page is verified in the browser
 * (`.agents/skills/verify-photo`). A toast is left out of it for the same
 * reason: it brings an animation, a height measurement and a dismissal timer.
 */

import { Option } from 'effect'
import { fromString as urlFromString } from 'foldkit/url'
import { describe, expect, it } from 'vitest'
import { PhotoId, TagId } from '@photo/shared'
import type { PhotoWithTags, Tag } from '@photo/shared'

import { Message, UPLOAD_LIMITS } from './model'
import type { Counts, Model } from './model'
import { init, update } from './update'
import { fileLine, formatTaken, originalFilename } from './views/library-table'

const ORIGIN = 'https://photo.elianiva.com'
const TEAM = 'https://team.elianivaaccess.test'
const OWNER = 'owner@photo.test'

const at = (pathname: string) => {
  const parsed = urlFromString(`${ORIGIN}${pathname}`)
  if (Option.isNone(parsed)) throw new Error(`not a URL: ${pathname}`)
  return parsed.value
}

const tag = (slug: string, label: string): Tag => ({
  id: TagId.make(slug),
  slug,
  label,
  caption: null,
})

const TAGS: ReadonlyArray<Tag> = [tag('kyoto', 'Kyoto'), tag('nyc', 'New York')]

const COUNTS: Counts = {
  total: 412,
  trashed: 3,
  byStatus: { draft: 7, published: 402, failed: 1 },
}

/** One row's worth of the design's data, so a scene asserts against the values
 *  the canvas draws rather than against whatever a fixture happened to hold. */
const row = (n: number, over: Partial<PhotoWithTags> = {}): PhotoWithTags => ({
  id: PhotoId.make(`photo_${String(n)}`),
  slug: `photograph-${String(n)}`,
  title: `Photograph ${String(n)}`,
  r2Key: `originals/01HQ${String(n).padStart(4, '0')}-DSCF${String(4800 + n)}.JPG`,
  width: 3000,
  height: 2000,
  status: 'published',
  number: 24 - n,
  ratio: '3:2',
  bytes: 19_293_798,
  takenAt: '2025-08-31',
  metadata: { location: 'Kota Tua, Jakarta' },
  blurhash: null,
  tags: [],
  ...over,
})

/** The design's seven rows — `NO. 023` down to `NO. 017` — with a `nextCursor`,
 *  so there is a second page to step onto. */
const PAGE: ReadonlyArray<PhotoWithTags> = Array.from({ length: 7 }, (_, index) => row(index + 1))
const SECOND = Array.from({ length: 7 }, (_, index) => row(index + 8))
const NEXT_CURSOR = 'cursor-after-page-one'
/** The filter and the cursor a command issued from the first page carries. */
const PAGE_ARGS = { q: '', cursor: '' }

const listed = (
  photos: ReadonlyArray<PhotoWithTags> = PAGE,
  total = 412,
  nextCursor: string | null = NEXT_CURSOR,
) => Message.SucceededFetchPhotos({ photos: [...photos], nextCursor, total })

/** A cold load of `/admin` with the operator signed in and the Library
 *  answered. */
const cold = (
  photos: ReadonlyArray<PhotoWithTags> = PAGE,
  total = 412,
  nextCursor: string | null = NEXT_CURSOR,
): Model =>
  [
    Message.SucceededGetSession({ email: OWNER, teamDomain: TEAM }),
    Message.SucceededGetCounts(COUNTS),
    Message.SucceededFetchTags({ tags: [...TAGS] }),
    listed(photos, total, nextCursor),
  ].reduce((model, message) => update(model, message).model, init(at('/admin')).model)

/** The Admin's own Commands — the RPCs and the navigation. Everything a child
 *  submodel answers with (a Dialog opening, a toast animating and timing
 *  itself out) is not one of these. */
const ADMIN_COMMANDS = new Set([
  'AddBorder',
  'BulkAddTags',
  'BulkTrash',
  'FetchCounts',
  'FetchPhotos',
  'Navigate',
  'SetRowStatus',
])

/** Fold a run of messages over a cold Library and report what each fold
 *  dispatched. */
const fold = (
  ...messages: ReadonlyArray<Message>
): { model: Model; commands: ReadonlyArray<{ name: string; args?: unknown }> } => {
  let model = cold()
  const commands: Array<{ name: string; args?: unknown }> = []
  for (const message of messages) {
    const result = update(model, message)
    model = result.model
    for (const command of result.commands ?? []) {
      if (!ADMIN_COMMANDS.has(command.name)) continue
      commands.push({ name: command.name, args: command.args })
    }
  }
  return { model, commands }
}

/** What the operator was told. The toast's cards live one level down, on the
 *  bound module the Admin's toast submodel wraps. */
const told = (...messages: ReadonlyArray<Message>): ReadonlyArray<string> =>
  fold(...messages).model.toast.toast.entries.map((entry) =>
    entry.payload.detail === undefined
      ? entry.payload.title
      : `${entry.payload.title} — ${entry.payload.detail}`,
  )

describe('selection', () => {
  it('a row click and the pencil are two different gestures on two messages', () => {
    // The row is the selection target; the pencil is the Editor. A row click
    // that also opened the Editor, or a pencil that ticked the row, is what the
    // design's frame of two ticked rows rules out.
    const navigated = fold(
      Message.ToggledRowSelection({ id: PAGE[1]?.id ?? '' }),
      Message.OpenedPhoto({ id: row(1).id }),
    )
    expect(navigated.commands.map((command) => command.name)).toEqual(['Navigate'])
    expect(navigated.model.selected).toEqual([PAGE[1]?.id])
  })

  it('is cleared by a filter change, because it named the rows that just went away', () => {
    // A selection of forty that silently followed a new query is a bulk
    // operation on forty Photographs the operator never chose.
    const filtered = fold(
      Message.ToggledRowSelection({ id: PAGE[0]?.id ?? '' }),
      Message.ToggledRowSelection({ id: PAGE[1]?.id ?? '' }),
      Message.SelectedStatusFilter({ value: 'draft' }),
    )
    expect(filtered.model.selected).toEqual([])
    expect(filtered.commands.map((command) => command.name)).toEqual(['FetchPhotos'])
  })

  it('reads the head’s box off the page, not off the filtered total', () => {
    // 412 rows exist and seven are on screen. "All" is the seven, and the
    // mixed state is one unticked row among them.
    const all = fold(Message.ToggledPageSelection({}))
    expect(all.model.selected).toEqual(PAGE.map((photo) => photo.id))

    const mixed = fold(
      Message.ToggledPageSelection({}),
      Message.ToggledRowSelection({ id: PAGE[3]?.id ?? '' }),
    )
    expect(mixed.model.selected).not.toContain(PAGE[3]?.id)
    expect(mixed.model.selected).toHaveLength(6)

    const cleared = fold(
      Message.ToggledPageSelection({}),
      Message.ToggledRowSelection({ id: PAGE[3]?.id ?? '' }),
      Message.ToggledRowSelection({ id: PAGE[3]?.id ?? '' }),
    )
    // Ticking a row back puts it on the end rather than in its printed place;
    // the selection is a set of ids, and the order it is sent in is the table's.
    expect([...cleared.model.selected].sort()).toEqual(PAGE.map((photo) => photo.id).sort())

    const off = fold(Message.ToggledPageSelection({}), Message.ToggledPageSelection({}))
    expect(off.model.selected).toEqual([])
  })
})

describe('the Bulk Bar', () => {
  it('Add border issues the one Mat on every ticked Photo, then re-reads rows and counts', () => {
    // The design draws a single ghost button and no picker, so there is one Mat
    // and the toast names it rather than the operator having to ask.
    const applied = fold(
      Message.ToggledPageSelection({}),
      Message.AddBorderToSelection({}),
      Message.SucceededAddBorder({
        count: 7,
        photos: [...PAGE],
        nextCursor: NEXT_CURSOR,
        total: 412,
      }),
    )
    expect(applied.commands).toEqual([
      { name: 'AddBorder', args: { ids: PAGE.map((photo) => photo.id), page: PAGE_ARGS } },
      { name: 'FetchCounts', args: undefined },
    ])
    expect(
      told(
        Message.ToggledPageSelection({}),
        Message.AddBorderToSelection({}),
        Message.SucceededAddBorder({
          count: 7,
          photos: [...PAGE],
          nextCursor: NEXT_CURSOR,
          total: 412,
        }),
      ),
    ).toEqual(['Border added to 7 photos — Even mat, paper, 4%.'])
  })

  it('trashes the selection in the table’s row order, not the order it was ticked', () => {
    // Ticked out of order on purpose: the payload follows the table.
    const trashed = fold(
      Message.ToggledRowSelection({ id: PAGE[1]?.id ?? '' }),
      Message.ToggledRowSelection({ id: PAGE[0]?.id ?? '' }),
      Message.RequestBulkTrash({ count: 2 }),
      Message.ConfirmPending({}),
      Message.SucceededBulkTrash({
        count: 2,
        photos: PAGE.slice(2),
        nextCursor: NEXT_CURSOR,
        total: 410,
      }),
    )
    expect(trashed.commands[0]).toEqual({
      name: 'BulkTrash',
      args: { ids: [PAGE[0]?.id, PAGE[1]?.id], page: PAGE_ARGS },
    })
    // A soft delete touches no R2 object, and every write here ends by reading
    // the list and the counts back. One command, not one per Photograph: the
    // contract's hundred-id cap is folded inside it.
    expect(trashed.commands.map((command) => command.name)).toEqual(['BulkTrash', 'FetchCounts'])
    // The Photographs left the list, so the selection went with them and the
    // filtered total moved with the rows.
    expect(trashed.model.selected).toEqual([])
    expect(trashed.model.libraryTotal).toBe(410)
    expect(trashed.model.photos).toHaveLength(5)
    expect(
      told(
        Message.ToggledRowSelection({ id: PAGE[0]?.id ?? '' }),
        Message.RequestBulkTrash({ count: 1 }),
        Message.ConfirmPending({}),
        Message.SucceededBulkTrash({
          count: 1,
          photos: PAGE.slice(1),
          nextCursor: NEXT_CURSOR,
          total: 411,
        }),
      ),
    ).toEqual([
      '1 photo moved to Trash — Nothing was purged. Originals stay in R2, and no number is ever reused.',
    ])
  })

  it('Add tag is Move to series, re-pointed, and it applies exactly what was ticked', () => {
    // A Series page *is* a Tag page (ADR 0006), so the grouping entity the
    // design's `Move to series` slot wanted is the Tag. Ticked out of order on
    // purpose, so the ids assert the table's order and not the click order.
    const tagged = fold(
      Message.ToggledRowSelection({ id: PAGE[1]?.id ?? '' }),
      Message.ToggledRowSelection({ id: PAGE[0]?.id ?? '' }),
      Message.OpenedAddTag({}),
      Message.ToggledAddTag({ id: 'kyoto' }),
      Message.ToggledAddTag({ id: 'nyc' }),
      Message.ConfirmAddTag({}),
      Message.SucceededAddTag({ count: 2, photos: [...PAGE], nextCursor: NEXT_CURSOR, total: 412 }),
    )
    expect(tagged.commands[0]).toEqual({
      name: 'BulkAddTags',
      args: {
        ids: [PAGE[0]?.id, PAGE[1]?.id],
        tagIds: ['kyoto', 'nyc'],
        page: PAGE_ARGS,
      },
    })
    // The pick is spent once it has been applied, and a dismissed dialog is a
    // dismissed pick rather than a pick waiting for the next one.
    expect(tagged.model.addTagIds).toEqual([])
    expect(
      told(
        Message.ToggledRowSelection({ id: PAGE[0]?.id ?? '' }),
        Message.OpenedAddTag({}),
        Message.ToggledAddTag({ id: 'kyoto' }),
        Message.ConfirmAddTag({}),
        Message.SucceededAddTag({
          count: 1,
          photos: [...PAGE],
          nextCursor: NEXT_CURSOR,
          total: 412,
        }),
      ),
    ).toEqual(['Edited 1 photo — added “Kyoto”'])
  })

  it('the Add tag picker holds no pick until one is made', () => {
    // Nothing ticked is nothing to apply, so the picker opens empty rather
    // than with a selection the operator never made.
    const opened = fold(
      Message.ToggledRowSelection({ id: PAGE[0]?.id ?? '' }),
      Message.OpenedAddTag({}),
    )
    expect(opened.model.addTagIds).toEqual([])

    const picked = fold(
      Message.ToggledRowSelection({ id: PAGE[0]?.id ?? '' }),
      Message.OpenedAddTag({}),
      Message.ToggledAddTag({ id: 'kyoto' }),
    )
    expect(picked.model.addTagIds).toEqual(['kyoto'])
  })
})

describe('the row ⋯ menu', () => {
  it('publishes and unpublishes through the one Status RPC, then re-reads', () => {
    const published = fold(
      Message.OpenedRowMenu({ id: PAGE[0]?.id ?? '' }),
      Message.SetRowStatus({ id: PAGE[0]?.id ?? '', status: 'draft' }),
      Message.SucceededSetRowStatus({
        status: 'draft',
        photos: [row(1, { status: 'draft' }), ...PAGE.slice(1)],
        nextCursor: NEXT_CURSOR,
        total: 412,
      }),
    )
    expect(published.commands[0]).toEqual({
      name: 'SetRowStatus',
      args: { id: PAGE[0]?.id, status: 'draft', page: PAGE_ARGS },
    })
    expect(published.commands.map((command) => command.name)).toEqual([
      'SetRowStatus',
      'FetchCounts',
    ])
    expect(published.model.photos[0]?.status).toBe('draft')
  })

  it('moves one Photograph to Trash through the same confirm as the bulk', () => {
    const asked = fold(
      Message.OpenedRowMenu({ id: PAGE[0]?.id ?? '' }),
      Message.RequestedRowTrash({ id: PAGE[0]?.id ?? '', title: 'Photograph 1' }),
    )
    // The menu has done its job: one confirm Dialog, not two stacked.
    expect(asked.model.rowMenuId).toBeUndefined()
    expect(asked.model.pendingConfirm).toEqual({
      kind: 'photo',
      id: PAGE[0]?.id,
      label: 'Photograph 1',
    })
  })
})

describe('paging', () => {
  it('next resumes at the keyset cursor and reports the new range', () => {
    const paged = fold(
      Message.SteppedLibraryPage({ delta: 1 }),
      listed(SECOND, 412, 'cursor-after-page-two'),
    )
    expect(paged.commands[0]).toEqual({
      name: 'FetchPhotos',
      args: { q: '', cursor: NEXT_CURSOR },
    })
    // The rows the answer carried are the rows the page is now over — the range
    // the pager prints is read off them, not off the page it was on.
    expect(paged.model.photos).toEqual([...SECOND])
    expect(paged.model.libraryPage).toBe(1)
    expect(paged.model.libraryTotal).toBe(412)
  })

  it('previous re-reads a cursor it already held rather than inventing one', () => {
    const onSecond = fold(
      Message.SteppedLibraryPage({ delta: 1 }),
      listed(SECOND, 412, 'cursor-after-page-two'),
    )
    // The cursor the first page's response handed over is the one the second
    // page was read with, and the first page's own slot is still the empty one.
    expect(onSecond.model.libraryPage).toBe(1)
    expect(onSecond.model.libraryCursors).toEqual(['', NEXT_CURSOR])
    // Going back does not invent a cursor and does not keep the stale one: the
    // first page's slot is the empty string again.
    const back = fold(
      Message.SteppedLibraryPage({ delta: 1 }),
      listed(SECOND, 412, 'cursor-after-page-two'),
      Message.SteppedLibraryPage({ delta: -1 }),
    )
    expect(back.commands.map((command) => command.name)).toEqual(['FetchPhotos', 'FetchPhotos'])
    expect(back.commands[1]?.args).toEqual({ q: '', cursor: '' })
    expect(back.model.libraryPage).toBe(0)
    expect(back.model.libraryCursors).toEqual([''])
  })

  it('the first page cannot go back and the last cannot go on', () => {
    const first = fold(Message.SteppedLibraryPage({ delta: -1 }))
    expect(first.commands).toEqual([])
    const onLast = update(
      fold(listed(PAGE, 412, null)).model,
      Message.SteppedLibraryPage({ delta: 1 }),
    )
    expect(onLast.commands ?? []).toEqual([])
  })
})

describe('the states that are not rows', () => {
  it('a filter that matches nothing keeps the filter, so it is not an empty Library', () => {
    const settled = fold(
      Message.SetSearchQuery({ value: 'nothing matches this' }),
      Message.SubmittedSearch({}),
      listed([], 0, null),
    )
    expect(settled.model.appliedQuery).toBe('nothing matches this')
    expect(settled.model.photos).toEqual([])
    expect(settled.model.libraryTotal).toBe(0)
  })

  it('a picked file enters the drop intake: queued, capped, and size-checked', () => {
    const picked = fold(Message.ImportedFiles({ files: [new File(['x'], 'one.jpg')] }))
    expect(picked.model.queue.map((item) => item.name)).toEqual(['one.jpg'])
    // The dialog opens so the operator can tag the batch and press Upload.
    expect(picked.model.uploadDialog.isOpen).toBe(true)

    const overCap = fold(
      Message.ImportedFiles({
        files: Array.from(
          { length: UPLOAD_LIMITS.maxFiles + 1 },
          (_, index) => new File(['x'], `pick-${String(index)}.jpg`),
        ),
      }),
    )
    expect(overCap.model.queue).toHaveLength(UPLOAD_LIMITS.maxFiles)

    const oversized = fold(
      Message.ImportedFiles({
        files: [new File([new Uint8Array(UPLOAD_LIMITS.maxFileSize + 1)], 'huge.jpg')],
      }),
    )
    expect(oversized.model.queue.map((item) => [item.name, item.status, item.error])).toEqual([
      [
        'huge.jpg',
        'failed',
        `file too large (max ${String(UPLOAD_LIMITS.maxFileSize / (1024 * 1024))} MB)`,
      ],
    ])
  })

  it('a cancelled picker queues nothing and opens nothing', () => {
    const cancelled = fold(Message.ImportedFiles({ files: [] }))
    expect(cancelled.model.queue).toEqual([])
    expect(cancelled.model.uploadDialog.isOpen).toBe(false)
  })

  it('a failed read leaves the rows it already had and carries the reason', () => {
    const failed = update(cold(), Message.FailedRpc({ message: 'the Library could not be read' }))
    // Nothing is re-read behind the operator's back, and what is already on
    // screen stays on screen behind the error.
    expect(
      (failed.commands ?? [])
        .map((command) => command.name)
        .filter((name) => name.startsWith('Fetch')),
    ).toEqual([])
    expect(failed.model.error).toBe('the Library could not be read')
    expect(failed.model.photos).toEqual([...PAGE])
  })
})

describe('the values one row prints', () => {
  // The two formatters behind the row's `TAKEN` cell and its `NO. …` line.
  // What the cells *draw* is a page (`.agents/skills/verify-photo`); what is
  // asserted here is the string each one composes, which is where both of them
  // read the stored value wrong.

  it('prints the day of a takenAt that carries a time as well', () => {
    // The upload stores the hour when the file's own EXIF names one, so the
    // stored value is `2026-06-11T14:27` as often as it is `2026-06-11`. Both
    // print their day; neither prints a dash.
    expect(formatTaken('2026-06-11T14:27')).toBe('11 JUN 2026')
    expect(formatTaken('2026-06-11')).toBe('11 JUN 2026')
    expect(formatTaken('2025-08-31')).toBe('31 AUG 2025')
    expect(formatTaken(undefined)).toBe('—')
    expect(formatTaken('not a date')).toBe('—')
    expect(formatTaken('2025-13-01')).toBe('—')
  })

  it('takes the whole upload id off a key, not its first dash-segment', () => {
    // The upload writes `originals/{uuid}-{slug}.{ext}` from a freshly minted
    // `crypto.randomUUID()`, so the id is a uuid and the name is what is left
    // once all of it is off.
    expect(
      originalFilename('originals/0648870a-7ff5-4790-9e04-6b2265858b3a-2026-06-11-4.jpg'),
    ).toBe('2026-06-11-4.jpg')
    // A key that carries no uuid — a seeded row, an original placed in R2 by
    // hand — is already a name.
    expect(originalFilename('originals/kyoto-1.jpg')).toBe('kyoto-1.jpg')
  })

  it('composes the number, the filename and the place, and only the parts it has', () => {
    const pipin: PhotoWithTags = {
      ...row(1),
      number: 5,
      r2Key: 'originals/0648870a-7ff5-4790-9e04-6b2265858b3a-2026-06-11-4.jpg',
      metadata: { location: 'Kota Tua, Jakarta' },
    }
    expect(fileLine(pipin)).toBe('NO. 005 · 2026-06-11-4.jpg · KOTA TUA, JAKARTA')
    // A Photograph carrying only some of them prints only those, rather than a
    // line of separators with gaps in it.
    expect(fileLine({ ...pipin, metadata: {} })).toBe('NO. 005 · 2026-06-11-4.jpg')
    expect(fileLine({ ...pipin, number: undefined, metadata: {} })).toBe('2026-06-11-4.jpg')
  })
})
