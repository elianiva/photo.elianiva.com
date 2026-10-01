/**
 * A Tag page, rendered the way the Worker renders it.
 *
 * A Series page *is* a Tag page (ADR 0006), and before this the site had no
 * such document at all: the Folio named `STREET`, `LANDSCAPE` and `SERIES` in
 * the Masthead and pointed all three at a 404. So what this pins is that the
 * document at `/tag/<slug>` is the read's own Tag — its name, its caption, its
 * photographs and nothing else — and that the Folio marks it by its own href.
 *
 * The read is a fixture rather than a live D1 call because a unit test must not
 * depend on a Cloudflare account. What it pins is the shape the Worker hands
 * `init`, which is the shape `PublicPhotoService.byTag` produces.
 */

import { Effect } from 'effect'
import * as Server from 'foldkit/experimental/server'
import { describe, expect, it } from 'vitest'

import { PhotoId, type PhotoWithTags } from '@photo/shared'

import { EMPTY_EDITION, type FolioEntry, tagPageOf, type TagRead } from './content'
import { Flags, Model } from './model'
import { init } from './update'
import { view } from './view'

const taken = (
  id: string,
  over: Partial<PhotoWithTags> & { readonly number: number },
): PhotoWithTags => ({
  id: PhotoId.make(id),
  slug: id,
  title: id,
  r2Key: `originals/${id}.jpg`,
  width: 3000,
  height: 2000,
  ratio: '3:2',
  bytes: 2048,
  takenAt: '2026-06-11',
  aperture: 2,
  shutter: 0.002,
  iso: 200,
  focalLength: 25,
  metadata: { camera: 'X-T20' },
  ...over,
})

/** One Tag with two published photographs under it. */
const read = (over: Partial<TagRead['tag']> = {}): TagRead => ({
  tag: {
    slug: 'night',
    label: 'Night',
    caption: 'The hour the city stops pretending.',
    ...over,
  },
  photos: [
    taken('momo', { number: 3, title: 'Momo' }),
    taken('lift', { number: 1, title: 'Lift', takenAt: '2026-05-30' }),
  ],
})

/** Two Tags the Folio read returned, in the read's order — the one the Folio
 *  links and the one this page is. */
const FOLIO: ReadonlyArray<FolioEntry> = [
  { slug: 'night', label: 'Night' },
  { slug: 'street', label: 'Street' },
]

const config = { Model, Flags, init, view }

const render = async (tag: TagRead): Promise<string> =>
  (
    await Effect.runPromise(
      Server.renderToString(config, {
        buildId: 'test',
        flags: {
          route: 'tag' as const,
          // A Tag page has no Edition to page through, and the Front's and the
          // About page's fields are empty on this document — the shape the
          // Worker hands a render of a Tag page.
          edition: EMPTY_EDITION,
          nextSectionCursor: null,
          plates: [],
          // Built by the same mapping the Worker's read goes through, so a
          // Tag page can only ever print a plate the read returned.
          tag: tagPageOf(tag),
          folio: FOLIO,
        },
      }),
    )
  ).html

describe('a Tag page', () => {
  it('is headed by the Tag’s own label and its own caption', async () => {
    const html = await render(read())

    expect(html).toContain('<h1')
    expect(html).toContain('Night')
    expect(html).toContain('The hour the city stops pretending.')
  })

  it('prints every photograph the read returned, from this site’s own image route', async () => {
    const html = await render(read())

    expect(html).toContain('/api/image/originals%2Fmomo.jpg')
    expect(html).toContain('/api/image/originals%2Flift.jpg')
    expect(html).not.toContain('unsplash')
    expect(html).not.toContain('cdn-cgi/image')
  })

  it('marks its own link in the Folio, by the slug the path is named with', async () => {
    const html = await render(read())
    const current = [...html.matchAll(/<a[^>]*aria-current="page"[^>]*href="([^"]+)"/g)].map(
      (match) => match[1],
    )

    // Not `ALL`: the reader is on this Tag's page, so this Tag's own href is
    // the one the rule marks.
    expect(current).toEqual(['/tag/night'])
  })

  it('draws no Continued row, because a Tag page is not paged', async () => {
    const html = await render(read())

    expect(html).not.toContain('Load more photographs')
  })

  it('leaves the caption out rather than printing an empty deck', async () => {
    const html = await render(read({ caption: null }))

    expect(html).toContain('Night')
    // The photographs are still there: a Tag nobody captioned is a page with a
    // name and no deck, not an empty page.
    expect(html).toContain('/api/image/originals%2Fmomo.jpg')
  })
})
