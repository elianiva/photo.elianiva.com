/**
 * Gallery Subscriptions — app-lifecycle listeners declared on the Model.
 * The Escape listener only runs while the lightbox is open; changing
 * `selectedId` tears the listener down (close) or brings it up (open).
 */

import { Effect, Option, Schema as S, Stream } from 'effect'
import { Subscription } from 'foldkit'

import { Message } from './model'
import type { Model } from './model'

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  lightboxKeys: entry(
    { selectedId: S.NullOr(S.String) },
    {
      modelToDependencies: (model) => ({ selectedId: model.selectedId }),
      dependenciesToStream: ({ selectedId }) =>
        Stream.when(
          Subscription.fromEventFilterMap<KeyboardEvent, Message>({
            target: window,
            type: 'keydown',
            toMessage: (event) =>
              event.key === 'Escape' ? Option.some(Message.CloseLightbox()) : Option.none(),
          }),
          Effect.sync(() => selectedId !== null),
        ),
    },
  ),
}))
