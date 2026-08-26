/**
 * Admin photo grid: photos grouped under sticky day headers, justified rows
 * within each day (DP row breaking via `@/lib/layout`, shared with the
 * public gallery), and cards that show the client-decoded blurhash
 * placeholder until the thumbnail loads. Hovering a card reveals its tags
 * plus Edit / Delete actions. Clicking opens the lightbox (original file).
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
import { cardSizes, srcSet, thumbUrl } from '@/lib/image'
import { breakRows, lastRowSlack, toAspects } from '@/lib/layout'

import { Message as M } from '../model'
import type { Model, Msg } from '../model'
import { formatTakenAt, type Child } from './shared'

// ---------------------------------------------------------------------------
// day grouping
// ---------------------------------------------------------------------------

interface DayGroup {
  readonly label: string
  readonly photos: PhotoWithTags[]
}

/** Photos arrive sorted takenAt DESC, so equal day labels are always
 *  consecutive — single pass, order of first occurrence preserved. */
const groupByDay = (photos: readonly PhotoWithTags[]): readonly DayGroup[] => {
  const groups: DayGroup[] = []
  for (const photo of photos) {
    const label = formatTakenAt(photo.takenAt) || 'Undated'
    const last = groups[groups.length - 1]
    if (last !== undefined && last.label === label) {
      last.photos.push(photo)
    } else {
      groups.push({ label, photos: [photo] })
    }
  }
  return groups
}

// ---------------------------------------------------------------------------
// photo card
// ---------------------------------------------------------------------------

const photoCard = (photo: PhotoWithTags, h: HtmlBuilder<Msg>): Child => {
  // Same defensive clamp as the layout engine — keeps the aspect-ratio box
  // sane when stored dimensions are missing or absurd.
  const aspect = Math.min(Math.max(photo.width / Math.max(photo.height, 1), 0.5), 2.5)
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
            'w-full cursor-pointer overflow-hidden rounded-xl bg-stone-100 bg-cover bg-center',
          ),
          h.Style({
            aspectRatio: String(aspect),
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
            h.Attribute('sizes', cardSizes),
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
// day section: sticky header + justified rows
// ---------------------------------------------------------------------------

const daySection = (group: DayGroup, h: HtmlBuilder<Msg>): Child => {
  const aspects = toAspects(group.photos)
  const rows = breakRows(aspects)
  const rowNodes = rows.map((row, rowIndex) => {
    const isLast = rowIndex === rows.length - 1
    const children = row
      .map((photoIndex) => {
        const photo = group.photos[photoIndex]
        return photo === undefined ? undefined : photoCard(photo, h)
      })
      .filter((child): child is Exclude<typeof child, undefined> => child !== undefined)
    // The final row keeps its target height instead of stretching: a spacer
    // absorbs the slack, leaving the row left-aligned in whitespace.
    const slack = isLast ? lastRowSlack(aspects, rows) : 0
    if (slack > 0) {
      children.push(h.div([h.Style({ flex: `${slack} 1 0%` }), h.Class('hidden sm:block')], []))
    }
    return h.div(
      [
        h.Key(`row-${group.label}-${String(row[0] ?? 0)}`),
        h.Class('mb-3 flex items-start gap-3'),
      ],
      children,
    )
  })
  return h.section([h.Key(`day-${group.label}`), h.Class('mt-8')], [
    h.h2(
      [
        h.Class(
          'sticky top-14 z-10 -mx-2 bg-stone-50/90 px-2 py-2 text-xs font-medium uppercase tracking-widest text-stone-400 backdrop-blur-sm',
        ),
      ],
      [`${group.label} · ${String(group.photos.length)}`],
    ),
    ...rowNodes,
  ])
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
      ...groupByDay(model.photos).map((group) => daySection(group, h)),
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
