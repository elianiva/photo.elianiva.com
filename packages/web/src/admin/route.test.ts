/**
 * The Admin's URL space: the route table in both directions, and what each
 * route reads when it is cold-loaded or navigated to.
 *
 * Which page a URL *draws* is a page, and a page is verified in the browser
 * (`.agents/skills/verify-photo`); what is asserted here is the table both the
 * links and the reads are read off, and the reads themselves.
 */

import { describe, expect, it } from 'vitest'
import { Option } from 'effect'
import { PhotoId } from '@photo/shared'
import type { Command } from 'foldkit/command'
import { fromString as urlFromString } from 'foldkit/url'
import { UrlRequest } from 'foldkit/navigation'

import { Message } from './model'
import {
  defaultLibraryFilters,
  isAdminPath,
  appRouteToUrl,
  libraryRoute,
  urlToAppRoute,
} from './route'
import { init, onUrlChange, onUrlRequest, update } from './update'

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
    expect(routeOf('/admin')).toEqual(libraryRoute())
    expect(routeOf('/admin/')).toEqual(libraryRoute())
    expect(routeOf('/admin/scheduled')).toEqual({ _tag: 'Scheduled' })
    expect(routeOf('/admin/settings')).toEqual({ _tag: 'Settings' })
    expect(routeOf('/admin/photos/abc')).toEqual({ _tag: 'Photo', id: 'abc' })
  })

  it('prints every route back into the URL it parsed from', () => {
    for (const path of [
      '/admin',
      '/admin/atoms',
      '/admin/scheduled',
      '/admin/settings',
      '/admin/photos/photo-1',
    ]) {
      expect(appRouteToUrl(routeOf(path))).toBe(path)
    }
  })

  it('reads the Library view from the query string and prints it back', () => {
    // The view is route state, so the URL is where it lives and the one route
    // table both parses it and prints it. Absence is the table (the default),
    // so a bare `/admin` is the same page the sidebar links to.
    expect(routeOf('/admin?view=grid')).toEqual(
      libraryRoute({ ...defaultLibraryFilters, view: 'grid' }),
    )
    expect(appRouteToUrl(routeOf('/admin?view=grid'))).toBe('/admin?view=grid')
    expect(appRouteToUrl(routeOf('/admin'))).toBe('/admin')
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

  it('names no route for the retired Uploads, Trash and Drafts pages', () => {
    // All three paths are inside the Admin's URL space, so they still boot the
    // Admin and draw its NotFound — but no route, no sidebar row and no Page
    // Head title answers to any of them. A draft is a Status on the Filter Bar
    // rather than a page of its own, so `Drafts` is a retired route.
    expect(routeOf('/admin/uploads')).toEqual({ _tag: 'NotFound', path: '/admin/uploads' })
    expect(routeOf('/admin/trash')).toEqual({ _tag: 'NotFound', path: '/admin/trash' })
    expect(routeOf('/admin/drafts')).toEqual({ _tag: 'NotFound', path: '/admin/drafts' })
  })
})

describe('the admin URL space', () => {
  it('claims every admin route, and the paths that name none', () => {
    for (const path of [
      '/admin',
      '/admin/',
      '/admin/scheduled',
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

/** The three reads the shell itself needs, on every route and every navigation.
 *  Nothing is cached across a route change: a session can expire between two
 *  pages, and a count or a Tag list is a fact about the moment it was read. The
 *  Tags are here rather than on the Library alone because every route can offer
 *  a Tag — the Bulk Bar's `Add tag` and the upload dialog's combo both read the
 *  list, and a route that listed none would offer `No tags yet.` over a Library
 *  that has four. */
const SHELL_READS = ['FetchSession', 'FetchCounts', 'FetchTags']

const listReads = (result: { readonly commands?: ReadonlyArray<Command<Message>> }) =>
  dispatched(result).filter((entry) => !SHELL_READS.includes(entry.name))

describe('a cold load', () => {
  it('fetches the shell and the library on a cold load of the library', () => {
    const cold = init(at('/admin'))
    expect(cold.model.route).toEqual(libraryRoute())
    expect(commandNames(cold.commands)).toEqual([...SHELL_READS, 'FetchPhotos'])
  })

  it('applies the Library view from the URL on a cold load of that URL', () => {
    const cold = init(at('/admin?view=grid'))
    expect(cold.model.route).toEqual(libraryRoute({ ...defaultLibraryFilters, view: 'grid' }))
    // The cold load reads the list whatever the view: the grid and the table
    // are two arrangements of one read.
    expect(commandNames(cold.commands)).toEqual([...SHELL_READS, 'FetchPhotos'])
  })

  it('fetches the shell, the photo and its presentation on a cold load of a deep link', () => {
    const cold = init(at('/admin/photos/photo-1'))
    expect(cold.model.route).toEqual({ _tag: 'Photo', id: 'photo-1' })
    // The Editor draws the Mat out of the stored Presentation, so the Photo
    // alone is not enough to draw the route.
    expect(commandNames(cold.commands)).toEqual([...SHELL_READS, 'FetchPhoto', 'FetchPresentation'])
  })

  it('fetches the shell but no list on a cold load of a route with no data behind it yet', () => {
    expect(commandNames(init(at('/admin/scheduled')).commands)).toEqual(SHELL_READS)
    expect(commandNames(init(at('/admin/photos/abc/edit')).commands)).toEqual(SHELL_READS)
  })

  it('fetches the shell and the singleton on a cold load of the Settings page', () => {
    // Settings is the one route that is neither the Library's list nor a Photo:
    // it is a form over a row, and a form over a row needs that row.
    expect(commandNames(init(at('/admin/settings')).commands)).toEqual([
      ...SHELL_READS,
      'FetchSettings',
    ])
  })
})

describe('an in-app navigation', () => {
  const library = init(at('/admin')).model

  it('loads the library when a navigation lands on it', () => {
    const onAPhoto = init(at('/admin/photos/photo-1')).model
    const result = update(onAPhoto, onUrlChange(at('/admin')))
    expect(result.model.route).toEqual(libraryRoute())
    expect(commandNames(result.commands)).toEqual([...SHELL_READS, 'FetchPhotos'])
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

describe('an unproven session', () => {
  // The session-expired screen's `Sign in again` is a plain same-origin
  // anchor, and the runtime's link listener has already called
  // `preventDefault` by the time `ClickedLink` arrives — so what this
  // dispatches is the only thing that can issue the document request Access
  // turns into a login. A `Navigate` here pushes the URL the page is already
  // on and the affordance does nothing at all.
  const refused = (pathname: string) =>
    update(init(at(pathname)).model, Message.FailedGetSession({})).model

  it('loads the document rather than navigating in-app, so Access can answer', () => {
    for (const pathname of ['/admin', '/admin/photos/abc', '/admin/scheduled', '/admin/nope']) {
      const result = update(
        refused(pathname),
        onUrlRequest(UrlRequest.Internal({ url: at(pathname) })),
      )
      expect([pathname, dispatched(result)]).toEqual([
        pathname,
        [{ name: 'Load', args: { href: `${ORIGIN}${pathname}` } }],
      ])
    }
  })

  it('leaves a verified session navigating in-app as before', () => {
    // The rule is scoped to an unproven session, so this is the guard against
    // it swallowing ordinary navigation.
    const verified = update(
      init(at('/admin')).model,
      Message.SucceededGetSession({ email: 'owner@photo.test', teamDomain: null }),
    ).model
    const result = update(
      verified,
      onUrlRequest(UrlRequest.Internal({ url: at('/admin/settings') })),
    )
    expect(dispatched(result)).toEqual([
      { name: 'Navigate', args: { url: `${ORIGIN}/admin/settings` } },
    ])
  })

  it('raises no leave guard, because an expired session has drawn no Editor', () => {
    // The guard's Dialog is drawn by the shell, and the expired screen replaces
    // the shell — raising it here would open a dialog nothing draws, and the
    // click would silently do nothing, which is the bug in another costume.
    const result = update(
      refused('/admin/photos/photo-1'),
      onUrlRequest(UrlRequest.Internal({ url: at('/admin') })),
    )
    expect(dispatched(result)).toEqual([{ name: 'Load', args: { href: `${ORIGIN}/admin` } }])
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
