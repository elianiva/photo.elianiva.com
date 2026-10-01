/**
 * The Library's filter state, driven through the URL. Every assertion here is
 * about the one fact #26 turns on: the address bar and the Model are the same
 * filter, so a filter change is a URL the operator can reload and a cold load
 * of that URL draws what the click drew.
 *
 * The filter bar the operator clicks is a page, and what it draws is verified
 * in the browser (`.agents/skills/verify-photo`); what is asserted here is the
 * round trip behind it — the Model, the RPC it asks for, and the URL it writes.
 */

import { Option } from 'effect'
import { fromString as urlFromString } from 'foldkit/url'
import { describe, expect, it } from 'vitest'
import { PhotoId } from '@photo/shared'
import type { PhotoWithTags } from '@photo/shared'

import { Message } from './model'
import type { Model } from './model'
import { libraryUrl, libraryViewOf, urlToAppRoute } from './route'
import { init, update } from './update'

const ORIGIN = 'https://photo.elianiva.com'

const at = (pathname: string) => {
  const parsed = urlFromString(`${ORIGIN}${pathname}`)
  if (Option.isNone(parsed)) throw new Error(`not a URL: ${pathname}`)
  return parsed.value
}

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

const PAGE: ReadonlyArray<PhotoWithTags> = Array.from({ length: 7 }, (_, index) => row(index + 1))

const listed = (
  photos: ReadonlyArray<PhotoWithTags> = PAGE,
  total = 412,
  nextCursor: string | null = null,
) => Message.SucceededFetchPhotos({ photos: [...photos], nextCursor, total })

const COLD_READS = [
  Message.SucceededGetSession({ email: 'owner@photo.test', teamDomain: 'https://a.test' }),
  Message.SucceededGetCounts({
    total: 412,
    trashed: 3,
    byStatus: { draft: 7, published: 402, failed: 1 },
    byTag: [],
  }),
  Message.SucceededGetStorage({ photos: 412, bytes: 1, capBytes: 1 }),
  Message.SucceededFetchTags({ tags: [] }),
]

/** A cold load of a URL: the same messages the runtime would fold, through the
 *  same `update`. This is what a reload does. */
const cold = (pathname: string, response: Message = listed()): Model =>
  [...COLD_READS, response].reduce(
    (model, message) => update(model, message).model,
    init(at(pathname)).model,
  )

/** Fold a run of messages over a cold Library and report the admin Commands
 *  each one dispatched — the RPCs and the URL moves. */
const fold = (
  ...messages: ReadonlyArray<Message>
): { model: Model; commands: ReadonlyArray<{ name: string; args?: unknown }> } => {
  let model = cold('/admin')
  const commands: Array<{ name: string; args?: unknown }> = []
  for (const message of messages) {
    const result = update(model, message)
    model = result.model
    for (const command of result.commands ?? []) {
      if (command.name === 'FetchPhotos' || command.name === 'ReplaceUrl') {
        commands.push({ name: command.name, args: command.args })
      }
    }
  }
  return { model, commands }
}

describe('the URL is the filter', () => {
  it('parses every filter out of the query, and prints the default URL as /admin', () => {
    expect(libraryUrl()).toBe('/admin')
    expect(
      urlToAppRoute(
        at('/admin?status=draft&ratio=3:2&tag=kyoto,nyc&sort=oldest&q=sun&page=2&view=grid'),
      ),
    ).toEqual(expect.objectContaining({ _tag: 'Library' }))
    expect(
      libraryUrl({
        status: 'draft',
        ratio: '3:2',
        tagIds: ['kyoto', 'nyc'],
        sort: 'oldest',
        q: 'sun',
        page: 2,
        view: 'grid',
      }),
    ).toBe('/admin?status=draft&ratio=3%3A2&tag=kyoto%2Cnyc&sort=oldest&q=sun&page=2&view=grid')
  })

  it('a status pick moves the model, re-reads with the status, and replaces the URL', () => {
    const picked = fold(Message.SelectedStatusFilter({ value: 'draft' }))
    expect(picked.model.statusFilter).toBe('draft')
    expect(picked.commands).toEqual([
      { name: 'FetchPhotos', args: { tagIds: [], q: '', status: 'draft' } },
      { name: 'ReplaceUrl', args: { url: '/admin?status=draft' } },
    ])
  })

  it('a sort pick sends the sort to the read and rewrites the URL with it', () => {
    const sorted = fold(Message.SelectedSortFilter({ value: 'oldest' }))
    expect(sorted.commands[0]).toEqual({
      name: 'FetchPhotos',
      args: { tagIds: [], q: '', sort: { key: 'takenAt', direction: 'asc' } },
    })
    expect(sorted.commands[1]).toEqual({ name: 'ReplaceUrl', args: { url: '/admin?sort=oldest' } })
    // One fact, two places on the page: the Model's sort is what both the
    // select and the table head read, so there is no second copy to drift.
    const model = sorted.model
    expect(model.sortFilter).toBe('oldest')
  })

  it('toggling the sort flips it back and forth with the URL', () => {
    const toggled = fold(Message.ToggledSort({}))
    expect(toggled.model.sortFilter).toBe('oldest')
    expect(toggled.commands[1]).toEqual({ name: 'ReplaceUrl', args: { url: '/admin?sort=oldest' } })
    const back = update(toggled.model, Message.ToggledSort({}))
    expect(back.model.sortFilter).toBe('newest')
  })

  it('the list/grid toggle moves the URL without re-reading the rows', () => {
    const gridView = fold(Message.SelectedView({ view: 'grid' }))
    expect(libraryViewOf(gridView.model.route)).toBe('grid')
    // A view is not a query: the rows are the rows already on screen.
    expect(gridView.commands).toEqual([{ name: 'ReplaceUrl', args: { url: '/admin?view=grid' } }])
  })

  it('a tag pick keeps the rest of the filter and rewrites the one key', () => {
    // The sidebar owns the tag set; this asserts the URL it produces carries
    // the current status beside the tag.
    const tagged = fold(
      Message.SelectedStatusFilter({ value: 'draft' }),
      Message.ToggledTagFilter({ id: 'kyoto' }),
    )
    expect(tagged.commands[3]).toEqual({
      name: 'ReplaceUrl',
      args: { url: '/admin?status=draft&tag=kyoto' },
    })
  })

  it('SCHEDULED is recorded in the URL but dispatches no read, because nothing records a publish time', () => {
    const scheduled = fold(Message.SelectedStatusFilter({ value: 'scheduled' }))

    // The filter is still real — it round-trips through the URL and comes back
    // on a cold load — but there is no server query to send, so the one
    // command is the URL move and nothing else. Asserting the emptied rows here
    // would be no use at all: every filter change empties them while its read
    // is in flight, so a Scheduled page and a Draft page would agree.
    expect(scheduled.model.statusFilter).toBe('scheduled')
    expect(scheduled.commands).toEqual([
      { name: 'ReplaceUrl', args: { url: '/admin?status=scheduled' } },
    ])
    expect(init(at('/admin?status=scheduled')).model.statusFilter).toBe('scheduled')
  })
})

describe('a reload restores the filtered page', () => {
  it('a cold load of the URL a filter wrote reads with that filter', () => {
    const coldLoad = init(at('/admin?status=draft'))
    expect(coldLoad.model.statusFilter).toBe('draft')
    expect(
      (coldLoad.commands ?? [])
        .filter((command) => command.name === 'FetchPhotos')
        .map((command) => command.args),
    ).toEqual([{ tagIds: [], q: '', status: 'draft' }])
  })

  it('a Back press to a filter the Model does not hold re-reads it', () => {
    // The Model holds status=draft, route and all; the URL moves back to the
    // unfiltered Library. The shell is re-read and the list is read under the
    // new filter.
    const moved = update(cold('/admin?status=draft'), Message.ChangedUrl({ url: at('/admin') }))
    expect(moved.model.statusFilter).toBe('all')
    expect((moved.commands ?? []).map((command) => command.name)).toEqual([
      'FetchSession',
      'FetchCounts',
      'FetchStorage',
      'FetchPhotos',
    ])
  })
})
