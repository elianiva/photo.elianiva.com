import { describe, expect, it } from 'vitest'
import { Option } from 'effect'
import { PhotoId } from '@photo/shared'
import { fromString as urlFromString } from 'foldkit/url'

import { urlToAppRoute } from '@/admin/route'

import { themeDocument, themeForRoute, themeForUrl } from './theme'

const ORIGIN = 'https://photo.elianiva.com'

const routeOf = (pathname: string) => {
  const parsed = urlFromString(`${ORIGIN}${pathname}`)
  if (Option.isNone(parsed)) throw new Error(`not a URL: ${pathname}`)
  return urlToAppRoute(parsed.value)
}

describe('the branch a URL is drawn in', () => {
  it('draws the Editor dark, and only for a URL the router resolves to a Photo', () => {
    // The two assertions together are the point: a theme keyed off its own
    // copy of the Editor's path is dark for a URL the Admin does not route,
    // and light for one it does. Deriving the branch from the route table is
    // what makes that impossible.
    expect(routeOf('/admin/photos/photo-1')).toEqual({
      _tag: 'Photo',
      id: PhotoId.make('photo-1'),
    })
    expect(themeForUrl(`${ORIGIN}/admin/photos/photo-1`)).toBe('dark')
  })

  it('draws the Library and the other Library routes light', () => {
    for (const pathname of ['/admin', '/admin/', '/admin/scheduled', '/admin/settings']) {
      expect(routeOf(pathname)._tag).not.toBe('Photo')
      expect(themeForUrl(`${ORIGIN}${pathname}`)).toBe('light')
    }
  })

  it('draws the front page light, because no admin route claims it', () => {
    expect(themeForUrl(`${ORIGIN}/`)).toBe('light')
  })

  it('draws a path under the Editor that names no route light, as the Admin’s NotFound page', () => {
    // `/admin/photos/photo-1/edit` is not a Photo: no route consumes the
    // trailing segment, so the Admin draws its own NotFound inside the light
    // Library's chrome. A theme keyed off a path prefix would get this wrong
    // in the other direction and paint a dark 404.
    expect(routeOf('/admin/photos/photo-1/edit')._tag).toBe('NotFound')
    expect(themeForUrl(`${ORIGIN}/admin/photos/photo-1/edit`)).toBe('light')
  })

  it('agrees with the view, which reads the branch off the route it holds', () => {
    for (const pathname of [
      '/admin',
      '/admin/scheduled',
      '/admin/settings',
      '/admin/photos/photo-1',
      '/admin/photos/abc/edit',
    ]) {
      expect(themeForUrl(`${ORIGIN}${pathname}`)).toBe(themeForRoute(routeOf(pathname)))
    }
  })

  it('falls back to light for something that is not a URL at all', () => {
    expect(themeForUrl('not a url')).toBe('light')
  })
})

describe('naming the branch on a shell', () => {
  const shell = '<!doctype html><html lang="en"><head></head><body></body></html>'

  it('puts the attribute on the document element, so the first paint is themed', () => {
    expect(themeDocument(shell, 'dark')).toBe(
      '<!doctype html><html lang="en" data-theme="dark"><head></head><body></body></html>',
    )
  })

  it('leaves a shell with no document element alone', () => {
    expect(themeDocument('<div id="root"></div>', 'dark')).toBe('<div id="root"></div>')
  })
})
