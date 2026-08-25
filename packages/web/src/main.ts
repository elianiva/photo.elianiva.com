import { Schema as S } from 'effect'
import type { Document, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const Model = S.Struct({
  message: S.String,
})
export type Model = typeof Model.Type

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export const Message = defineMessageUnion({
  ClickedHello: {},
})

export type Message = typeof Message.Type

// ---------------------------------------------------------------------------
// Init — SPA: no Flags, no URL routing for hello world
// ---------------------------------------------------------------------------

export const init = (): readonly [Model, ReadonlyArray<never>] => [{ message: 'Hello World' }, []]

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export const update = (model: Model, message: Message): readonly [Model, ReadonlyArray<never>] =>
  Message.match(message, {
    ClickedHello: () => [{ ...model, message: 'Hello World — clicked!' }, []],
  })

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
