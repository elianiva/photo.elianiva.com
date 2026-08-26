/**
 * Admin photo grid: a fixed square-tile CSS grid whose column count the
 * operator picks in the header (2–6, persisted to localStorage — same
 * pattern as `len`). Tiles show the client-decoded blurhash placeholder
 * until the thumbnail loads; hovering reveals tags plus Edit / Delete
 * actions, clicking opens the lightbox (original file).
 *
 * The overlay is a sibling of the click target — not a child — so clicks on
 * its buttons can never bubble into opening the lightbox.
 */

import type { HtmlBuilder } from 'foldkit/html'
import type { PhotoWithTags } from '@photo/shared'

import * as Badge from '@/components/ui/badge'
import * as Button from '@/components/ui/button'
import { Empty } from '@/components/ui/empty'
import { placeholderDataUrl } from '@/lib/blurhash'
import { srcSet, thumbUrl } from '@/lib/image'

import { Message as M } from '../model'
import type { GridCols, Model, Msg } from '../model'
import type { Child } from './shared'

// ---------------------------------------------------------------------------
// tile sizing hints
// ---------------------------------------------------------------------------

/** The grid lives in the max-w-6xl (72rem) container with px-6 gutters;
 *  tiles split it into `cols` equal columns separated by gap-3. */
const tileSizes = (cols: GridCols): string =>
  cols === 2
    ? '(min-width: 1152px) calc((72rem - 3rem) / 2), calc((100vw - 3rem) / 2)'
    : `(min-width: 1152px) calc((72rem - 3rem) / ${String(cols)}), calc((100vw - 4.5rem) / ${String(cols)})`

// ---------------------------------------------------------------------------
// photo tile
// ---------------------------------------------------------------------------

const photoTile = (photo: PhotoWithTags, sizes: string, h: HtmlBuilder<Msg>): Child => {
  const placeholder =
    photo.blurhash !== undefined && photo.blurhash !== null
      ? placeholderDataUrl(photo.blurhash)
      : null
  const tags = photo.tags ?? []
  return h.figure(
    [h.Key(photo.id), h.Class('group relative m-0')],
    [
      h.div(
        [
          h.Class(
            'aspect-square w-full cursor-pointer overflow-hidden rounded-xl bg-stone-100 bg-cover bg-center',
          ),
          h.Style({
            // The decoded blurhash paints the box until thumbnail bytes
            // arrive; photos uploaded before blurhash existed fall back to
            // the plain neutral background.
            ...(placeholder !== null ? { backgroundImage: `url(${placeholder})` } : {}),
          }),
          h.OnClick(M.ClickedPhoto({ id: photo.id })),
          h.Attribute('role', 'button'),
          h.AriaLabel(`Open ${photo.title}`),
        ],
        [
          h.img([
            h.Class('h-full w-full object-cover'),
            h.Src(thumbUrl(photo)),
            h.Attribute('srcset', srcSet(photo)),
            h.Attribute('sizes', sizes),
            h.Alt(''),
            h.Attribute('loading', 'lazy'),
            h.Attribute('decoding', 'async'),
          ]),
        ],
      ),
      h.div(
        [
          h.Class(
            'pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 rounded-b-xl bg-gradient-to-t from-black/55 to-transparent p-2.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
          ),
        ],
        [
          tags.length > 0
            ? h.div(
                [h.Class('flex flex-wrap gap-1')],
                tags.map((tag) => Badge.badge({ variant: 'secondary' }, [tag.label], h)),
              )
            : '',
          h.div(
            [h.Class('pointer-events-auto ml-auto flex gap-1.5')],
            [
              Button.button(
                {
                  onClick: M.OpenEdit({ photo }),
                  variant: 'outline',
                  size: 'sm',
                  className: 'bg-white/90 backdrop-blur',
                },
                'Edit',
                h,
              ),
              Button.button(
                {
                  onClick: M.RequestDeletePhoto({ id: photo.id, label: photo.title }),
                  variant: 'destructive',
                  size: 'sm',
                },
                'Delete',
                h,
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

// ---------------------------------------------------------------------------
// states
// ---------------------------------------------------------------------------

const loadingState = (h: HtmlBuilder<Msg>): Child =>
  h.p([h.Class('mt-10 text-sm text-stone-500 animate-pulse')], ['Loading photos…'])

const errorState = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('mt-10 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800')],
    [
      h.p([], [model.error ?? 'Failed to load photos']),
      Button.button(
        { onClick: M.RetryFetch(), variant: 'outline', className: 'mt-3', size: 'sm' },
        'Retry',
        h,
      ),
    ],
  )

const noPhotosState = (h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('mt-10')],
    [
      Empty(
        { className: 'border border-dashed border-stone-300 p-10' },
        [
          Empty.header({}, [], h),
          Empty.title({}, ['No photos yet'], h),
          Empty.description({}, ['Upload your first photo to get started.'], h),
        ],
        h,
      ),
    ],
  )

const noMatchState = (activeLabel: string, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('mt-10')],
    [
      Empty(
        { className: 'border border-dashed border-stone-300 p-10' },
        [
          Empty.header({}, [], h),
          Empty.title({}, [`Nothing tagged “${activeLabel}”`], h),
          Empty.description(
            {},
            [
              'No loaded photos carry this tag. ',
              h.button(
                [
                  h.OnClick(M.FilterByTag({ slug: '' })),
                  h.Class('underline underline-offset-4 hover:text-stone-900'),
                ],
                ['Clear the filter'],
              ),
            ],
            h,
          ),
        ],
        h,
      ),
    ],
  )

// ---------------------------------------------------------------------------
// grid
// ---------------------------------------------------------------------------

export const grid = (model: Model, h: HtmlBuilder<Msg>): Child => {
  if (model.status === 'loading') return loadingState(h)
  if (model.status === 'error') return errorState(model, h)
  if (model.photos.length === 0) {
    const activeLabel = model.tags.find((tag) => tag.slug === model.activeTagSlug)?.label
    return activeLabel !== undefined ? noMatchState(activeLabel, h) : noPhotosState(h)
  }
  return h.div(
    [],
    [
      h.div(
        [
          h.Class('mt-2 grid gap-2 sm:gap-3'),
          h.Style({ gridTemplateColumns: `repeat(${String(model.cols)}, minmax(0, 1fr))` }),
        ],
        model.photos.map((photo) => photoTile(photo, tileSizes(model.cols), h)),
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
