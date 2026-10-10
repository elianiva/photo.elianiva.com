/**
 * The public site's Subscriptions — app-lifecycle listeners declared on the
 * Model. The Escape listener only runs while the lightbox is open; changing
 * `selected` tears the listener down (close) or brings it up (open). It is
 * driven by the one field both public documents share, so it is the same
 * listener whether the photo that opened it was on the home page or on About.
 */

import { Effect, Option, Schema as S, Stream } from 'effect'
import { Subscription } from 'foldkit'

import { FigureSchema } from './content'
import { Message } from './model'
import type { Model } from './model'

const PREFETCH_DISTANCE = 900

const archiveIsNear = (): boolean => {
  const archive = document.getElementById('archive')
  return (
    archive !== null &&
    archive.getBoundingClientRect().top <= window.innerHeight + PREFETCH_DISTANCE
  )
}

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
  archiveScroll: entry(
    {
      home: S.Boolean,
      hasMore: S.Boolean,
      loading: S.Boolean,
      cursor: S.NullOr(S.String),
      error: S.NullOr(S.String),
    },
    {
      modelToDependencies: (model) => ({
        home: model.route === 'home',
        hasMore: model.sectionCursor !== null,
        loading: model.loadingMonths,
        cursor: model.sectionCursor,
        error: model.monthsError,
      }),
      dependenciesToStream: ({ home, hasMore, loading, error }) => {
        if (!home || !hasMore) return Stream.empty

        const scroll = Subscription.fromEventFilterMap({
          target: () => window,
          type: 'scroll',
          filterMapEvent: () =>
            archiveIsNear() ? Option.some(Message.LoadOlderMonths()) : Option.none(),
        })
        // Check once on mount and after each successful append. On failure,
        // wait for another scroll before retrying instead of spinning requests.
        const initial =
          !loading && error === null && archiveIsNear()
            ? Stream.succeed(Message.LoadOlderMonths())
            : Stream.empty

        return Stream.merge(
          initial,
          Stream.when(
            scroll,
            Effect.sync(() => !loading),
          ),
        )
      },
    },
  ),
}))
