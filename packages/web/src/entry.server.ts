import { Effect } from 'effect'
import * as Server from 'foldkit/experimental/server'

import { isAdminPath } from './admin/route'
import { editionOf } from './home/content'
import { Model as HomeModel, init as homeInit, view as homeView } from './home/entry'
import { Flags } from './home/model'
import { API_PREFIX } from './lib/api'
import { readFrontOverHttp } from './lib/public-site'
import { themeDocument, themeForUrl } from './lib/theme'

// Vite inlines the template at transform time. Reading it off disk at request
// time is not an option here: the dev runtime is workerd, where `node:fs` is
// a stub that throws, and the failure lands as a Vite error page on every
// Admin URL rather than as an error anyone would read.
import shellTemplate from '../index.html?raw'

/**
 * Dev-server entry (`ssr.serverEntry` in `vite.config.ts`). Production does
 * not come through here: `alchemy.run.ts` builds the `worker` Vite environment
 * with `main: 'src/worker.ts'`, and `worker.ts` imports the front's Model and
 * view directly to do its own rendering. This module is the dev mirror of that
 * choice, and it answers from the same route table the client does.
 *
 * The Admin is answered with the same shell the Worker serves for it, because
 * `@foldkit/vite-plugin` owns every HTML navigation in dev and its
 * `injectIntoTemplate` *replaces* the `#root` container with the rendered
 * application. That is right for the Front, whose client hydrates the markup it
 * finds, and wrong for the Admin, whose client boots into an empty container
 * the way the Worker's shell leaves it. So the shell is read from the same
 * `index.html` the Worker serves, plus the one script Vite's own HTML
 * transform would have injected. Nothing here is bundled: `worker.ts` does not
 * import this module, and neither does the client entry.
 *
 * The shell carries the theme branch on its `<html>`, which is the same string
 * edit `worker.ts` makes on the same template. It is the first paint's only
 * chance to be themed — nothing has run yet — and the Admin view names the
 * same attribute on the app root for every paint after it.
 */

const VITE_DEV_CLIENT = '<script type="module" src="/@vite/client"></script>'

const clientShell = (request: Request): string =>
  themeDocument(
    shellTemplate.replace('</head>', `    ${VITE_DEV_CLIENT}\n  </head>`),
    themeForUrl(request.url),
  )

const homeConfig = {
  Model: HomeModel,
  Flags,
  init: homeInit,
  view: homeView,
}

export const renderPage = async (request: Request): Promise<Server.EntryResult> => {
  const pathname = new URL(request.url).pathname

  // The API Worker's paths belong to the API Worker. In production its route on
  // the site's hostname claims them before this document is ever reached; in
  // development it is on its own port and nothing here serves them. Either way
  // the answer here is a 404 rather than the broadsheet, so a request to the
  // wrong port says it missed instead of quietly returning a page.
  if (pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)) {
    return Server.Responded(new Response('Not found', { status: 404 }))
  }

  if (isAdminPath(pathname)) {
    return Server.Responded(
      new Response(clientShell(request), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )
  }

  // The dev server has no D1 or R2 binding of its own — `alchemy dev` gives
  // those to the API Worker, which is on its own port here — so the Front's
  // read goes over HTTP to that Worker in development and straight to the
  // bindings in production. Both paths decode against the same shared
  // `GetFrontPage` contract, so the two cannot drift.
  const read = await readFrontOverHttp(`http://localhost:13371${API_PREFIX}`)
  const rendered = await Effect.runPromise(
    Server.renderToString(homeConfig, {
      buildId: import.meta.env.FOLDKIT_BUILD_ID ?? 'dev',
      flags: { edition: editionOf(read), nextSectionCursor: read.nextSectionCursor },
    }),
  )
  return Server.Rendered(rendered)
}
