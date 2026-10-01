/**
 * The Desk atoms, driven the way an operator drives them. Every step goes
 * through the real Admin update and the real Admin view, so a scene that passes
 * is a statement about the page and not about the atoms in isolation.
 */

import { Option } from 'effect'
import { Scene } from 'foldkit'
import { fromString as urlFromString } from 'foldkit/url'
import { describe, it } from 'vitest'

import { init, update } from './update'
import { view } from './view'

const ORIGIN = 'https://photo.elianiva.com'

const at = (pathname: string) => {
  const parsed = urlFromString(`${ORIGIN}${pathname}`)
  if (Option.isNone(parsed)) throw new Error(`not a URL: ${pathname}`)
  return parsed.value
}

const app = { update, view }

/** The atoms sheet, cold. Its route fetches nothing, so there is no Command to
 *  resolve before the first assertion. */
const sheet = () => Scene.given(init(at('/admin/atoms')).model)

const segmentOption = (label: string) => Scene.role('button', { name: label })

describe('a Segment group', () => {
  it('opens on the design’s pick and moves it when the operator picks another', () => {
    Scene.scene(
      app,
      sheet(),
      Scene.expect(segmentOption('ALL 412')).toHaveAttr('aria-pressed', 'true'),
      Scene.expect(segmentOption('FAILED 1')).toHaveAttr('aria-pressed', 'false'),
      Scene.click(segmentOption('FAILED 1')),
      Scene.expect(segmentOption('FAILED 1')).toHaveAttr('aria-pressed', 'true'),
      Scene.expect(segmentOption('ALL 412')).toHaveAttr('aria-pressed', 'false'),
    )
  })

  it('keeps its selection to its own group', () => {
    Scene.scene(
      app,
      sheet(),
      Scene.click(segmentOption('WEBP')),
      // The Format group moved; the status filter and the ratio filter did not.
      Scene.expect(segmentOption('WEBP')).toHaveAttr('aria-pressed', 'true'),
      Scene.expect(segmentOption('AVIF')).toHaveAttr('aria-pressed', 'false'),
      Scene.expect(segmentOption('ALL 412')).toHaveAttr('aria-pressed', 'true'),
      Scene.expect(segmentOption('ANY')).toHaveAttr('aria-pressed', 'true'),
    )
  })
})

describe('a Toggle Row', () => {
  it('flips the switch the operator pressed and no other', () => {
    const gps = Scene.role('switch', { name: 'Remove GPS location' })
    const exif = Scene.first(Scene.all.role('switch', { name: 'Keep EXIF data' }))
    Scene.scene(
      app,
      sheet(),
      // The sheet opens with GPS off and EXIF on, as the canvas draws them.
      Scene.expect(gps).not.toHaveAttr('data-checked'),
      Scene.expect(exif).toHaveAttr('data-checked'),
      Scene.click(gps),
      Scene.expect(gps).toHaveAttr('data-checked'),
    )
  })
})
