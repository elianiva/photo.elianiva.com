/**
 * Renders the site's OG card and touch icon with Takumi.
 *
 *   pnpm og
 *
 * The outputs are committed (`packages/web/public/og.png`, `apple-touch-icon.png`),
 * so a deploy does not need Takumi: run this when the card's design or the
 * palette changes. The card is the same for every page because nothing on it
 * depends on the archive: no photograph, no counter.
 *
 * The touch icon is the favicon's own mark on paper: `/favicon.svg` is read and
 * rasterized here rather than redrawn, so the tab icon and the home-screen icon
 * cannot drift apart. It takes the light branch's colours — iOS composites the
 * icon on its own ground, not on the browser's.
 *
 * Takumi does not resolve CSS custom properties, so the colours below are the
 * site's roles (`packages/web/src/theme.css`) written out. Re-check them when
 * the palette moves.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { render } from 'takumi-js'

const PAPER = '#f3f0e8'
const INK = '#1b1a18'
const ACCENT = '#c8105f'
/** The giant "photo." behind the URL: paper, one step down. */
const GHOST = '#e6e1d5'

const PUBLIC_DIR = resolve(import.meta.dirname, '../packages/web/public')
const font = (pkg: string, file: string): Buffer =>
  readFileSync(resolve(import.meta.dirname, `../node_modules/${pkg}/files/${file}`))

const FONTS = [
  {
    name: 'Instrument Serif',
    data: font('@fontsource/instrument-serif', 'instrument-serif-latin-400-normal.woff2'),
    weight: 400,
    style: 'normal' as const,
  },
]

/** 1200x630. The wordmark is two pieces: the giant, bleeding `photo.` and the
 *  URL on top of it with the one pink dot. */
const CARD = `
<div style="display:flex;position:relative;width:1200px;height:630px;background:${PAPER};overflow:hidden;font-family:'Instrument Serif'">
  <div style="position:absolute;left:-30px;top:-70px;font-size:640px;line-height:1;letter-spacing:-18px;color:${GHOST};white-space:nowrap">photo.</div>
  <div style="position:absolute;left:84px;bottom:68px;display:flex;font-size:130px;letter-spacing:-3px;color:${INK}">
    <span>elianiva</span><span style="color:${ACCENT}">.</span><span>com</span>
  </div>
</div>`

/** 180x180 touch icon: the favicon's mark on paper, at 156 of the 180. The SVG
 *  is inlined, so the raster follows the vector whenever the mark is redrawn. */
const TOUCH_ICON = (mark: string): string => `
<div style="display:flex;width:180px;height:180px;background:${PAPER};align-items:center;justify-content:center">
  <img src="data:image/svg+xml;base64,${mark}" style="width:156px;height:156px">
</div>`

const write = (name: string, bytes: Uint8Array): void => {
  const target = resolve(PUBLIC_DIR, name)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, bytes)
  console.log(`wrote ${name} (${bytes.byteLength} bytes)`)
}

/** The mark, read as bytes so the raster cannot disagree with the vector. */
const favicon = (): string => readFileSync(resolve(PUBLIC_DIR, 'favicon.svg')).toString('base64')

write('og.png', await render(CARD, { width: 1200, height: 630, format: 'png', fonts: FONTS }))
write(
  'apple-touch-icon.png',
  await render(TOUCH_ICON(favicon()), { width: 180, height: 180, format: 'png', fonts: FONTS }),
)
