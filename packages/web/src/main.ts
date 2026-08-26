import { Effect, Schema as S } from 'effect'
import { Command, Runtime } from 'foldkit'
import type { Document, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { PhotoWithTags } from '@photo/shared'

import * as Button from '@/components/ui/button'
import { gallerySizes, srcSet, thumbUrl } from '@/lib/image'
import { rpcPublic } from '@/lib/rpc'

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const Model = S.Struct({
  photos: S.Array(PhotoWithTags),
  nextCursor: S.NullOr(S.String),
  loadingMore: S.Boolean,
  status: S.String,
  error: S.optional(S.String),
})
export type Model = typeof Model.Type

interface PhotoPage {
  readonly items: ReadonlyArray<PhotoWithTags>
  readonly nextCursor: string | null
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export const Message = defineMessageUnion({
  FetchPhotos: {},
  SucceededFetchPhotos: {
    photos: S.Array(PhotoWithTags),
    nextCursor: S.NullOr(S.String),
  },
  SucceededFetchMore: {
    photos: S.Array(PhotoWithTags),
    nextCursor: S.NullOr(S.String),
  },
  LoadMore: {},
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
    SucceededFetchPhotos: ({ photos, nextCursor }) => [
      { ...model, status: 'ready', photos, nextCursor: nextCursor ?? null, loadingMore: false, error: undefined },
      [],
    ],
    SucceededFetchMore: ({ photos, nextCursor }) => [
      {
        ...model,
        photos: [...model.photos, ...photos],
        nextCursor: nextCursor ?? null,
        loadingMore: false,
      },
      [],
    ],
    LoadMore: () => {
      if (model.nextCursor === null || model.loadingMore) return [model, []]
      return [{ ...model, loadingMore: true }, [FetchMoreCmd(model.nextCursor)]]
    },
    FailedFetchPhotos: ({ message }) => [
      { ...model, status: 'error', error: message, loadingMore: false },
      [],
    ],
  })

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export const init: Runtime.ApplicationInit<Model, Message> = () => [
  { status: 'loading', photos: [], nextCursor: null, loadingMore: false, error: undefined },
  [FetchPhotosCmd()],
]

// ---------------------------------------------------------------------------
// Commands — photos come through the Effect RPC channel (ADR 0006)
// ---------------------------------------------------------------------------

const FetchPhotosCmd = Command.define('FetchPhotos', {
  messages: [Message.SucceededFetchPhotos, Message.FailedFetchPhotos],
  execute: Effect.map(rpcPublic<PhotoPage>('ListPhotos', { limit: 60 }), (page) =>
    Message.SucceededFetchPhotos({ photos: [...page.items], nextCursor: page.nextCursor }),
  ).pipe(
    Effect.catch((error) => Effect.succeed(Message.FailedFetchPhotos({ message: error.message }))),
  ),
})

const FetchMoreCmd = (cursor: string) =>
  Command.define('FetchMore', {
    messages: [Message.SucceededFetchMore, Message.FailedFetchPhotos],
    execute: Effect.map(rpcPublic<PhotoPage>('ListPhotos', { limit: 60, cursor }), (page) =>
      Message.SucceededFetchMore({ photos: [...page.items], nextCursor: page.nextCursor }),
    ).pipe(
      Effect.catch((error) => Effect.succeed(Message.FailedFetchPhotos({ message: error.message }))),
    ),
  })()

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'photo.elianiva.com — Photography',
  body: h.div(
    [h.Class('min-h-screen bg-stone-50 text-stone-900')],
    [
      h.header(
        [
          h.Class(
            'sticky top-0 z-10 border-b border-stone-200 bg-white/80 backdrop-blur px-6 py-3 flex items-center justify-between',
          ),
        ],
        [
          h.div([h.Class('text-sm font-semibold tracking-tight')], ['photo.elianiva.com']),
          h.a(
            [h.Class('text-xs text-stone-500 hover:text-stone-800 underline'), h.Href('/admin')],
            ['Admin →'],
          ),
        ],
      ),
      h.main(
        [h.Class('mx-auto max-w-5xl px-6 py-8')],
        [
          h.h1([h.Class('text-3xl font-semibold tracking-tight')], ['Photography']),
          h.p(
            [h.Class('mt-2 text-sm text-stone-600')],
            ['Curated works. Managed via the admin dashboard.'],
          ),
          model.status === 'loading'
            ? h.p([h.Class('mt-8 text-sm text-stone-500')], ['Loading…'])
            : model.status === 'error'
              ? h.div(
                  [
                    h.Class(
                      'mt-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800',
                    ),
                  ],
                  [
                    h.p([], [model.error ?? 'Failed to load photos']),
                    h.button(
                      [
                        h.Class(
                          'mt-3 rounded-full bg-stone-900 px-4 py-1.5 text-xs font-medium text-white',
                        ),
                        h.OnClick(Message.FetchPhotos()),
                      ],
                      ['Retry'],
                    ),
                  ],
                )
              : model.photos.length === 0
                ? h.p(
                    [h.Class('mt-8 text-sm text-stone-500')],
                    ['No photos yet — add some in /admin.'],
                  )
                : h.div([], [
                    h.div(
                      [h.Class('mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3')],
                      model.photos.map((photo) =>
                        h.div(
                          [
                            h.Class('overflow-hidden rounded-xl border border-stone-200 bg-white'),
                            h.Key(photo.id),
                          ],
                          [
                            h.img([
                              h.Class('h-56 w-full object-cover bg-stone-100'),
                              h.Src(thumbUrl(photo)),
                              h.Attribute('srcset', srcSet(photo)),
                              h.Attribute('sizes', gallerySizes),
                              h.Alt(photo.title),
                              h.Attribute('loading', 'lazy'),
                              h.Attribute('width', String(photo.width)),
                              h.Attribute('height', String(photo.height)),
                            ]),
                            h.div(
                              [h.Class('p-3')],
                              [
                                h.h3([h.Class('text-sm font-semibold truncate')], [photo.title]),
                                h.p(
                                  [h.Class('mt-1 text-xs text-stone-500')],
                                  [
                                    [photo.takenAt ?? '', `${photo.width}×${photo.height}`]
                                      .filter(Boolean)
                                      .join(' · '),
                                  ],
                                ),
                                ...((photo.tags ?? []).length
                                  ? [
                                      h.div(
                                        [h.Class('mt-2 flex flex-wrap gap-1')],
                                        (photo.tags ?? []).map((tag) =>
                                          h.span(
                                            [
                                              h.Class(
                                                'rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-600',
                                              ),
                                              h.Key(tag.id),
                                            ],
                                            [tag.label],
                                          ),
                                        ),
                                      ),
                                    ]
                                  : []),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                    ...(model.nextCursor !== null
                      ? [
                          h.div(
                            [h.Class('mt-8 flex justify-center')],
                            [
                              Button.button(
                                {
                                  onClick: Message.LoadMore(),
                                  variant: 'outline',
                                  isDisabled: model.loadingMore,
                                },
                                model.loadingMore ? 'Loading…' : 'Load more',
                                h,
                              ),
                            ],
                          ),
                        ]
                      : []),
                  ]),
        ],
      ),
    ],
  ),
})
