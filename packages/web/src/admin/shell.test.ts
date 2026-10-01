/**
 * The Admin shell's state: the sidebar's tag narrowing, a tag's own lifecycle
 * from the sidebar, and what a refused session leaves behind. Every step goes
 * through the real `init` / `update`, and the seed is a cold load whose
 * responses have been folded through the same `update` the runtime folds
 * Command results through.
 *
 * The chrome itself — the sidebar's rows, the storage meter, the Page Head — is
 * a page, and a page is verified in the browser
 * (`.agents/skills/verify-photo`). What is asserted here is the read each
 * gesture asks for and the Model each one leaves.
 */

import { Option } from 'effect'
import { fromString as urlFromString } from 'foldkit/url'
import { describe, expect, it } from 'vitest'
import { STORAGE_CAP_BYTES, TagId } from '@photo/shared'
import type { Tag } from '@photo/shared'

import { Message } from './model'
import type { Counts, Model } from './model'
import { init, update } from './update'

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
  byTag: [
    { id: TagId.make('kyoto'), label: 'Kyoto', count: 38 },
    { id: TagId.make('nyc'), label: 'New York', count: 52 },
  ],
}

/** 7.9 GB and 412 Photos against the one cap `STORAGE_CAP_BYTES` declares,
 *  which is the same constant the Storage block is measured against and the
 *  same read the sidebar's meter draws. */
const STORAGE = { photos: 412, bytes: 7_900_000_000, capBytes: STORAGE_CAP_BYTES }

const listed = Message.SucceededFetchPhotos({ photos: [], nextCursor: null, total: 0 })

/** A cold load of `pathname` with the operator signed in and the library
 *  answered: the session claim, the counts, the storage aggregate, the tags
 *  and the list, in the order the API would answer them. */
const signedIn = (pathname: string): Model =>
  [
    Message.SucceededGetSession({ email: OWNER, teamDomain: TEAM }),
    Message.SucceededGetCounts(COUNTS),
    Message.SucceededGetStorage(STORAGE),
    Message.SucceededFetchTags({ tags: [...TAGS] }),
    listed,
  ].reduce((model, message) => update(model, message).model, init(at(pathname)).model)

/** Fold a run of messages over the signed-in shell and report the Commands
 *  each fold dispatched — the RPCs and the URL moves. */
const SHELL_COMMANDS = new Set(['CreateTag', 'FetchCounts', 'FetchPhotos', 'ReplaceUrl'])

const fold = (
  ...messages: ReadonlyArray<Message>
): { model: Model; commands: ReadonlyArray<{ name: string; args?: unknown }> } => {
  let model = signedIn('/admin')
  const commands: Array<{ name: string; args?: unknown }> = []
  for (const message of messages) {
    const result = update(model, message)
    model = result.model
    for (const command of result.commands ?? []) {
      if (SHELL_COMMANDS.has(command.name)) {
        commands.push({ name: command.name, args: command.args })
      }
    }
  }
  return { model, commands }
}

describe('the sidebar tags group', () => {
  it('narrowing is multi-select: a second tag adds to the fetch, not replaces it', () => {
    const one = fold(Message.ToggledTagFilter({ id: 'kyoto' }))
    expect(one.model.activeTagIds).toEqual(['kyoto'])
    expect(one.commands).toEqual([
      { name: 'FetchPhotos', args: { tagIds: ['kyoto'], q: '' } },
      { name: 'ReplaceUrl', args: { url: '/admin?tag=kyoto' } },
    ])

    const two = fold(
      Message.ToggledTagFilter({ id: 'kyoto' }),
      Message.ToggledTagFilter({ id: 'nyc' }),
    )
    expect(two.model.activeTagIds).toEqual(['kyoto', 'nyc'])
    expect(two.commands[2]).toEqual({
      name: 'FetchPhotos',
      args: { tagIds: ['kyoto', 'nyc'], q: '' },
    })
    expect(two.commands[3]).toEqual({
      name: 'ReplaceUrl',
      args: { url: '/admin?tag=kyoto%2Cnyc' },
    })
  })

  it('carries the applied tags through a submitted search', () => {
    const searched = fold(
      Message.ToggledTagFilter({ id: 'kyoto' }),
      Message.SetSearchQuery({ value: 'istanbul' }),
      Message.SubmittedSearch({}),
    )
    // A search narrows the tag set; it does not replace it, or a Tag picked
    // with care would quietly stop being a filter.
    expect(searched.commands[2]).toEqual({
      name: 'FetchPhotos',
      args: { tagIds: ['kyoto'], q: 'istanbul' },
    })
    expect(searched.commands[3]).toEqual({
      name: 'ReplaceUrl',
      args: { url: '/admin?tag=kyoto&q=istanbul' },
    })
  })

  it('creates a tag from the sidebar and re-reads the counts rather than splicing a row in', () => {
    // A new Tag carries no photos, but it does carry a row, so the counts are
    // re-read rather than the row spliced in — and the sheet that produced it
    // is gone, so a later close cannot act on a Tag the operator moved on from.
    const created = fold(
      Message.OpenedTagActions({ id: 'kyoto' }),
      Message.CreateTagRequested({ source: 'sidebar', label: 'lisbon' }),
    )
    expect(created.commands).toEqual([
      { name: 'CreateTag', args: { source: 'sidebar', label: 'lisbon' } },
    ])

    const createdAndRead = fold(
      Message.OpenedTagActions({ id: 'kyoto' }),
      Message.CreateTagRequested({ source: 'sidebar', label: 'lisbon' }),
      Message.SucceededCreateTag({ source: 'sidebar', tag: tag('lisbon', 'lisbon') }),
      Message.SucceededGetCounts(COUNTS),
    )
    expect(createdAndRead.model.tagActionsId).toBeUndefined()
    expect(createdAndRead.commands[1]).toEqual({ name: 'FetchCounts', args: undefined })
    expect(createdAndRead.model.tags.map((each) => each.slug)).toContain('lisbon')
  })

  it('a delete forgets its subject the moment it is asked for', () => {
    // The confirm the delete opens outlives the sheet that asked for it, so the
    // sheet cannot act on a Tag the operator has moved on from.
    const asked = update(signedIn('/admin'), Message.RequestDeleteTag({ id: 'kyoto', label: 'Kyoto' }))
    expect(asked.model.tagActionsId).toBeUndefined()
    expect(asked.model.pendingConfirm).toEqual({ kind: 'tag', id: 'kyoto', label: 'Kyoto' })
  })
})

describe('the session', () => {
  it('prints the verified claim and offers the Access sign-out', () => {
    const verified = signedIn('/admin')
    expect(verified.session).toEqual({ status: 'verified', email: OWNER, teamDomain: TEAM })
  })

  it('carries neither claim on the dev stand-down, where the gate verified nothing', () => {
    // The dev stage creates no Access applications, so there is no identity to
    // print and no session to end. A placeholder address would be a lie about
    // who is signed in, and a sign-out link would go nowhere.
    const ungated = update(
      signedIn('/admin'),
      Message.SucceededGetSession({ email: null, teamDomain: null }),
    ).model
    expect(ungated.session).toEqual({ status: 'verified', email: null, teamDomain: null })
  })

  it('a refused GetSession leaves the shell unproven, on the route it was asked for', () => {
    // Access gates the route before any of this runs (ADR 0003), so there is no
    // signed-out state and no sign-in form: the whole shell is replaced by the
    // session-expired affordance, which sends the operator back to the route
    // they were on rather than to the Admin's root.
    const refused = update(init(at('/admin/photos/abc')).model, Message.FailedGetSession({}))
    expect(refused.model.session.status).toBe('expired')
    expect(refused.model.route).toEqual({ _tag: 'Photo', id: 'abc' })
  })
})

describe('the storage meter', () => {
  it('reports the real aggregate against the one cap, never a placeholder', () => {
    // 7.9 GB of the 20 GiB `STORAGE_CAP_BYTES` declares, off the one read both
    // the meter and the Storage block are measured against.
    const { storage } = signedIn('/admin')
    expect(storage.photos).toBe(412)
    expect(storage.bytes).toBe(7_900_000_000)
    expect(storage.capBytes).toBe(STORAGE_CAP_BYTES)
  })
})