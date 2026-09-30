/**
 * The Front page, rendered the way the Worker renders it.
 *
 * This is the test that the front page has data behind it. The Front used to be
 * a module constant — an Edition of stock photographs, hardcoded counts and
 * Unsplash URLs — that no read ever touched, and the only way to notice was to
 * look at the page. So this renders the real view through the real SSR entry
 * point with a real read as Flags, and asserts the plates in the HTML are the
 * photographs the read returned.
 *
 * The read is a fixture rather than a live D1 call because a unit test must not
 * depend on a Cloudflare account. What it does pin is the contract that broke:
 * nothing on the page may come from anywhere but the Edition, and the Edition
 * may only be built by mapping the read.
 */

import { Effect, Schema as S } from 'effect'
import * as Server from 'foldkit/experimental/server'
import { describe, expect, it } from 'vitest'

import { PhotoId, type PhotoWithTags, type PublicSection } from '@photo/shared'

import { editionOf, type FrontRead } from './content'
import { Flags, Model } from './model'
import { init } from './update'
import { view } from './view'

// ---------------------------------------------------------------------------
// a read, shaped exactly as `PublicPhotoService.frontPage` shapes one
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
  takenAt: '2026-06-11',
  aperture: 2,
  shutter: 0.002,
  iso: 200,
  focalLength: 25,
  metadata: { camera: 'X-T20' },
  ...over,
})

const month = (key: string, photos: ReadonlyArray<PhotoWithTags>): PublicSection => ({
  month: key,
  year: key.slice(0, 4),
  label: `${key} label`,
  frames: photos.length,
  numberFrom: Math.min(...photos.map((p) => p.number ?? 0)),
  numberTo: Math.max(...photos.map((p) => p.number ?? 0)),
  photos,
})

/** Two published months, one photograph with no Ratio and one with no Exif. */
const read = (over: Partial<FrontRead> = {}): FrontRead => ({
  sections: [
    month('2026-06', [
      taken('momo', { number: 3, title: 'Momo', ratio: null }),
      taken('michi', {
        number: 4,
        title: 'Michi',
        ratio: null,
        aperture: null,
        shutter: null,
        iso: null,
        focalLength: null,
        metadata: {},
        takenAt: undefined,
      }),
    ]),
    month('2026-05', [taken('lift', { number: 1, title: 'Lift', ratio: '9:16', iso: 400 })]),
  ],
  nextSectionCursor: null,
  ...over,
})

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

/** The same config object the Worker renders, named rather than inlined.
 *
 *  `renderToString` has a Flags and a no-Flags overload, and TypeScript picks
 *  between them from the config literal. Inlined, the `Flags` schema and the
 *  `init` that consumes those flags are inferred at once and the no-Flags
 *  overload wins; hoisted to a name, the inference has something to read from
 *  and the Flags overload matches. `worker.ts` hoists it for the same reason,
 *  and this test renders through the shape production uses rather than a shape
 *  only a test can get away with. */
const config = { Model, Flags, init, view }

const renderApplication = (front: FrontRead) =>
  Effect.runPromise(Server.renderToString(config, { buildId: 'test', flags: frontFlags(front) }))

const render = async (front: FrontRead): Promise<string> => (await renderApplication(front)).html

/** The document the browser receives: the rendered app plus the hydration
 *  stamp, which is where the Flags travel. */
const renderDocument = async (front: FrontRead): Promise<string> =>
  Server.injectIntoTemplate(
    '<!doctype html><html><head><title>t</title></head><body><div id="root"></div></body></html>',
    await renderApplication(front),
  )

const stampedFlags = (document: string): typeof Flags.Type => {
  // The payload is the body of the JSON script tag, not the attribute — the
  // attribute only pairs the payload with the runtime id on the app root.
  const body = document.match(
    new RegExp(`<script[^>]*${Server.FOLDKIT_FLAGS_ATTRIBUTE}="[^"]*"[^>]*>([\\s\\S]*?)</script>`),
  )?.[1]
  if (body === undefined) throw new Error('no flags payload in the rendered document')
  return S.decodeUnknownSync(Flags)(JSON.parse(body))
}

const frontFlags = (front: FrontRead) => ({
  edition: editionOf(front),
  nextSectionCursor: front.nextSectionCursor,
})

// ---------------------------------------------------------------------------
// the plates come from the read
// ---------------------------------------------------------------------------

describe('the rendered Front', () => {
  it('prints a plate for every published photograph the read returned', async () => {
    const html = await render(read())
    expect(html).toContain('Momo')
    expect(html).toContain('Michi')
    expect(html).toContain('Lift')
  })

  it('serves each plate from R2 by its own key', async () => {
    const html = await render(read())
    expect(html).toContain('/api/image/originals%2Fmomo.jpg')
    expect(html).toContain('/api/image/originals%2Flift.jpg')
  })

  it('takes each plate number from the read, and prints no site counters', async () => {
    const html = await render(read())
    // The placards are the photographs' own Photo Numbers.
    expect(html).toContain('No. 003')
    expect(html).toContain('No. 004')
    expect(html).toContain('No. 001')
    // The masthead counts nothing: no issue, no volume, no frame total, no
    // date derived from the archive. The section head still counts the
    // photographs in its own month, which is a fact about the photographs.
    expect(html).not.toContain('VOL.')
    expect(html).not.toContain('NO. 006')
    expect(html).not.toContain('THIS EDITION')
    expect(html).toContain('02 FRAMES · NO. 003–004')
  })

  it('reads the Exif line off the photograph, not off a counter', async () => {
    const html = await render(read())
    // The day the frame was made comes out of that photograph's own `takenAt`,
    // which carries a time here; the Exif line prints the day and month.
    expect(html).toContain('11 JUN')
  })

  it('names each section from its month key', async () => {
    const html = await render(read())
    expect(html).toContain('June')
    expect(html).toContain('May')
  })

  it('omits the Exif line for a photograph that carries none of the facts', async () => {
    const html = await render(read())
    // Three photographs are on the page. Momo and Lift carry all six facts and
    // Michi carries none, so the page prints two distinct Exif lines and not
    // three.
    //
    // Matched on the one class that identifies an Exif line rather than on the
    // whole utility list: the classes around it are the responsive layout and
    // are free to change, and a test that breaks when a margin moves is a test
    // that gets deleted instead of fixed.
    const exifSpans = [
      ...html.matchAll(/<span class="[^"]*\btype-exif\b[^"]*">([^<]*)</g),
    ].map((match) => match[1] ?? '')
    // `type-exif` also types the section year and the colophon, so the
    // photographic lines are the ones carrying a fact of its own.
    const lines = exifSpans.filter((line) => line.includes('ISO'))
    expect(new Set(lines)).toEqual(
      new Set([
        'X-T20 · 25MM · F/2 · 1/500 · ISO 200 · 11 JUN',
        'X-T20 · 25MM · F/2 · 1/500 · ISO 400 · 11 JUN',
      ]),
    )
    // And the element is left out rather than rendered empty: an Exif line with
    // nothing in it reads as a fault in the photograph.
    expect(exifSpans.length).toBeGreaterThan(0)
    expect(exifSpans.every((line) => line.trim() !== '')).toBe(true)
  })

  it('serves every plate from this site’s own image route', async () => {
    const html = await render(read())
    // Asserted against what the document does carry — three plates, named in
    // the tests above — so a render that printed nothing at all cannot pass
    // this as a clean bill of health.
    expect(html).toContain('Momo')
    expect(html).toContain('/api/image/originals%2Fmomo.jpg')
    expect(html).not.toContain('unsplash')
    expect(html).not.toContain('cdn-cgi/image')
  })

  it('renders an honest empty edition rather than a placeholder list', async () => {
    const html = await render(read({ sections: [], nextSectionCursor: null }))
    expect(html).toContain('Nothing published yet.')
    expect(html).toContain('NOTHING PUBLISHED YET')
  })
})

// ---------------------------------------------------------------------------
// the stamp the browser hydrates from
// ---------------------------------------------------------------------------

describe('the hydration stamp', () => {
  it('carries the whole Edition into the document the browser adopts', async () => {
    // The browser decodes the Flags out of this payload rather than fetching
    // them, so it is the only thing standing between the Worker's read and the
    // page the reader ends up with.
    const flags = stampedFlags(await renderDocument(read()))
    expect(flags.edition.sections).toHaveLength(2)
    expect(flags.edition.sections[0]?.figures.map((figure) => figure.id)).toEqual([
      PhotoId.make('momo'),
      PhotoId.make('michi'),
    ])
    expect(flags.edition.sections[0]?.figures[0]?.r2Key).toBe('originals/momo.jpg')
  })

  it('encodes an empty edition as one, so the browser opens the same page', async () => {
    const flags = stampedFlags(
      await renderDocument(read({ sections: [], nextSectionCursor: null })),
    )
    expect(flags.edition.lead).toBeNull()
    expect(flags.edition.sections).toEqual([])
  })
})
