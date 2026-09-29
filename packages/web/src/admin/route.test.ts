import { describe, expect, it } from 'vitest'
import { Option } from 'effect'
import { PhotoId } from '@photo/shared'
import { Scene } from 'foldkit'
import type { Command } from 'foldkit/command'
import { fromString as urlFromString } from 'foldkit/url'
import { UrlRequest } from 'foldkit/navigation'

import {
  FetchCountsCmd,
  FetchPhotoCmd,
  FetchPhotosCmd,
  FetchPresentationCmd,
  FetchSessionCmd,
  FetchStorageCmd,
  FetchTagsCmd,
} from './commands'
import { Message } from './model'
import { isAdminPath, appRouteToUrl, urlToAppRoute } from './route'
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

/** The Presentation the Editor's snapshot read answers with — the migration
 *  0004 defaults, which is what an unedited Photo stores. */
const PRESENTATION = {
  cropX: 0,
  cropY: 0,
  cropScale: 1,
  level: null,
  borderEnabled: true,
  borderStyle: 'gallery',
  borderColour: 'white',
  borderWidth: 4,
  previewLongEdge: 1200,
  previewFormat: 'avif',
  previewQuality: 82,
  fullQuality: 92,
  keepExif: true,
  removeGps: true,
} as const

describe('the route table', () => {
  it('names every admin route', () => {
    expect(routeOf('/admin')).toEqual({ _tag: 'Library' })
    expect(routeOf('/admin/')).toEqual({ _tag: 'Library' })
    expect(routeOf('/admin/drafts')).toEqual({ _tag: 'Drafts' })
    expect(routeOf('/admin/scheduled')).toEqual({ _tag: 'Scheduled' })
    expect(routeOf('/admin/uploads')).toEqual({ _tag: 'Uploads' })
    expect(routeOf('/admin/trash')).toEqual({ _tag: 'Trash' })
    expect(routeOf('/admin/settings')).toEqual({ _tag: 'Settings' })
    expect(routeOf('/admin/photos/abc')).toEqual({ _tag: 'Photo', id: 'abc' })
  })

  it('prints every route back into the URL it parsed from', () => {
    for (const path of [
      '/admin',
      '/admin/atoms',
      '/admin/drafts',
      '/admin/scheduled',
      '/admin/uploads',
      '/admin/trash',
      '/admin/settings',
      '/admin/photos/photo-1',
    ]) {
      expect(appRouteToUrl(routeOf(path))).toBe(path)
    }
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

/** The three reads the shell itself needs, on every route and every
 *  navigation. Nothing is cached across a route change: a session can expire
 *  between two pages, and a count is a fact about the moment it was read. */
const SHELL_READS = ['FetchSession', 'FetchCounts', 'FetchStorage']

const listReads = (result: { readonly commands?: ReadonlyArray<Command<Message>> }) =>
  dispatched(result).filter((entry) => !SHELL_READS.includes(entry.name))

describe('a cold load', () => {
  it('fetches the shell and the library on a cold load of the library', () => {
    const cold = init(at('/admin'))
    expect(cold.model.route).toEqual({ _tag: 'Library' })
    expect(commandNames(cold.commands)).toEqual([...SHELL_READS, 'FetchPhotos', 'FetchTags'])
  })

  it('fetches the shell, the photo and its presentation on a cold load of a deep link', () => {
    const cold = init(at('/admin/photos/photo-1'))
    expect(cold.model.route).toEqual({ _tag: 'Photo', id: 'photo-1' })
    // The Editor draws the Mat out of the stored Presentation, so the Photo
    // alone is not enough to draw the route.
    expect(commandNames(cold.commands)).toEqual([...SHELL_READS, 'FetchPhoto', 'FetchPresentation'])
  })

  it('fetches the shell but no list on a cold load of a route with no data behind it yet', () => {
    expect(commandNames(init(at('/admin/drafts')).commands)).toEqual(SHELL_READS)
    expect(commandNames(init(at('/admin/settings')).commands)).toEqual(SHELL_READS)
  })

  it('fetches the shell but no list on a URL no route names, and lands on NotFound', () => {
    const cold = init(at('/admin/photos/abc/edit'))
    expect(cold.model.route._tag).toBe('NotFound')
    expect(commandNames(cold.commands)).toEqual(SHELL_READS)
  })
})

describe('an in-app navigation', () => {
  const library = init(at('/admin')).model

  it('loads the library when a navigation lands on it', () => {
    const onAPhoto = init(at('/admin/photos/photo-1')).model
    const result = update(onAPhoto, onUrlChange(at('/admin')))
    expect(result.model.route).toEqual({ _tag: 'Library' })
    expect(commandNames(result.commands)).toEqual([...SHELL_READS, 'FetchPhotos', 'FetchTags'])
  })

  it('re-reads the shell but not the list when the route stays', () => {
    expect(commandNames(update(library, onUrlChange(at('/admin'))).commands)).toEqual(SHELL_READS)
  })

  it('re-reads the photo and its presentation when the id changes within the Photo route', () => {
    const onAPhoto = init(at('/admin/photos/photo-1')).model
    const result = update(onAPhoto, onUrlChange(at('/admin/photos/photo-2')))
    expect(listReads(result)).toEqual([
      { name: 'FetchPhoto', args: { id: 'photo-2' } },
      { name: 'FetchPresentation', args: { id: 'photo-2' } },
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
    // Both reads, because either one failing leaves the Editor with nothing to
    // draw: the Photo is the record, the Presentation is the Mat.
    expect(commandNames(update(failed.model, Message.RetryFetchPhoto()).commands)).toEqual([
      'FetchPhoto',
      'FetchPresentation',
    ])
  })
})

// Scene asserts through the view, which is where the operator's side of a
// route is visible: which page a URL draws, and where its links point.
/** A proven session with no claim, which is the `dev` stage's Access
 *  stand-down: the shell draws, and the sidebar has no address and no
 *  sign-out to print. */
const STANDDOWN = Message.SucceededGetSession({ email: null, teamDomain: null })

describe('the page a route draws', () => {
  const app = { update, view }

  it('draws the library for a cold load of /admin', () => {
    Scene.scene(
      app,
      Scene.given(init(at('/admin')).model),
      // The Page Head names the route, and the shell reads are still pending.
      Scene.Command.resolveAll(
        [FetchSessionCmd, STANDDOWN],
        [FetchCountsCmd, Message.FailedGetCounts({})],
        [FetchStorageCmd, Message.FailedGetStorage({})],
        [FetchPhotosCmd, Message.SucceededFetchPhotos({ photos: [], nextCursor: null })],
        [FetchTagsCmd, Message.SucceededFetchTags({ tags: [] })],
      ),
      Scene.expect(Scene.role('heading', { name: 'Library' })).toExist(),
    )
  })

  it('draws NotFound for a malformed photo id, with a way back', () => {
    Scene.scene(
      app,
      Scene.given(init(at('/admin/photos/abc/edit')).model),
      Scene.Command.resolveAll(
        [FetchSessionCmd, STANDDOWN],
        [FetchCountsCmd, Message.FailedGetCounts({})],
        [FetchStorageCmd, Message.FailedGetStorage({})],
      ),
      Scene.expect(Scene.role('heading', { name: 'Not found' })).toExist(),
      Scene.expect(Scene.role('link', { name: '← Library' })).toHaveAttr('href', '/admin'),
    )
  })

  it('navigates in-app to a deep link and draws the Editor it fetches', () => {
    Scene.scene(
      app,
      Scene.given(init(at('/admin')).model),
      Scene.Command.resolveAll(
        [FetchSessionCmd, STANDDOWN],
        [FetchCountsCmd, Message.FailedGetCounts({})],
        [FetchStorageCmd, Message.FailedGetStorage({})],
        [FetchPhotosCmd, Message.SucceededFetchPhotos({ photos: [], nextCursor: null })],
        [FetchTagsCmd, Message.SucceededFetchTags({ tags: [] })],
      ),
      // The runtime reports the new URL after a navigation, exactly as it does
      // for a click and for the back button.
      Scene.Subscription.emit(onUrlChange(at('/admin/photos/photo-1'))),
      Scene.Command.resolveAll(
        [FetchSessionCmd, STANDDOWN],
        [FetchCountsCmd, Message.FailedGetCounts({})],
        [FetchStorageCmd, Message.FailedGetStorage({})],
        [FetchPhotoCmd, Message.SucceededFetchPhoto({ id: PHOTO_ID, photo })],
        [
          FetchPresentationCmd,
          Message.SucceededFetchPresentation({ id: PHOTO_ID, presentation: PRESENTATION }),
        ],
      ),
      // The Editor is a document of its own: the Photo's title is its heading
      // and the Mat is on the Stage, with no sidebar and no Page Head anywhere.
      Scene.expect(Scene.role('heading', { name: 'A Photo' })).toExist(),
      Scene.expect(Scene.selector('[data-slot="mat"]')).toExist(),
      Scene.expect(Scene.role('navigation', { name: 'Admin sections' })).not.toExist(),
      Scene.expect(Scene.role('link', { name: 'Library' })).toHaveAttr('href', '/admin'),
      // The back link is a plain anchor: the runtime owns the interception, so
      // the view registers no click handler of its own.
      Scene.expect(Scene.role('link', { name: 'Library' })).not.toHaveHandler('click'),
    )
  })
})
