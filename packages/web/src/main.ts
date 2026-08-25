import { Effect, Schema as S } from 'effect'
import { Command, Runtime } from 'foldkit'
import type { Document, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { PhotoWithTags } from '@photo/shared'

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const Model = S.Struct({
  photos: S.Array(PhotoWithTags),
  status: S.String,
  error: S.optional(S.String),
})
export type Model = typeof Model.Type

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export const Message = defineMessageUnion({
  FetchPhotos: {},
  SucceededFetchPhotos: {
    photos: S.Array(PhotoWithTags),
  },
  FailedFetchPhotos: {
    message: S.String,
  },
})
export type Message = typeof Message.Type

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export const update = (model: Model, message: Message) =>
  Message.match<readonly [Model, ReadonlyArray<Command.Command<Message>>]>(message, {
    FetchPhotos: () => [{ ...model, status: 'loading' }, [FetchPhotosCmd()]],
    SucceededFetchPhotos: ({ photos }) => [{ ...model, status: 'ready', photos, error: undefined }, []],
    FailedFetchPhotos: ({ message }) => [{ ...model, status: 'error', error: message }, []],
  })

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export const init: Runtime.ApplicationInit<Model, Message> = () => [{ status: 'loading', photos: [], error: undefined }, [FetchPhotosCmd()]]

// ---------------------------------------------------------------------------
// Command — fetch photos via Effect, idiomatic with Http + Schema
// ---------------------------------------------------------------------------

const fetchPhotosEffect = Effect.gen(function* () {
  const res = yield* Effect.tryPromise({
    try: () => fetch('/api/photos'),
    catch: (cause) => new Error(`fetch failed: ${String(cause)}`),
  })
  if (!res.ok) {
    const text = yield* Effect.promise(() => res.text())
    return yield* Effect.fail(Message.FailedFetchPhotos({ message: `GET /api/photos ${res.status}: ${text}` }))
  }
  const json: unknown = yield* Effect.promise(() => res.json() as Promise<unknown>)
  const photos = yield* S.decodeUnknownEffect(S.Array(PhotoWithTags))(json).pipe(
    Effect.mapError((cause) => Message.FailedFetchPhotos({ message: `decode failed: ${String(cause)}` })),
  )
  return Message.SucceededFetchPhotos({ photos })
}).pipe(
  Effect.catchTag('FailedFetchPhotos', (error) => Effect.succeed(error)),
  Effect.catch(() => Effect.succeed(Message.FailedFetchPhotos({ message: 'Failed to fetch photos' }))),
)

const FetchPhotosCmd = Command.define('FetchPhotos', {
  messages: [Message.SucceededFetchPhotos, Message.FailedFetchPhotos],
  execute: fetchPhotosEffect,
})

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'photo.elianiva.com — Photography',
  body: h.div([h.Class('min-h-screen bg-stone-50 text-stone-900')], [
    h.header(
      [h.Class('sticky top-0 z-10 border-b border-stone-200 bg-white/80 backdrop-blur px-6 py-3 flex items-center justify-between')],
      [
        h.div([h.Class('text-sm font-semibold tracking-tight')], ['photo.elianiva.com']),
        h.a([h.Class('text-xs text-stone-500 hover:text-stone-800 underline'), h.Href('/admin')], ['Admin →']),
      ],
    ),
    h.main(
      [h.Class('mx-auto max-w-5xl px-6 py-8')],
      [
        h.h1([h.Class('text-3xl font-semibold tracking-tight')], ['Photography']),
        h.p([h.Class('mt-2 text-sm text-stone-600')], ['Curated works. Managed via the admin dashboard.']),
        model.status === 'loading'
          ? h.p([h.Class('mt-8 text-sm text-stone-500')], ['Loading…'])
          : model.status === 'error'
            ? h.div([h.Class('mt-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800')], [
                h.p([], [model.error ?? 'Failed to load photos']),
                h.button(
                  [h.Class('mt-3 rounded-full bg-stone-900 px-4 py-1.5 text-xs font-medium text-white'), h.OnClick(Message.FetchPhotos())],
                  ['Retry'],
                ),
              ])
            : model.photos.length === 0
              ? h.p([h.Class('mt-8 text-sm text-stone-500')], ['No photos yet — add some in /admin.'])
              : h.div(
                  [h.Class('mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3')],
                  model.photos.map((photo) =>
                    h.div(
                      [h.Class('overflow-hidden rounded-xl border border-stone-200 bg-white'), h.Key(photo.id)],
                      [
                        h.img([
                          h.Class('h-56 w-full object-cover bg-stone-100'),
                          h.Src(`/api/image/${encodeURIComponent(photo.r2Key)}`),
                          h.Alt(photo.title),
                          h.Attribute('loading', 'lazy'),
                        ]),
                        h.div([h.Class('p-3')], [
                          h.h3([h.Class('text-sm font-semibold truncate')], [photo.title]),
                          h.p([h.Class('mt-1 text-xs text-stone-500')], [[photo.takenAt ?? '', `${photo.width}×${photo.height}`].filter(Boolean).join(' · ')]),
                          ...((photo.tags ?? []).length
                            ? [
                                h.div(
                                  [h.Class('mt-2 flex flex-wrap gap-1')],
                                  (photo.tags ?? []).map((tag) =>
                                    h.span([h.Class('rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-600'), h.Key(tag.id)], [tag.label]),
                                  ),
                                ),
                              ]
                            : []),
                        ]),
                      ],
                    ),
                  ),
                ),
      ],
    ),
  ]),
})
