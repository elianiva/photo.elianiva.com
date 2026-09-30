/**
 * The Library grid and the view toggle that reaches it, driven the way the
 * operator drives them: the route's own `view`, the two Icon Buttons, the
 * square tiles with their blurhash placeholders, and a tile click opening the
 * Editor route.
 *
 * The three things this pins that the table's own suite cannot: the view is
 * route state (the URL is where it lives), a tile is a link to the Editor and
 * not a lightbox, and the grid shares the table's Pager so switching views
 * cannot leave the two disagreeing about the page.
 */

import { Option } from 'effect'
import { Scene } from 'foldkit'
import { fromString as urlFromString } from 'foldkit/url'
import { describe, expect, it } from 'vitest'
import { PhotoId, TagId } from '@photo/shared'
import type { PhotoWithTags, Tag } from '@photo/shared'

import { NavigateCmd, ReplaceUrlCmd } from './commands'
import { Message } from './model'
import type { Model } from './model'
import { defaultLibraryFilters, libraryRoute } from './route'
import { init, update } from './update'
import { view } from './view'

const ORIGIN = 'https://photo.elianiva.com'
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
  // `null` decodes as a Photo the encoder never ran on; the tile then falls
  // back to the plain neutral background rather than a broken data URL.
  blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
  tags: [],
  ...over,
})

const PAGE = Array.from({ length: 7 }, (_, index) => row(index + 1))
const NEXT_CURSOR = 'cursor-after-page-one'

const listed = (
  photos: ReadonlyArray<PhotoWithTags> = PAGE,
  total = 412,
  nextCursor: string | null = NEXT_CURSOR,
) => Message.SucceededFetchPhotos({ photos: [...photos], nextCursor, total })

/** A cold load of the Library at a view, with the read answered. */
const cold = (view: 'list' | 'grid'): Model => {
  const url = view === 'grid' ? '/admin?view=grid' : '/admin'
  return [
    Message.SucceededGetSession({ email: 'owner@photo.test', teamDomain: 'https://team.test' }),
    Message.SucceededFetchTags({ tags: [tag('kyoto', 'Kyoto')] }),
    listed(),
  ].reduce((model, message) => update(model, message).model, init(at(url)).model)
}

describe('the Library view toggle', () => {
  it('writes the route and replaces the URL, so the view is URL state', () => {
    const grid = update(cold('list'), Message.SelectedView({ view: 'grid' }))
    expect(grid.model.route).toEqual(libraryRoute({ ...defaultLibraryFilters, view: 'grid' }))
    expect(grid.commands?.map((command) => ({ name: command.name, args: command.args }))).toEqual([
      { name: 'ReplaceUrl', args: { url: '/admin?view=grid' } },
    ])

    const list = update(cold('grid'), Message.SelectedView({ view: 'list' }))
    expect(list.model.route).toEqual(libraryRoute())
    // The default view is named by omission, so a bare `/admin` is the list.
    expect(list.commands?.[0]?.args).toEqual({ url: '/admin' })
  })

  it('draws the grid from a cold load of `?view=grid`, paged by the shared Pager', () => {
    Scene.scene(
      app,
      Scene.given(cold('grid')),
      Scene.expect(Scene.selector('[data-slot="library-grid"]')).toExist(),
      Scene.expectAll(Scene.all.selector('[data-slot="photo-tile"]')).toHaveCount(7),
      // The same `1–7 OF 412` the table prints — one read, one pager.
      Scene.expect(Scene.text('1–7 OF 412')).toExist(),
    )
  })

  it('switching views switches which arrangement is drawn', () => {
    Scene.scene(
      app,
      Scene.given(cold('list')),
      // The table's own slot, and the grid toggle.
      Scene.expect(Scene.selector('[data-slot="library-table"]')).toExist(),
      Scene.expect(Scene.selector('[data-slot="library-grid"]')).not.toExist(),
      Scene.click(Scene.role('button', { name: 'Grid view' })),
      Scene.Command.resolve(
        ReplaceUrlCmd({ url: '/admin?view=grid' }),
        Message.CompletedNavigate(),
      ),
      Scene.expect(Scene.selector('[data-slot="library-grid"]')).toExist(),
      Scene.expect(Scene.selector('[data-slot="library-table"]')).not.toExist(),
    )
  })
})

describe('the tiles', () => {
  it('paint the blurhash placeholder into the square box, so bytes landing do not shift the grid', () => {
    Scene.scene(
      app,
      Scene.given(cold('grid')),
      Scene.expectAll(Scene.all.selector('[data-slot="photo-tile"]')).toHaveCount(7),
      Scene.expectAll(Scene.all.selector('[data-placeholder="blurhash"]')).toHaveCount(7),
    )
  })

  it('open the Editor route on click, not a lightbox', () => {
    Scene.scene(
      app,
      Scene.given(cold('grid')),
      Scene.expect(Scene.role('button', { name: 'Open Photograph 1' })).toExist(),
      Scene.click(Scene.role('button', { name: 'Open Photograph 1' })),
      // The tile is a link to the Photo route, which is the Editor — the one
      // destination the pencil reaches too. There is no lightbox any more.
      Scene.Command.resolve(NavigateCmd({ url: PHOTO_ROUTE }), Message.CompletedNavigate()),
      Scene.expect(Scene.selector('[data-slot="admin-edit-sheet"]')).not.toExist(),
    )
  })

  it('carry the Tags and the Edit / Delete pair in the hover overlay', () => {
    const tagged = PAGE.map((photo, index) =>
      index === 0 ? { ...photo, tags: [tag('kyoto', 'Kyoto')] } : photo,
    )
    Scene.scene(
      app,
      Scene.given(update(cold('grid'), listed(tagged)).model),
      Scene.expect(Scene.text('Kyoto')).toExist(),
      // One Edit and one Delete per tile.
      Scene.expectAll(Scene.all.selector('[data-slot="photo-tile"] button')).toHaveCount(14),
    )
  })
})
