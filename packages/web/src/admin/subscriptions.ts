/**
 * Admin Subscriptions — app-lifecycle listeners declared on the Model.
 * The keydown listener only runs while the lightbox is open: Escape closes,
 * ←/→ step through the loaded photos. Changing `selectedId` tears the
 * listener down (close) or brings it up (open).
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
            toMessage: (event) => {
              if (event.key === 'Escape') return Option.some(Message.CloseLightbox())
              if (event.key === 'ArrowRight') return Option.some(Message.NextPhoto())
              if (event.key === 'ArrowLeft') return Option.some(Message.PrevPhoto())
              return Option.none()
            },
          }),
          Effect.sync(() => selectedId !== null),
        ),
    },
  ),
}))
