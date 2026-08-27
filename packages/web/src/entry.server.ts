// oxlint-disable typescript/consistent-type-assertions
import { Effect } from 'effect'
import * as Server from 'foldkit/experimental/server'

import { Flags as GalleryFlags } from './gallery/model'
import { init as galleryInit } from './gallery/update'
import { view as galleryView } from './gallery/view'
import { Model as GalleryModel } from './gallery/model'
import { Model as AdminModel, init as adminInit, view as adminView } from './admin/entry'

type FetchFlags = typeof GalleryFlags.Type

const fetchGalleryFlags = async (requestUrl: string): Promise<FetchFlags> => {
  const apiUrl =
    requestUrl.includes('photo.localhost') || requestUrl.includes('127.0.0.1')
      ? 'http://127.0.0.1:13370/api/rpc'
      : new URL('/api/rpc', requestUrl).toString()
  const envelope = {
    _tag: 'Request',
    id: 0,
    tag: 'ListPhotos',
    payload: { limit: 60 },
    traceId: '00000000000000000000000000000000',
    spanId: '0000000000000000',
    sampled: true,
    headers: [],
  }
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    })
    if (!response.ok) return { photos: [], nextCursor: null }
    const text = await response.text()
    const parsed: unknown = JSON.parse(text)
    const arr = Array.isArray(parsed) ? parsed[0] : parsed
    if (typeof arr !== 'object' || arr === null) return { photos: [], nextCursor: null }
    if (!isRecord(arr)) return { photos: [], nextCursor: null }
    const exit = arr['exit']
    if (!isRecord(exit)) return { photos: [], nextCursor: null }
    const value = exit['value']
    if (!isRecord(value)) return { photos: [], nextCursor: null }
    const items = value['items']
    const nextCursor = value['nextCursor'] ?? null
    if (!Array.isArray(items)) return { photos: [], nextCursor: null }
    const typedNext = typeof nextCursor === 'string' || nextCursor === null ? nextCursor : null
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- items are PhotoWithTags from trusted RPC decode, asserted to Flags photos view
    return {
      photos: items as unknown as FetchFlags['photos'],
      nextCursor: typedNext,
    }
  } catch {
    return { photos: [], nextCursor: null }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const galleryConfig = {
  Model: GalleryModel,
  Flags: GalleryFlags,
  init: galleryInit,
  view: galleryView,
}

export const renderPage = async (request: Request): Promise<Server.EntryResult> => {
  const url = new URL(request.url)
  if (url.pathname.startsWith('/api/')) {
    return Server.Responded(new Response(null, { status: 404 }))
  }
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
