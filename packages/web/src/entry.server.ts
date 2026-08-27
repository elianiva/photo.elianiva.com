// oxlint-disable typescript/consistent-type-assertions
import { Effect } from 'effect'
import * as Server from 'foldkit/experimental/server'

import { Flags as GalleryFlags } from './gallery/model'
import { init as galleryInit } from './gallery/update'
import { view as galleryView } from './gallery/view'
import { Model as GalleryModel } from './gallery/model'
import { Model as AdminModel, init as adminInit, view as adminView } from './admin/entry'

type FetchFlags = typeof GalleryFlags.Type

const fetchGalleryFlags = async (_requestUrl: string): Promise<FetchFlags> => {
  return { photos: [], nextCursor: null }
}

const galleryConfig = {
  Model: GalleryModel,
  Flags: GalleryFlags,
  init: galleryInit,
  view: galleryView,
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

  const flags = await fetchGalleryFlags(request.url)
  const rendered = await Effect.runPromise(
    Server.renderToString(galleryConfig, {
      flags,
      buildId: import.meta.env.FOLDKIT_BUILD_ID ?? 'dev',
    }),
  )
  return Server.Rendered(rendered)
}
