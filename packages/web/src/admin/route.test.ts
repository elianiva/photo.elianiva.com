import { describe, expect, it } from 'vitest'
import { Option } from 'effect'
import { PhotoId } from '@photo/shared'
import { Scene } from 'foldkit'
import type { Command } from 'foldkit/command'
import { fromString as urlFromString } from 'foldkit/url'
import { UrlRequest } from 'foldkit/navigation'

import { FetchCountsCmd, FetchPhotoCmd, FetchSessionCmd, FetchStorageCmd } from './commands'
import { Message } from './model'
import type { Counts } from './model'
import { isAdminPath, appRouteToUrl, urlToAppRoute } from './route'
import { init, onUrlChange, onUrlRequest, update } from './update'
import { view } from './view'

const ORIGIN = 'https://photo.elianiva.com'

/** A counts payload with every number spelled out, so an assertion about one
 *  row says which read it came from. */
const COUNTS: Counts = {
  total: 412,
  trashed: 3,
  byStatus: { draft: 7, published: 402, failed: 1 },
  byTag: [],
}

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
    expect(routeOf('/admin/atoms')).toEqual({ _tag: 'Atoms' })
    expect(routeOf('/admin/drafts')).toEqual({ _tag: 'Drafts' })
    expect(routeOf('/admin/scheduled')).toEqual({ _tag: 'Scheduled' })
    expect(routeOf('/admin/uploads')).toEqual({ _tag: 'Uploads' })
    expect(routeOf('/admin/trash')).toEqual({ _tag: 'Trash' })
    expect(routeOf('/admin/settings')).toEqual({ _tag: 'Settings' })
    expect(routeOf('/admin/photos/abc')).toEqual({ _tag: 'Photo', id: 'abc' })
  })

  it('prints every sidebar destination back to the URL it came from', () => {
    // The sidebar's links are built from this, so a route whose printed URL
    // does not parse back to it would be a link that cold-loads the wrong page.
    for (const path of [
      '/admin',
      '/admin/atoms',
      '/admin/drafts',
      '/admin/scheduled',
      '/admin/uploads',
      '/admin/trash',
      '/admin/settings',
    ]) {
      expect(appRouteToUrl(routeOf(path))).toBe(path)
    }
    expect(appRouteToUrl(routeOf('/admin/photos/abc'))).toBe('/admin/photos/abc')
    expect(appRouteToUrl(routeOf('/admin/nope'))).toBe('/admin/nope')
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
      '/admin/atoms',
      '/admin/drafts',
      '/admin/scheduled',
      '/admin/uploads',
      '/admin/trash',
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
  // Every route change re-reads the session, the counts and the storage
  // aggregate, so the shell is answered on the first paint rather than after
  // the page's own fetch lands.
  const SHELL = ['FetchSession', 'FetchCounts', 'FetchStorage']

  it('fetches the library and the shell on a cold load of the library', () => {
    const cold = init(at('/admin'))
    expect(cold.model.route).toEqual({ _tag: 'Library' })
    expect(commandNames(cold.commands)).toEqual([...SHELL, 'FetchPhotos', 'FetchTags'])
  })

  it('fetches the photo and the shell on a cold load of a deep link', () => {
    const cold = init(at('/admin/photos/photo-1'))
    expect(cold.model.route).toEqual({ _tag: 'Photo', id: 'photo-1' })
    expect(commandNames(cold.commands)).toEqual([...SHELL, 'FetchPhoto'])
  })

  it('fetches only the shell on a cold load of a route with no data behind it yet', () => {
    for (const path of [
      '/admin/drafts',
      '/admin/scheduled',
      '/admin/uploads',
      '/admin/trash',
      '/admin/settings',
    ]) {
      expect(commandNames(init(at(path)).commands)).toEqual(SHELL)
    }
  })

  it('fetches only the shell on a cold load of a URL no route names, and lands on NotFound', () => {
    const cold = init(at('/admin/photos/abc/edit'))
    expect(cold.model.route._tag).toBe('NotFound')
    expect(commandNames(cold.commands)).toEqual(SHELL)
  })
})

describe('an in-app navigation', () => {
  const library = init(at('/admin')).model
  const SHELL = ['FetchSession', 'FetchCounts', 'FetchStorage']

  it('loads the library when a navigation lands on it', () => {
    const onAPhoto = init(at('/admin/photos/photo-1')).model
    const result = update(onAPhoto, onUrlChange(at('/admin')))
    expect(result.model.route).toEqual({ _tag: 'Library' })
    expect(commandNames(result.commands)).toEqual([...SHELL, 'FetchPhotos', 'FetchTags'])
  })

  it('re-reads the shell but not the library when the route stays', () => {
    // A count is a fact about the moment it was read, so a route change
    // re-reads it; the loaded list is not re-read for nothing.
    expect(commandNames(update(library, onUrlChange(at('/admin'))).commands)).toEqual(SHELL)
  })

  it('re-reads the photo when the id changes within the Photo route', () => {
    const onAPhoto = init(at('/admin/photos/photo-1')).model
    const result = update(onAPhoto, onUrlChange(at('/admin/photos/photo-2')))
    expect(dispatched(result)).toEqual([
      { name: 'FetchSession', args: {} },
      { name: 'FetchCounts', args: {} },
      { name: 'FetchStorage', args: {} },
      { name: 'FetchPhoto', args: { id: 'photo-2' } },
    ])
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
      Scene.expect(Scene.role('heading', { name: 'Library' })).toExist(),
    )
  })

  it('draws NotFound for a malformed photo id, with a way back', () => {
    Scene.scene(
      app,
      Scene.given(init(at('/admin/photos/abc/edit')).model),
      Scene.expect(Scene.role('heading', { name: 'Not found' })).toExist(),
      Scene.expect(Scene.role('link', { name: '← Library' })).toHaveAttr('href', '/admin'),
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
        FetchSessionCmd,
        Message.SucceededGetSession({ email: 'owner@photo.test', teamDomain: 'https://team.test' }),
      ),
      Scene.Command.resolve(FetchCountsCmd, Message.SucceededGetCounts(COUNTS)),
      Scene.Command.resolve(
        FetchStorageCmd,
        Message.SucceededGetStorage({ bytes: 2048, capBytes: 50_000_000_000 }),
      ),
      Scene.Command.resolve(
        FetchPhotoCmd({ id: 'photo-1' }),
        Message.SucceededFetchPhoto({ id: PHOTO_ID, photo }),
      ),
      // The Page Head names the Photo, so the route's title reaches the headline.
      Scene.expect(Scene.role('heading', { name: 'A Photo' })).toExist(),
      Scene.expect(Scene.role('link', { name: '← Library' })).toHaveAttr('href', '/admin'),
      // The back link is a plain anchor: the runtime owns the interception, so
      // the view registers no click handler of its own.
      Scene.expect(Scene.role('link', { name: '← Library' })).not.toHaveHandler('click'),
    )
  })
})
