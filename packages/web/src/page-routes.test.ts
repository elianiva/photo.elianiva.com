import { describe, expect, it } from 'vitest'
import type { WebsiteEnv } from '../../../alchemy.run'
import worker from './worker'

/**
 * The page host's routing.
 *
 * The Worker used to answer by a chain of `if`s over the pathname, with the
 * order of the branches doing the work: a public document first, then the
 * sitemap, then the Admin's whole URL space, then whatever the asset binding had.
 * A router changes how that order is expressed, so these are the contracts the
 * chain used to carry and a refactor would otherwise break silently: which paths
 * are documents, which are the Admin's, what a deep Admin route answers, and
 * that a path nobody names is a 404 with the security headers on it.
 */

/** A D1 binding with nothing in it: every read here is a miss, which is the
 *  state these tests are about — a path that names no document, rather than one
 *  that names a document whose data is missing. */
const emptyDatabase = {
  prepare: (query: string) => {
    const statement = {
      bind: () => statement,
      all: async () => ({ results: [] }),
      first: async () => null,
      run: async () => ({ success: true, meta: { changes: 0 } }),
    }
    void query
    return statement
  },
  batch: async () => [],
  exec: async () => ({ count: 0, duration: 0 }),
  withSession: () => emptyDatabase,
  dump: async () => new ArrayBuffer(0),
}

const SHELL = '<!doctype html><html lang="en"><body><div id="root"></div></body></html>'

/** The asset binding: the SPA shell under `/index.html`, and nothing else.
 *  `typeof fetch` rather than the one argument it is called with, so this is the
 *  binding's own type and not a lookalike of it. */
const assets: { fetch: typeof fetch } = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = input instanceof Request ? input.url : String(input)
    if (new URL(url).pathname === '/index.html') {
      void init
      return Promise.resolve(new Response(SHELL, { headers: { 'content-type': 'text/html' } }))
    }
    return Promise.resolve(new Response('Not found', { status: 404 }))
  },
}

const env = (): WebsiteEnv & { ASSETS: { fetch: typeof fetch } } => ({
  STAGE: 'dev',
  ACCESS_TEAM_DOMAIN: '',
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a hand-written D1 is the point: these tests are about routing, and a binding that answers "no rows" is the whole of what routing needs
  DB: emptyDatabase as unknown as WebsiteEnv['DB'],
  PHOTOS: {
    get: async () => null,
    head: async () => null,
    list: async () => ({ objects: [], truncated: false }),
    put: async () => undefined,
    delete: async () => undefined,
  },
  ASSETS: assets,
})

const at = (path: string, init?: RequestInit): Promise<Response> =>
  worker.fetch(new Request(`https://photo.elianiva.com${path}`, init), env(), undefined)

describe('the page host routes', () => {
  it('redirects the client template to its canonical URL', async () => {
    const response = await at('/index.html')
    expect(response.status).toBe(308)
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/')
  })

  it('serves the Admin shell for a deep Admin route', async () => {
    // The shell for every path in the Admin's space, so a deep route boots the
    // app and the client decides whether the route names anything. The asset
    // binding only has `/index.html`, so a 404 here would mean the route did not
    // reach the binding.
    for (const path of ['/admin', '/admin/photos', '/admin/photos/photo_1/edit']) {
      const response = await at(path)
      expect([path, response.status]).toEqual([path, 200])
      expect([path, response.headers.get('content-type')]).toEqual([
        path,
        'text/html; charset=utf-8',
      ])
    }
  })

  it('answers a path nobody names with a 404 carrying the security headers', async () => {
    for (const path of ['/nope', '/nope/deeper', '/api-ish']) {
      const response = await at(path)
      expect([path, response.status]).toEqual([path, 404])
      expect([path, response.headers.get('x-frame-options')]).toEqual([path, 'DENY'])
      expect([path, response.headers.get('x-content-type-options')]).toEqual([path, 'nosniff'])
    }
  })

  it('puts the security headers on the redirect too', async () => {
    const response = await at('/index.html')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
  })

  it('treats a trailing slash on a public document as the same document', async () => {
    // The route table says `/about/` and `/about` are one path, and the root is
    // the one path a slash may not be stripped from. Both are the same *route*,
    // so both reach SSR rather than the 404.
    for (const path of ['/about', '/about/']) {
      const response = await at(path)
      expect([path, response.status]).not.toEqual([path, 404])
    }
  })

  it('does not let a Tag slug span more than one segment', async () => {
    // `/tag/:slug` is a path parameter, so a slug with a slash cannot reach the
    // handler at all — a stronger answer than matching and refusing.
    const response = await at('/tag/one/two')
    expect(response.status).toBe(404)
  })
})
