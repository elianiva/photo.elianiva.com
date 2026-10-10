/**
 * The public route table — the URL vocabulary, in both directions.
 *
 * `/tag/<slug>` is the one path the table assembles rather than holding, so it
 * is the one whose matching has to be pinned: a Tag's label is free-form, so a
 * slug reaches the read with characters that have to survive a URL segment, and
 * a deeper path is not a Tag page even though it starts like one.
 */

import { describe, expect, it } from 'vitest'

import { routeHref, routeNamedBy, routePath, tagPath } from './route'

describe('routeNamedBy', () => {
  it('names the home page and the About page, trailing slash and all', () => {
    expect(routeNamedBy('/')).toEqual({ route: 'home' })
    expect(routeNamedBy('/about')).toEqual({ route: 'about' })
    expect(routeNamedBy('/about/')).toEqual({ route: 'about' })
  })

  it('names a Tag page from its slug', () => {
    expect(routeNamedBy('/tag/night')).toEqual({ route: 'tag', tagSlug: 'night' })
  })

  it('decodes a slug that carries a character a path segment must escape', () => {
    expect(routeNamedBy('/tag/B%26W')).toEqual({ route: 'tag', tagSlug: 'B&W' })
  })

  it('names no document for a deeper path or a malformed escape', () => {
    // A Tag page is one Tag's photographs, so `/tag/night/lift` is not a Tag
    // page: matching it as one would answer a directory of photos that does
    // not exist.
    expect(routeNamedBy('/tag/night/lift')).toBeNull()
    expect(routeNamedBy('/tag')).toBeNull()
    expect(routeNamedBy('/tag/')).toBeNull()
    expect(routeNamedBy('/tag/%')).toBeNull()
  })

  it('names no document for a path the table does not carry', () => {
    expect(routeNamedBy('/archive')).toBeNull()
    expect(routeNamedBy('/street')).toBeNull()
  })
})

describe('the paths a location prints', () => {
  it('agrees between the Worker’s path and the Nav’s href', () => {
    // The home page's two are deliberately different — `/#` so that clicking the
    // section the reader is on returns them to the top of it — and everything
    // else is one path.
    expect(routePath({ route: 'about' })).toBe(routeHref({ route: 'about' }))
    expect(routePath({ route: 'tag', tagSlug: 'night' })).toBe(tagPath('night'))
    expect(routeHref({ route: 'tag', tagSlug: 'night' })).toBe('/tag/night')
  })
})
