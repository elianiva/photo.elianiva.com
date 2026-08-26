/**
 * Admin photo grid: masonry card layout with loading / error / empty states
 * and the "load more" pagination control.
 */

import type { HtmlBuilder } from 'foldkit/html'
import type { PhotoWithTags } from '@photo/shared'

import * as Badge from '@/components/ui/badge'
import * as Button from '@/components/ui/button'
import { cardSizes, srcSet, thumbUrl } from '@/lib/image'

import { Message as M } from '../model'
import type { Model, Msg } from '../model'
import { formatTakenAt, type Child } from './shared'

const photoCard = (photo: PhotoWithTags, h: HtmlBuilder<Msg>): Child =>
  h.figure(
    [
      h.Key(photo.id),
      h.Class('mb-4 break-inside-avoid cursor-pointer group'),
      h.OnClick(M.OpenEdit({ photo })),
    ],
    [
      h.img([
        h.Class(
          'w-full rounded-xl bg-stone-100 ring-stone-200 group-hover:ring-2 transition-shadow',
        ),
        h.Src(thumbUrl(photo)),
        h.Attribute('srcset', srcSet(photo)),
        h.Attribute('sizes', cardSizes),
        h.Alt(photo.title),
        h.Attribute('width', String(photo.width)),
        h.Attribute('height', String(photo.height)),
        h.Attribute('loading', 'lazy'),
      ]),
      h.figcaption(
        [h.Class('mt-2 px-1')],
        [
          h.div(
            [h.Class('flex items-baseline justify-between gap-2')],
            [
              h.h3([h.Class('text-sm font-medium truncate')], [photo.title]),
              h.span(
                [h.Class('text-[11px] text-stone-400 shrink-0')],
                [formatTakenAt(photo.takenAt)],
              ),
            ],
          ),
          (photo.tags ?? []).length > 0
            ? h.div(
                [h.Class('mt-1.5 flex flex-wrap gap-1')],
                [
                  ...(photo.tags ?? []).map((tag) =>
                    Badge.badge({ variant: 'secondary' }, [tag.label], h),
                  ),
                ],
              )
            : '',
        ],
      ),
    ],
  )

export const grid = (model: Model, h: HtmlBuilder<Msg>): Child => {
  if (model.status === 'loading') {
    return h.p([h.Class('mt-10 text-sm text-stone-500 animate-pulse')], ['Loading photos…'])
  }
  if (model.status === 'error') {
    return h.div(
      [h.Class('mt-10 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800')],
      [
        h.p([], [model.error ?? 'Failed to load photos']),
        Button.button(
          { onClick: M.SubmitSearch(), variant: 'outline', className: 'mt-3', size: 'sm' },
          'Retry',
          h,
        ),
      ],
    )
  }
  if (model.photos.length === 0) {
    return h.div(
      [h.Class('mt-10 rounded-xl border border-dashed border-stone-300 p-10 text-center')],
      [
        h.p([h.Class('text-sm font-medium text-stone-700')], ['No photos yet']),
        h.p([h.Class('mt-1 text-sm text-stone-500')], ['Upload your first photo to get started.']),
      ],
    )
  }
  return h.div(
    [],
    [
      h.div(
        [h.Class('mt-6 columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4')],
        model.photos.map((photo) => photoCard(photo, h)),
      ),
      ...(model.nextCursor !== null
        ? [
            h.div(
              [h.Class('mt-8 flex justify-center')],
              [
                Button.button(
                  {
                    onClick: M.LoadMore(),
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
    ],
  )
}
