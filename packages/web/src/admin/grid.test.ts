/**
 * The Library grid's one piece of state: the view is route state, so it lives
 * in the URL and both directions are read off the route table.
 *
 * What the grid *draws* — the tiles, their blurhash placeholders, the hover
 * overlay — is a page, and a page is verified in the browser
 * (`.agents/skills/verify-photo`), not by asserting markup here.
 */

import { Option } from 'effect'
import { fromString as urlFromString } from 'foldkit/url'
import { describe, expect, it } from 'vitest'
import { PhotoId, TagId } from '@photo/shared'
import type { PhotoWithTags, Tag } from '@photo/shared'

import { Message } from './model'
import type { Model } from './model'
import { libraryRoute, libraryViewOf } from './route'
import { init, update } from './update'

const ORIGIN = 'https://photo.elianiva.com'

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

const PAGE = Array.from({ length: 7 }, (_, index) => row(index + 1))

const cold = (pathname: string): Model =>
  [
    Message.SucceededGetSession({ email: 'owner@photo.test', teamDomain: 'https://team.test' }),
    Message.SucceededFetchTags({ tags: [tag('kyoto', 'Kyoto')] }),
    Message.SucceededFetchPhotos({ photos: [...PAGE], nextCursor: null, total: 412 }),
  ].reduce((model, message) => update(model, message).model, init(at(pathname)).model)

describe('the Library view toggle', () => {
  it('writes the route back to the bare Library when the view goes back to list', () => {
    const list = update(cold('/admin?view=grid'), Message.SelectedView({ view: 'list' }))
    expect(list.model.route).toEqual(libraryRoute())
    expect(libraryViewOf(list.model.route)).toBe('list')
    // The default view is named by omission, so a bare `/admin` is the list.
    // The other direction — list to grid — is asserted in `library-filters`.
    expect(list.commands?.[0]?.args).toEqual({ url: '/admin' })
  })

  it('reads the view off a cold load of the URL that names it', () => {
    expect(libraryViewOf(cold('/admin?view=grid').route)).toBe('grid')
    expect(libraryViewOf(cold('/admin').route)).toBe('list')
  })
})