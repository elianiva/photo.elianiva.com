/**
 * The Admin shell's state: what a refused session leaves behind, and the counts
 * the rail's meter is measured from. Every step goes through the real `init` /
 * `update`, and the seed is a cold load whose responses have been folded
 * through the same `update` the runtime folds Command results through.
 *
 * The chrome itself — the sidebar's rows, the storage meter, the Page Head — is
 * a page, and a page is verified in the browser
 * (`.agents/skills/verify-photo`). What is asserted here is the read each
 * gesture asks for and the Model each one leaves.
 */

import { Option } from 'effect'
import { fromString as urlFromString } from 'foldkit/url'
import { describe, expect, it } from 'vitest'

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

const COUNTS: Counts = {
  total: 412,
  trashed: 3,
  byStatus: { draft: 7, published: 402, failed: 1 },
}

const listed = Message.SucceededFetchPhotos({ photos: [], nextCursor: null, total: 0 })

/** A cold load of `pathname` with the operator signed in and the library
 *  answered: the session claim, the counts, the tags and the list, in the order
 *  the API would answer them. */
const signedIn = (pathname: string): Model =>
  [
    Message.SucceededGetSession({ email: OWNER, teamDomain: TEAM }),
    Message.SucceededGetCounts(COUNTS),
    Message.SucceededFetchTags({ tags: [] }),
    listed,
  ].reduce((model, message) => update(model, message).model, init(at(pathname)).model)

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

describe('the rail\u2019s meter', () => {
  it('is measured from the counts the nav and the Storage block read', () => {
    // The rail, the nav's rows and the Settings Storage block all draw the one
    // `GetCounts` payload, so the fraction the meter fills and the numbers
    // beside it cannot come from two different reads. There is no byte total
    // here: `bytes` is a column only an upload writes, so a meter over it read
    // zero for the whole of an existing Library.
    const { counts } = signedIn('/admin')
    expect(counts.total).toBe(COUNTS.total)
    expect(counts.trashed).toBe(COUNTS.trashed)
    expect(counts.byStatus.published).toBe(COUNTS.byStatus.published)
  })
})
