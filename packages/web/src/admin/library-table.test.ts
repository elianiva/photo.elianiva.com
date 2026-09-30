/**
 * The Library table, driven the way the operator drives it: the rows the
 * design draws, ticking them, the Bulk Bar that appears, the tri-state box, and
 * a page turn. The write paths — which RPC a gesture reaches, and which two
 * reads follow it — are asserted through `update` directly, because a toast
 * brings an animation, a height measurement and a dismissal timer with it and
 * none of those is what these are about.
 *
 * Every scene goes through the real `init` / `update` / `view`, and the seed is
 * a cold load whose responses have been folded through the same `update` the
 * runtime folds Command results through, so the page these scenes draw is the
 * one the runtime would have drawn.
 */

import { Option } from 'effect'
import { Scene } from 'foldkit'
import { fromString as urlFromString } from 'foldkit/url'
import { describe, expect, it } from 'vitest'
import { PhotoId, STORAGE_CAP_BYTES, TagId } from '@photo/shared'
import type { PhotoWithTags, Tag } from '@photo/shared'
import * as Animation from '@foldkit/ui/animation'
import { AcquireResources, ShowDialog } from '@foldkit/ui/dialog'

import * as Dialog from '@/components/ui/dialog'

import { FetchPhotosCmd, NavigateCmd, ReplaceUrlCmd } from './commands'
import { Message, UPLOAD_LIMITS } from './model'
import type { Counts, Model } from './model'
import { init, update } from './update'
import { view } from './view'

const ORIGIN = 'https://photo.elianiva.com'
const TEAM = 'https://team.elianivaaccess.test'
const OWNER = 'owner@photo.test'
const PHOTO_ROUTE = '/admin/photos/photo_1'

const at = (pathname: string) => {
  const parsed = urlFromString(`${ORIGIN}${pathname}`)
  if (Option.isNone(parsed)) throw new Error(`not a URL: ${pathname}`)
  return parsed.value
}

const app = { update, view }

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
  byTag: [
    { id: TagId.make('kyoto'), label: 'Kyoto', count: 38 },
    { id: TagId.make('nyc'), label: 'New York', count: 52 },
  ],
}

const STORAGE = { photos: 412, bytes: 7_900_000_000, capBytes: STORAGE_CAP_BYTES }

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
const PAGE_ARGS = { tagIds: [], q: '', cursor: '' }

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
    Message.SucceededGetStorage(STORAGE),
    Message.SucceededFetchTags({ tags: [...TAGS] }),
    listed(photos, total, nextCursor),
  ].reduce((model, message) => update(model, message).model, init(at('/admin')).model)

const given = (
  photos: ReadonlyArray<PhotoWithTags> = PAGE,
  total = 412,
  nextCursor: string | null = NEXT_CURSOR,
) => Scene.given(cold(photos, total, nextCursor))

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

const box = (name: string) => Scene.role('checkbox', { name })
const rowSelect = (title: string) => Scene.role('button', { name: `Select ${title}` })
const headBox = () => Scene.role('checkbox', { name: 'Select every photograph on this page' })

/** The steps a Dialog submodel needs answered when it opens. */
const opened = (id: string) => [
  Scene.Command.resolve(
    ShowDialog({ id, focusSelector: '[data-foldkit-dialog-initial-focus]' }),
    Dialog.Message.SucceededShowDialog(),
  ),
  Scene.Command.resolve(Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint()),
  Scene.Command.resolve(
    Animation.WaitForAnimationSettled({ id: `${id}-panel` }),
    Animation.Message.EndedAnimation(),
  ),
  Scene.Mount.resolve(AcquireResources, Dialog.Message.SucceededAcquireResources()),
]

const CONFIRM = 'admin-confirm-dialog'
const ROW_MENU = 'admin-row-menu'
const ADD_TAG = 'admin-add-tag-dialog'

describe('the Library rows', () => {
  it('compose the design’s columns from what the Photo carries', () => {
    Scene.scene(
      app,
      given(),
      // The `NO.` line is composed, not stored: the Photo Number, the original
      // filename derived from `r2Key`, and the place in caps.
      Scene.expectAll(Scene.all.text('NO. 023 · DSCF4801.JPG · KOTA TUA, JAKARTA')).toHaveCount(1),
      // Scoped to the rows' own slots: a bare text match also lands on the
      // wrapper the atom puts the value in.
      Scene.expectAll(Scene.all.selector('[data-slot="ratio-tag"]')).toHaveCount(7),
      Scene.expect(Scene.text('3:2')).toExist(),
      Scene.expect(Scene.text('31 AUG 2025')).toExist(),
      // The SIZE cell prints the original's byte count, because no read returns
      // the PREVIEW Rendition's — the design's `18.4 → 2.1 MB` is half a fact
      // this Admin does not have.
      Scene.expect(Scene.text('18.4 MB')).toExist(),
      Scene.expectAll(Scene.all.selector('[data-slot="status"]')).toHaveCount(7),
      Scene.expect(Scene.text('PUBLISHED')).toExist(),
      Scene.expect(Scene.text('1–7 OF 412')).toExist(),
    )
  })

  it('print a dash for the facts a Photo does not carry, never a gap between separators', () => {
    // The design's own `Untitled` row reads `DSCF4583.JPG` — no number, no
    // place — rather than a line of separators with holes in it.
    Scene.scene(
      app,
      given(
        [
          row(1, { number: null, metadata: {} }),
          row(2, { number: null, ratio: null, takenAt: undefined, bytes: null, status: 'draft' }),
        ],
        2,
        null,
      ),
      Scene.expect(Scene.text('DSCF4801.JPG')).toExist(),
      Scene.expect(Scene.text('DSCF4802.JPG · KOTA TUA, JAKARTA')).toExist(),
      Scene.expect(Scene.text('—')).toExist(),
      Scene.expect(Scene.text('DRAFT')).toExist(),
      // `1–7` follows the page's own rows, and `OF 2` the filtered total.
      Scene.expect(Scene.text('1–2 OF 2')).toExist(),
    )
  })

  it('is a skeleton, not a spinner, while the page is on its way', () => {
    const loading = update(
      init(at('/admin')).model,
      Message.SucceededGetSession({ email: OWNER, teamDomain: TEAM }),
    ).model
    Scene.scene(
      app,
      Scene.given(loading),
      // The head's column widths hold while the rows arrive, so the table does
      // not jump when they land.
      Scene.expect(Scene.selector('[data-slot="table-head"]')).toExist(),
      Scene.expectAll(Scene.all.selector('[data-slot="library-skeleton-row"]')).toHaveCount(7),
      Scene.expect(Scene.text('Loading photos…')).not.toExist(),
    )
  })
})

describe('selection', () => {
  it('ticking two rows brings up the Bulk Bar, and Clear takes it away', () => {
    Scene.scene(
      app,
      given(),
      Scene.expect(Scene.selector('[data-slot="bulk-bar"]')).not.toExist(),
      Scene.click(box('Photograph 1')),
      Scene.click(box('Photograph 3')),
      Scene.expect(Scene.selector('[data-slot="bulk-bar"]')).toExist(),
      Scene.expect(Scene.text('2 SELECTED')).toExist(),
      // The design's box beside the kicker, and the caption-italic `Clear`.
      Scene.expect(box('Clear the 2 selected')).toBeChecked(),
      Scene.click(Scene.role('button', { name: 'Clear' })),
      Scene.expect(Scene.selector('[data-slot="bulk-bar"]')).not.toExist(),
    )
  })

  it('a row click and the pencil are two different gestures on two elements', () => {
    // The row is the selection target; the pencil is the Editor. A row click
    // that also opened the lightbox, or a pencil that ticked the row, is what
    // the design's frame of two ticked rows rules out.
    const navigated = fold(
      Message.ToggledRowSelection({ id: PAGE[1]?.id ?? '' }),
      Message.OpenedPhoto({ id: row(1).id }),
    )
    expect(navigated.commands.map((command) => command.name)).toEqual(['Navigate'])
    expect(navigated.model.selected).toEqual([PAGE[1]?.id])
    Scene.scene(
      app,
      given(),
      Scene.click(rowSelect('Photograph 2')),
      Scene.expect(Scene.selector('[data-slot="bulk-bar"]')).toExist(),
      Scene.expect(Scene.selector('[data-slot="library-row"][data-selected="true"]')).toExist(),
      Scene.click(Scene.role('button', { name: 'Edit Photograph 1' })),
      Scene.Command.resolve(NavigateCmd({ url: PHOTO_ROUTE }), Message.CompletedNavigate()),
      // The navigation did not also tick the row it was fired from.
      Scene.expect(Scene.text('1 SELECTED')).toExist(),
    )
  })

  it('is cleared by a filter change, because it named the rows that just went away', () => {
    // A selection of forty that silently followed a new query is a bulk
    // operation on forty Photographs the operator never chose.
    const filtered = fold(
      Message.ToggledRowSelection({ id: PAGE[0]?.id ?? '' }),
      Message.ToggledRowSelection({ id: PAGE[1]?.id ?? '' }),
      Message.ToggledTagFilter({ id: 'kyoto' }),
    )
    expect(filtered.model.selected).toEqual([])
    expect(filtered.commands.map((command) => command.name)).toEqual(['FetchPhotos'])
    Scene.scene(
      app,
      given(),
      Scene.click(box('Photograph 1')),
      Scene.click(box('Photograph 2')),
      Scene.expect(Scene.selector('[data-slot="bulk-bar"]')).toExist(),
      Scene.click(Scene.role('button', { name: 'Kyoto 38' })),
      Scene.Command.resolve(FetchPhotosCmd({ tagIds: ['kyoto'], q: '' }), listed([], 0, null)),
      Scene.Command.resolve(ReplaceUrlCmd, Message.CompletedNavigate()),
      Scene.expect(Scene.selector('[data-slot="bulk-bar"]')).not.toExist(),
    )
  })

  it('reads the head’s box off the page, not off the filtered total', () => {
    // 412 rows exist and seven are on screen. "All" is the seven.
    Scene.scene(
      app,
      given(),
      Scene.expect(headBox()).toHaveAttr('aria-checked', 'false'),
      Scene.click(headBox()),
      Scene.expect(headBox()).toBeChecked(),
      Scene.expect(Scene.text('7 SELECTED')).toExist(),
      // Un-ticking one row is the mixed state; ticking it back is all of them.
      Scene.click(box('Photograph 4')),
      Scene.expect(headBox()).toHaveAttr('aria-checked', 'mixed'),
      Scene.click(box('Photograph 4')),
      Scene.expect(headBox()).toBeChecked(),
      // Un-ticking the box from "all" clears the page, and nothing beyond it.
      Scene.click(headBox()),
      Scene.expect(Scene.selector('[data-slot="bulk-bar"]')).not.toExist(),
    )
  })
})

describe('the Bulk Bar', () => {
  it('says Delete moves to Trash, and names the irreversible step as the Trash’s', () => {
    Scene.scene(
      app,
      given(),
      Scene.click(box('Photograph 1')),
      Scene.click(box('Photograph 2')),
      Scene.click(Scene.role('button', { name: 'Delete' })),
      ...opened(CONFIRM),
      // The one confirm every destructive action uses, and its copy says the
      // delete is a soft one rather than leaving the word "delete" to imply
      // otherwise.
      Scene.expect(Scene.role('button', { name: 'Yes, move to Trash' })).toExist(),
      Scene.expect(
        Scene.text(
          '2 photographs will be moved to Trash. You can restore them from the Trash; purging is the only irreversible step.',
        ),
      ).toExist(),
    )
  })

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
      '1 photo moved to Trash — Recoverable from the Trash. Purging is the only irreversible step.',
    ])
  })

  it('Add tag is Move to series, re-pointed, and it applies exactly what was ticked', () => {
    // A Series page *is* a Tag page (ADR 0008), so the grouping entity the
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
    ).toEqual(['Tagged 1 photo — “Kyoto”'])
  })

  it('the Add tag picker is a Dialog of the known Tags, and never the Series wording', () => {
    Scene.scene(
      app,
      given(),
      Scene.click(box('Photograph 1')),
      Scene.click(Scene.role('button', { name: 'Add tag' })),
      ...opened(ADD_TAG),
      Scene.expectAll(Scene.all.text('Move to series')).toBeEmpty(),
      Scene.expect(box('Kyoto')).toHaveAttr('aria-checked', 'false'),
      // Nothing ticked is nothing to apply, so the action is unavailable rather
      // than a button that does nothing.
      Scene.expect(Scene.selector('[data-slot="add-tag-confirm"]')).toHaveAttr('data-disabled', ''),
      Scene.click(box('Kyoto')),
      Scene.expect(box('Kyoto')).toBeChecked(),
      Scene.expect(Scene.selector('[data-slot="add-tag-confirm"]')).not.toHaveAttr('data-disabled'),
    )
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

  it('names the two row actions the design leaves unlabelled', () => {
    Scene.scene(
      app,
      given(),
      Scene.click(Scene.role('button', { name: 'More actions for Photograph 1' })),
      ...opened(ROW_MENU),
      Scene.expect(Scene.role('button', { name: 'Unpublish' })).toExist(),
      Scene.expect(Scene.role('button', { name: 'Move to Trash' })).toExist(),
    )
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
      args: { tagIds: [], q: '', cursor: NEXT_CURSOR },
    })
    Scene.scene(
      app,
      given(),
      Scene.click(Scene.role('button', { name: 'Next page' })),
      Scene.Command.resolve(
        FetchPhotosCmd({ tagIds: [], q: '', cursor: NEXT_CURSOR }),
        listed(SECOND, 412, 'cursor-after-page-two'),
      ),
      Scene.Command.resolve(ReplaceUrlCmd, Message.CompletedNavigate()),
      Scene.expect(Scene.text('8–14 OF 412')).toExist(),
    )
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
    expect(back.commands[1]?.args).toEqual({ tagIds: [], q: '', cursor: '' })
    expect(back.model.libraryPage).toBe(0)
    expect(back.model.libraryCursors).toEqual([''])
    Scene.scene(
      app,
      Scene.given(onSecond.model),
      Scene.click(Scene.role('button', { name: 'Previous page' })),
      Scene.Command.resolve(FetchPhotosCmd({ tagIds: [], q: '', cursor: '' }), listed()),
      Scene.Command.resolve(ReplaceUrlCmd, Message.CompletedNavigate()),
      Scene.expect(Scene.text('1–7 OF 412')).toExist(),
    )
  })

  it('the first page cannot go back and the last cannot go on', () => {
    const first = fold(Message.SteppedLibraryPage({ delta: -1 }))
    expect(first.commands).toEqual([])
    const onLast = update(
      fold(listed(PAGE, 412, null)).model,
      Message.SteppedLibraryPage({ delta: 1 }),
    )
    expect(onLast.commands ?? []).toEqual([])
    Scene.scene(
      app,
      given(),
      Scene.expect(Scene.role('button', { name: 'Previous page' })).toHaveAttr('disabled', 'true'),
    )
    Scene.scene(
      app,
      given(PAGE, 412, null),
      Scene.expect(Scene.role('button', { name: 'Next page' })).toHaveAttr('disabled', 'true'),
    )
  })
})

describe('the states that are not rows', () => {
  it('a filter that matches nothing is not the same claim as an empty Library', () => {
    const settled = fold(Message.ToggledTagFilter({ id: 'kyoto' }), listed([], 0, null))
    expect(settled.model.activeTagIds).toEqual(['kyoto'])
    Scene.scene(
      app,
      Scene.given(settled.model),
      Scene.expect(Scene.text('Nothing matches this filter')).toExist(),
      Scene.expect(Scene.text('No frames yet')).not.toExist(),
      Scene.click(Scene.role('button', { name: 'Clear the Tag filter' })),
      Scene.Command.resolve(FetchPhotosCmd({ tagIds: [], q: '' }), listed([], 0, null)),
      Scene.Command.resolve(ReplaceUrlCmd, Message.CompletedNavigate()),
    )
  })

  it('an empty Library is the design’s own state, not the grid’s', () => {
    Scene.scene(
      app,
      given([], 0, null),
      Scene.expect(Scene.text('No frames yet')).toExist(),
      Scene.expect(
        Scene.text('Drop your first photograph, or choose files from this computer.'),
      ).toExist(),
      Scene.expect(Scene.text('Choose files')).toExist(),
      Scene.expect(Scene.text('Import from a folder')).toExist(),
      // Both pickers are real: a label wrapping a hidden file input, not a
      // second dead button. The folder one asks for a directory.
      Scene.expectAll(Scene.all.selector('input[type="file"]')).toHaveCount(2),
      Scene.expect(Scene.selector('input[webkitdirectory]')).toExist(),
      // The promise about what will be accepted, pinned to the design's literal
      // so a change to PHOTO_RATIOS cannot silently drift it.
      Scene.expect(
        Scene.text('3:2 · 2:3 · 4:3 · 3:4 · 16:9 · 9:16 · ORIGINALS ARE KEPT'),
      ).toExist(),
    )
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

  it('a failed read still keeps the grid’s own error state', () => {
    const failed = update(
      cold(),
      Message.FailedRpc({ message: 'the Library could not be read' }),
    ).model
    Scene.scene(
      app,
      Scene.given(failed),
      Scene.expect(Scene.text('the Library could not be read')).toExist(),
      Scene.expect(Scene.role('button', { name: 'Retry' })).toExist(),
    )
  })
})
