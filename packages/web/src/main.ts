import { Schema as S } from 'effect'
import { type Update } from 'foldkit'
import type { Document, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { evo } from 'foldkit/struct'

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const Model = S.Struct({
  message: S.String,
  renderedAt: S.String,
  renderedOn: S.Literals(['Server', 'Client']),
})
export type Model = typeof Model.Type

// ---------------------------------------------------------------------------
// Flags — server builds them, client reuses them (hydration).
// ---------------------------------------------------------------------------

export const Flags = S.Struct({
  renderedAt: S.String,
  renderedOn: S.Literals(['Server', 'Client']),
})
export type Flags = typeof Flags.Type

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export const Message = defineMessageUnion({
  ClickedHello: {},
})

export type Message = typeof Message.Type

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match(message, {
    ClickedHello: () => [evo(model, { message: () => 'Hello World — clicked!' }), []],
  })

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export const init = (flags: Flags): readonly [Model, ReadonlyArray<never>] => [
  {
    message: 'Hello World',
    renderedAt: flags.renderedAt,
    renderedOn: flags.renderedOn,
  },
  [],
]

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'photo.elianiva.com — Photography',
  body: h.div(
    [
      h.Class(
        'flex min-h-screen flex-col items-center justify-center bg-stone-50 p-8 text-stone-900',
      ),
    ],
    [
      h.div(
        [h.Class('max-w-xl text-center')],
        [
          h.h1([h.Class('text-5xl font-semibold tracking-tight text-stone-900')], [model.message]),
          h.p(
            [h.Class('mt-4 text-lg leading-7 text-stone-600')],
            ['Photography by elianiva — curated works. Coming soon.'],
          ),
          h.p(
            [h.Class('mt-2 text-sm text-stone-500')],
            [`Rendered on the ${model.renderedOn} at ${model.renderedAt}`],
          ),
          h.button(
            [
              h.Class(
                'mt-8 rounded-full bg-stone-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-stone-800',
              ),
              h.OnClick(Message.ClickedHello()),
            ],
            ['Say hello'],
          ),
        ],
      ),
    ],
  ),
})
