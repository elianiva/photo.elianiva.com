/**
 * The About page, rendered the way the Worker renders it.
 *
 * The same contract the Front is held to, on the second public document: the
 * plates on the page are the photographs the read returned, the placard numbers
 * and Exif lines are those photographs' own facts, and every other word on the
 * page is authored in the view rather than read. The read is a fixture rather
 * than a live D1 call, for the reason the Front's is: a unit test must not
 * depend on a Cloudflare account. What it pins is which half of the page is a
 * read and which half is the design's copy, because those two are exactly what
 * a second implementation of this page would get wrong.
 */

import { Effect, Schema as S } from 'effect'
import * as Server from 'foldkit/experimental/server'
import { describe, expect, it } from 'vitest'

import { PhotoId, type PhotoWithTags } from '@photo/shared'

import { EMPTY_TAG_PAGE, figuresOf, type FolioEntry } from './content'
import { Flags, Model } from './model'
import { init } from './update'
import { view } from './view'

// ---------------------------------------------------------------------------
// a read, shaped exactly as `PublicPhotoService.list` shapes one
// ---------------------------------------------------------------------------

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
  takenAt: '2025-08-31',
  aperture: 5.6,
  shutter: 0.002,
  iso: 200,
  focalLength: 25,
  metadata: { camera: 'X-T20' },
  ...over,
})

/** Two published photographs, one of them carrying no fact an Exif line is
 *  made of. */
const read = (
  photos: ReadonlyArray<PhotoWithTags> = [
    taken('sudirman', { number: 1, title: 'Morning on Jalan Sudirman' }),
    taken('fire-escapes', {
      number: 2,
      title: 'Fire escapes and laundry',
      ratio: '2:3',
      aperture: null,
      shutter: null,
      iso: null,
      focalLength: null,
      metadata: {},
      takenAt: undefined,
    }),
  ],
): ReadonlyArray<PhotoWithTags> => photos

/** Two Tags the Folio read returned, in the read's order. */
const FOLIO: ReadonlyArray<FolioEntry> = [
  { slug: 'jakarta', label: 'Jakarta' },
  { slug: 'night', label: 'Night' },
]

/** The same config object the Worker renders, for the same reason the Front's
 *  is hoisted: `renderToString` has a Flags and a no-Flags overload, and
 *  TypeScript picks between them from the config literal. */
const config = { Model, Flags, init, view }

const renderApplication = (photos: ReadonlyArray<PhotoWithTags>) =>
  Effect.runPromise(
    Server.renderToString(config, {
      buildId: 'test',
      flags: {
        route: 'about' as const,
        // The Front's fields, empty on this document — the shape the Worker
        // hands a render of the About page.
        edition: { sections: [], tail: 'empty' as const },
        nextSectionCursor: null,
        plates: figuresOf(photos),
        // Likewise the Tag page's: the About page is not a Tag's page.
        tag: EMPTY_TAG_PAGE,
        // The Folio is the one read every document carries.
        folio: FOLIO,
      },
    }),
  )

const render = async (photos: ReadonlyArray<PhotoWithTags>): Promise<string> =>
  (await renderApplication(photos)).html

const renderDocument = async (photos: ReadonlyArray<PhotoWithTags>): Promise<string> =>
  Server.injectIntoTemplate(
    '<!doctype html><html><head><title>t</title></head><body><div id="root"></div></body></html>',
    await renderApplication(photos),
  )

// ---------------------------------------------------------------------------
// the page is the design's document
// ---------------------------------------------------------------------------

describe('the rendered About page', () => {
  it("prints the page the design draws, in the design's order", async () => {
    const html = await render(read())
    expect(html).toContain('the short version')
    expect(html).toContain('Mostly Jakarta, shot on the way to things.')
    // The prose: the two desktop columns, and the mobile master's re-flowed
    // paragraph. All three are authored, so all three are in the document.
    expect(html).toContain('I shoot on the way to things')
    expect(html).toContain('I keep everything, including the ones I do not like.')
    expect(html).toContain('Each photograph gets a number, a date, and whatever exposure')
  })

  it("prints the Kit as the design's four spec rows", async () => {
    const html = await render(read())
    expect(html).toContain('KIT')
    expect(html).toContain('FUJIFILM X-T20')
    expect(html).toContain('25MM F/1.8')
    // `SINCE` and `OUTPUT` are labels, so assert the values they pair with.
    expect(html).toContain('2021')
    expect(html).toContain('ORIGINAL FILES ONLY')
  })

  it('marks ABOUT as the section the reader is on', async () => {
    const html = await render(read())
    // The Nav Link prints `aria-current="page"` on the current section, and the
    // current one is the document's own route — not the first link in the list,
    // and not the Tag the read happened to return first.
    const current = [...html.matchAll(/<a[^>]*aria-current="page"[^>]*href="([^"]+)"/g)].map(
      (match) => match[1],
    )
    expect(current).toEqual(['/about'])
  })

  it('carries the colophon and the masthead, the chrome both documents share', async () => {
    const html = await render(read())
    expect(html).toContain('Elianiva')
    expect(html).toContain('back to top')
    expect(html).toContain('Set in Newsreader, Libre Franklin and IBM Plex Mono.')
  })

  it('titles the page as the About page rather than the Front', async () => {
    const rendered = await renderApplication(read())
    expect(rendered.title).toBe('photo.elianiva.com — about')
  })
})

// ---------------------------------------------------------------------------
// the plates come from the read
// ---------------------------------------------------------------------------

describe("the About page's plates", () => {
  it('prints a plate for every photograph the read returned', async () => {
    const html = await render(read())
    expect(html).toContain('Morning on Jalan Sudirman')
    expect(html).toContain('Fire escapes and laundry')
  })

  it('serves each plate from R2 by its own key', async () => {
    const html = await render(read())
    expect(html).toContain('/api/image/originals%2Fsudirman.jpg')
    expect(html).toContain('/api/image/originals%2Ffire-escapes.jpg')
    expect(html).not.toContain('cdn-cgi/image')
  })

  it('takes each placard number from the photograph', async () => {
    const html = await render(read())
    expect(html).toContain('No. 001')
    expect(html).toContain('No. 002')
  })

  it('omits the Exif line for a photograph that carries none of the facts', async () => {
    const html = await render(read())
    // One of the two photographs carries no aperture, shutter, ISO or focal
    // length, so it has no Exif line at all: a line with nothing in it reads as
    // a fault in the photograph (CONTEXT.md).
    const lines = [...html.matchAll(/<span class="[^"]*\btype-exif\b[^"]*">([^<]*)</g)]
      .map((match) => match[1] ?? '')
      .filter((line) => line.includes('ISO'))
    expect(lines).toEqual(['X-T20 · 25MM · F/5.6 · 1/500 · ISO 200 · 31 AUG'])
  })

  it('draws the second plate only on the mobile master, and fetches it lazily', async () => {
    const html = await render(read())
    // The desktop master draws one plate; the mobile master draws two. A plate
    // the desktop composition never lays out must not fetch a Photo's original
    // there — this zone has no resizer, so every plate is the whole file
    // (ADR 0002). The wrapper is hidden at `desktop` and the image is `lazy`,
    // which a browser that never lays it out never asks for.
    const wrappers = [...html.matchAll(/<div class="hidden desktop:block"[^>]*>(.*?)<\/div>/gs)]
    expect(wrappers).toHaveLength(1)
    expect(wrappers[0]?.[1]).toContain('/api/image/originals%2Ffire-escapes.jpg')
    expect(wrappers[0]?.[1]).toContain('loading="lazy"')
    // The page's own plate is the first paint, so it is eager.
    expect(html).toContain('loading="eager"')
  })

  it('draws the prose and the kit on a site with nothing published', async () => {
    const html = await render(read([]))
    // An empty read is a real state, not a broken page: the About page is words
    // and a kit, so it reads as a page with no plate on it.
    expect(html).toContain('the short version')
    expect(html).toContain('KIT')
    expect(html).not.toContain('/api/image/')
  })

  it('opens a plate in the lightbox, the way every other plate on the site does', async () => {
    const html = await render(read())
    // A plate is a button, not a dead image: the About page shares the Front's
    // Figure and the Front's lightbox, so a click resolves against the same
    // plate list the page drew.
    expect(html).toContain('aria-label="View Morning on Jalan Sudirman"')
  })
})

// ---------------------------------------------------------------------------
// the stamp the browser hydrates from
// ---------------------------------------------------------------------------

describe("the About page's hydration stamp", () => {
  it('carries the route and the plates into the document the browser adopts', async () => {
    const document = await renderDocument(read())
    const body = document.match(
      new RegExp(
        `<script[^>]*${Server.FOLDKIT_FLAGS_ATTRIBUTE}="[^"]*"[^>]*>([\\s\\S]*?)</script>`,
      ),
    )?.[1]
    if (body === undefined) throw new Error('no flags payload in the rendered document')
    const flags = S.decodeUnknownSync(Flags)(JSON.parse(body))
    // The browser has to know which document it is looking at: the Model's
    // `route` is what the view branches on, so a stamp without it would
    // re-render the Front over the About page's photographs.
    expect(flags.route).toBe('about')
    expect(flags.plates.map((plate) => plate.r2Key)).toEqual([
      'originals/sudirman.jpg',
      'originals/fire-escapes.jpg',
    ])
    expect(flags.plates[0]?.exif).toBe('X-T20 · 25MM · F/5.6 · 1/500 · ISO 200 · 31 AUG')
  })
})
