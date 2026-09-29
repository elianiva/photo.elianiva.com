import { describe, expect, it } from 'vitest'
import { Option } from 'effect'
import { PhotoId } from '@photo/shared'
import { Scene } from 'foldkit'
import type { Command } from 'foldkit/command'
import { fromString as urlFromString } from 'foldkit/url'
import { UrlRequest } from 'foldkit/navigation'

import { FetchPhotoCmd } from './commands'
import { Message } from './model'
import { isAdminPath, urlToAppRoute } from './route'
import { init, onUrlChange, onUrlRequest, update } from './update'
import { view } from './view'

const ORIGIN = 'https://photo.elianiva.com'

const at = (pathname: string) => {
  const parsed = urlFromString(`${ORIGIN}${pathname}`)
  if (Option.isNone(parsed)) throw new Error(`not a URL: ${pathname}`)
  return parsed.value
}

const routeOf = (pathname: string) => urlToAppRoute(at(pathname))

const commandNames = (
  commands: ReadonlyArray<{ readonly name: string }> | undefined,
): ReadonlyArray<string> => (commands ?? []).map((command) => command.name)

/** What a transition dispatched, as name plus arguments — the part of a
 *  command an operator can observe. */
const dispatched = (result: { readonly commands?: ReadonlyArray<Command<Message>> }) =>
  (result.commands ?? []).map((command) => ({ name: command.name, args: command.args ?? {} }))

const PHOTO_ID = PhotoId.make('photo-1')

const photo = {
  id: PHOTO_ID,
  slug: 'a-photo',
  title: 'A Photo',
  r2Key: 'originals/a-photo.jpg',
  width: 3000,
  height: 2000,
} as const

describe('the route table', () => {
  it('names every admin route', () => {
    expect(routeOf('/admin')).toEqual({ _tag: 'Library' })
    expect(routeOf('/admin/')).toEqual({ _tag: 'Library' })
    expect(routeOf('/admin/drafts')).toEqual({ _tag: 'Drafts' })
    expect(routeOf('/admin/settings')).toEqual({ _tag: 'Settings' })
    expect(routeOf('/admin/photos/abc')).toEqual({ _tag: 'Photo', id: 'abc' })
  })

  it('declines a photo path whose id is not an id, so no view has to defend itself', () => {
    expect(routeOf('/admin/photos')).toEqual({ _tag: 'NotFound', path: '/admin/photos' })
    expect(routeOf('/admin/photos/abc/edit')).toEqual({
      _tag: 'NotFound',
      path: '/admin/photos/abc/edit',
    })
  })

  it('declines the front page, which shares the origin', () => {
    expect(routeOf('/')).toEqual({ _tag: 'NotFound', path: '/' })
    expect(routeOf('/about')).toEqual({ _tag: 'NotFound', path: '/about' })
  })
})

describe('the admin URL space', () => {
  it('claims every admin route, and the paths that name none', () => {
    for (const path of [
      '/admin',
      '/admin/',
      '/admin/drafts',
      '/admin/settings',
      '/admin/photos/abc',
      '/admin/photos',
      '/admin/photos/abc/edit',
    ]) {
      expect(isAdminPath(path)).toBe(true)
    }
  })

  it('leaves the front page and anything else to its own document', () => {
    for (const path of ['/', '/about', '/administrator', '/admin.php']) {
      expect(isAdminPath(path)).toBe(false)
    }
  })
})

describe('a cold load', () => {
  it('fetches the library on a cold load of the library', () => {
    const cold = init(at('/admin'))
    expect(cold.model.route).toEqual({ _tag: 'Library' })
    expect(commandNames(cold.commands)).toEqual(['FetchPhotos', 'FetchTags'])
  })

  it('fetches the photo on a cold load of a deep link', () => {
    const cold = init(at('/admin/photos/photo-1'))
    expect(cold.model.route).toEqual({ _tag: 'Photo', id: 'photo-1' })
    expect(commandNames(cold.commands)).toEqual(['FetchPhoto'])
  })

  it('fetches nothing on a cold load of a route with no data behind it yet', () => {
    expect(init(at('/admin/drafts')).commands ?? []).toEqual([])
    expect(init(at('/admin/settings')).commands ?? []).toEqual([])
  })

  it('fetches nothing on a cold load of a URL no route names, and lands on NotFound', () => {
    const cold = init(at('/admin/photos/abc/edit'))
    expect(cold.model.route._tag).toBe('NotFound')
    expect(cold.commands ?? []).toEqual([])
  })
})

describe('an in-app navigation', () => {
  const library = init(at('/admin')).model

  it('loads the library when a navigation lands on it', () => {
    const onAPhoto = init(at('/admin/photos/photo-1')).model
    const result = update(onAPhoto, onUrlChange(at('/admin')))
    expect(result.model.route).toEqual({ _tag: 'Library' })
    expect(commandNames(result.commands)).toEqual(['FetchPhotos', 'FetchTags'])
  })

  it('does not re-read the library when the route stays', () => {
    expect(commandNames(update(library, onUrlChange(at('/admin'))).commands)).toEqual([])
  })

  it('re-reads the photo when the id changes within the Photo route', () => {
    const onAPhoto = init(at('/admin/photos/photo-1')).model
    const result = update(onAPhoto, onUrlChange(at('/admin/photos/photo-2')))
    expect(dispatched(result)).toEqual([{ name: 'FetchPhoto', args: { id: 'photo-2' } }])
  })

  it('pushes a URL inside the admin URL space, even one that names no route', () => {
    const settings = update(
      library,
      onUrlRequest(UrlRequest.Internal({ url: at('/admin/settings') })),
    )
    expect(dispatched(settings)).toEqual([
      { name: 'Navigate', args: { url: `${ORIGIN}/admin/settings` } },
    ])
    const unknown = update(library, onUrlRequest(UrlRequest.Internal({ url: at('/admin/nope') })))
    expect(dispatched(unknown)).toEqual([
      { name: 'Navigate', args: { url: `${ORIGIN}/admin/nope` } },
    ])
  })

  it('loads the document for the front page rather than pushing a URL the admin cannot draw', () => {
    const result = update(library, onUrlRequest(UrlRequest.Internal({ url: at('/') })))
    expect(dispatched(result)).toEqual([{ name: 'Load', args: { href: `${ORIGIN}/` } }])
  })

  it('loads the document for an external link', () => {
    const result = update(
      library,
      onUrlRequest(UrlRequest.External({ href: 'https://example.com/' })),
    )
    expect(dispatched(result)).toEqual([{ name: 'Load', args: { href: 'https://example.com/' } }])
  })
})

describe('the Photo route', () => {
  const loading = init(at('/admin/photos/photo-1')).model

  it('shows the fetched photo', () => {
    const ready = update(loading, Message.SucceededFetchPhoto({ id: PHOTO_ID, photo }))
    expect(ready.model.photoStatus).toBe('ready')
    expect(ready.model.photo?.title).toBe('A Photo')
  })

  it('ignores a photo that arrives after the route moved on', () => {
    const elsewhere = update(loading, onUrlChange(at('/admin')))
    const stale = update(
      loading,
      Message.SucceededFetchPhoto({ id: PhotoId.make('photo-2'), photo }),
    )
    expect(elsewhere.model.photoStatus).toBe('loading')
    expect(stale.model.photoStatus).toBe('loading')
  })

  it('offers a retry when the photo cannot be loaded', () => {
    const failed = update(loading, Message.FailedFetchPhoto({ id: PHOTO_ID, message: 'gone' }))
    expect(failed.model.photoStatus).toBe('error')
    expect(commandNames(update(failed.model, Message.RetryFetchPhoto()).commands)).toEqual([
      'FetchPhoto',
    ])
  })
})

// Scene asserts through the view, which is where the operator's side of a
// route is visible: which page a URL draws, and where its links point.
describe('the page a route draws', () => {
  const app = { update, view }

  it('draws the library for a cold load of /admin', () => {
    Scene.scene(
      app,
      Scene.given(init(at('/admin')).model),
      Scene.expect(Scene.role('heading', { name: 'Photos' })).toExist(),
    )
  })

  it('draws NotFound for a malformed photo id, with a way back', () => {
    Scene.scene(
      app,
      Scene.given(init(at('/admin/photos/abc/edit')).model),
      Scene.expect(Scene.role('heading', { name: 'Not found' })).toExist(),
      Scene.expect(Scene.role('link', { name: '← Photos' })).toHaveAttr('href', '/admin'),
    )
  })

  it('navigates in-app to a deep link and draws the Photo it fetches', () => {
    Scene.scene(
      app,
      Scene.given(init(at('/admin')).model),
      // The runtime reports the new URL after a navigation, exactly as it does
      // for a click and for the back button.
      Scene.Subscription.emit(onUrlChange(at('/admin/photos/photo-1'))),
      Scene.Command.resolve(
        FetchPhotoCmd({ id: 'photo-1' }),
        Message.SucceededFetchPhoto({ id: PHOTO_ID, photo }),
      ),
      Scene.expect(Scene.role('heading', { name: 'A Photo' })).toExist(),
      Scene.expect(Scene.role('link', { name: '← Photos' })).toHaveAttr('href', '/admin'),
      // The back link is a plain anchor: the runtime owns the interception, so
      // the view registers no click handler of its own.
      Scene.expect(Scene.role('link', { name: '← Photos' })).not.toHaveHandler('click'),
    )
  })
})
