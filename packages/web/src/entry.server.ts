import { Effect } from 'effect'
import * as Server from 'foldkit/experimental/server'

import { Model as AdminModel, init as adminInit, view as adminView } from './admin/entry'
import { Model as HomeModel, init as homeInit, view as homeView } from './home/entry'

const homeConfig = {
  Model: HomeModel,
  init: homeInit,
  view: homeView,
}

export const renderPage = async (request: Request): Promise<Server.EntryResult> => {
  const url = new URL(request.url)
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
    const config = {
      Model: AdminModel,
      init: adminInit,
      view: adminView,
    }
    const rendered = await Effect.runPromise(
      Server.renderToString(config, {
        buildId: import.meta.env.FOLDKIT_BUILD_ID ?? 'dev',
      }),
    )
    return Server.Rendered(rendered)
  }

  const rendered = await Effect.runPromise(
    Server.renderToString(homeConfig, {
      buildId: import.meta.env.FOLDKIT_BUILD_ID ?? 'dev',
    }),
  )
  return Server.Rendered(rendered)
}
