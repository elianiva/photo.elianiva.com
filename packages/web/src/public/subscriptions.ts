/**
 * The public site's Subscriptions — app-lifecycle listeners declared on the
 * Model. The Escape listener only runs while the lightbox is open; changing
 * `selected` tears the listener down (close) or brings it up (open). It is
 * driven by the one field both public documents share, so it is the same
 * listener whether the plate that opened it was on the Front or on About.
 */

import { Effect, Option, Schema as S, Stream } from 'effect'
import { Subscription } from 'foldkit'

import { FigureSchema } from './content'
import { Message } from './model'
import type { Model } from './model'

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  lightboxKeys: entry(
    { selected: S.NullOr(FigureSchema) },
    {
      modelToDependencies: (model) => ({ selected: model.selected }),
      dependenciesToStream: ({ selected }) =>
        Stream.when(
          Subscription.fromEventFilterMap({
            target: window,
            type: 'keydown',
            filterMapEvent: (event) =>
              event.key === 'Escape' ? Option.some(Message.CloseLightbox()) : Option.none(),
          }),
          Effect.sync(() => selected !== null),
        ),
    },
  ),
}))
