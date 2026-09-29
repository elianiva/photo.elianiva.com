/**
 * Gallery grid: justified rows of Photo figures with placard-style captions,
 * plus the loading / error / empty states and the load-more seam.
 *
 * Row breaks come from the DP layout in `layout.ts`; each figure flexes in
 * proportion to its aspect ratio so landscape Photos take the wider share of
 * a row while portrait Photos keep their ratio — at any container width.
 *
 * Tiles paint the client-decoded blurhash immediately, then lazy-load a
 * resized thumbnail on top so the placeholder resolves to real pixels.
 * Clicking a figure opens the lightbox with the original HD file (see
 * `lightbox` in view.ts).
 */

import type { HtmlBuilder } from 'foldkit/html'
import { PhotoWithTags } from '@photo/shared'
import { Option } from 'effect'

import { placeholderDataUrl } from '@/lib/blurhash'
import { galleryTileSizes, srcSet, thumbUrl } from '@/lib/image'
import { Message } from '../model'
import type { Model } from '../model'
import { breakRows, lastRowSlack, toAspects } from '@/lib/layout'
import type { Child } from './shared'

/** Shared cursor feedback timing, from `motion.duration.fast`. */
const TRANSITION = 'transition-colors duration-(--motion-duration-fast)'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** "2024 · Kyoto" style placard line — year first when known. */
const placardLine = (photo: PhotoWithTags): string => {
  const year = photo.takenAt?.slice(0, 4) ?? ''
  const location = photo.metadata?.location ?? ''
  return [year, location].filter(Boolean).join(' · ')
}

/** Year span for the hero subline, e.g. "2019 — 2025" or a single year. */
export const yearSpan = (photos: ReadonlyArray<PhotoWithTags>): string => {
  const years = photos
    .map((photo) => photo.takenAt?.slice(0, 4))
    .filter((year): year is string => year !== undefined && year !== '')
    .sort()
  if (years.length === 0) return ''
  const first = years[0] ?? ''
  const last = years[years.length - 1] ?? ''
  return first === last ? first : `${first} — ${last}`
}

// ---------------------------------------------------------------------------
// photo figure
// ---------------------------------------------------------------------------

const photoFigure = (photo: PhotoWithTags, aspect: number, h: HtmlBuilder<Message>): Child => {
  const placeholder =
    photo.blurhash !== undefined && photo.blurhash !== null
      ? placeholderDataUrl(photo.blurhash)
      : null
  return h.figure(
    [
      h.Key(photo.id),
      h.Style({ flex: `${aspect} 1 0%` }),
      h.Class('min-w-0 mb-(--spacing-4xl) lg:mb-(--spacing-5xl)'),
    ],
    [
      // Aspect-ratio box reserves layout space; blurhash paints it instantly and
      // the lazy thumbnail resolves on top. Photos without a stored blurhash
      // still load a thumbnail over the neutral fallback.
      h.div(
        [
          h.Class(
            'w-full cursor-pointer overflow-hidden bg-role-surface-container bg-cover bg-center',
          ),
          h.Style({
            aspectRatio: String(aspect),
            ...(placeholder !== null ? { backgroundImage: `url(${placeholder})` } : {}),
          }),
          h.OnClick(Message.ClickedPhoto({ id: photo.id })),
          h.OnKeyDownPreventDefault((key) =>
            key === 'Enter' || key === ' '
              ? Option.some(Message.ClickedPhoto({ id: photo.id }))
              : Option.none(),
          ),
          h.Tabindex(0),
          h.Attribute('role', 'button'),
          h.AriaLabel(`View ${photo.title}`),
        ],
        [
          h.img([
            h.Class('h-full w-full object-cover'),
            h.Src(thumbUrl(photo)),
            h.Attribute('srcset', srcSet(photo)),
            h.Attribute('sizes', galleryTileSizes),
            h.Alt(''),
            h.Attribute('loading', 'lazy'),
            h.Attribute('decoding', 'async'),
          ]),
        ],
      ),
      h.figcaption(
        [
          h.Class(
            'mt-(--spacing-md) lg:mt-(--spacing-lg) flex items-baseline justify-between gap-(--spacing-4xl)',
          ),
        ],
        [
          h.span([h.Class('type-deck italic text-role-text-primary')], [photo.title]),
          h.span(
            [h.Class('type-exif text-role-text-disabled whitespace-nowrap')],
            [placardLine(photo)],
          ),
        ],
      ),
    ],
  )
}

// ---------------------------------------------------------------------------
// states
// ---------------------------------------------------------------------------

const loadingState = (h: HtmlBuilder<Message>): Child =>
  h.p(
    [h.Class('py-(--spacing-6xl) text-center type-deck italic text-role-text-disabled')],
    ['Loading…'],
  )

const errorState = (model: Model, h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class('py-(--spacing-6xl) text-center')],
    [
      h.p([h.Class('type-deck italic text-role-text-secondary')], ['Something went wrong.']),
      h.p(
        [h.Class('mt-(--spacing-sm) text-xs text-role-text-disabled')],
        [model.error ?? 'Failed to load photographs'],
      ),
      h.button(
        [
          h.OnClick(Message.FetchPhotos()),
          h.Class(
            `mt-(--spacing-xl) type-kicker text-role-text-secondary border-b border-role-outline pb-(--spacing-xs) hover:text-role-text-primary hover:border-role-rule ${TRANSITION}`,
          ),
        ],
        ['Retry'],
      ),
    ],
  )

const emptyState = (h: HtmlBuilder<Message>): Child =>
  h.p(
    [h.Class('py-(--spacing-6xl) text-center type-deck italic text-role-text-disabled')],
    ['Nothing here yet.'],
  )

const loadMoreButton = (model: Model, h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class('flex justify-center py-(--spacing-5xl)')],
    [
      h.button(
        [
          h.OnClick(Message.LoadMore()),
          ...(model.loadingMore ? [h.Disabled(true)] : []),
          h.Class(
            `type-kicker text-role-text-secondary border-b border-role-hairline pb-(--spacing-sm) hover:text-role-text-primary hover:border-role-rule disabled:text-role-text-disabled disabled:border-role-outline-variant ${TRANSITION}`,
          ),
        ],
        [model.loadingMore ? 'Loading' : 'Load more'],
      ),
    ],
  )

// ---------------------------------------------------------------------------
// grid
// ---------------------------------------------------------------------------

export const grid = (model: Model, h: HtmlBuilder<Message>): Child => {
  if (model.status === 'loading') return loadingState(h)
  if (model.status === 'error') return errorState(model, h)
  if (model.photos.length === 0) return emptyState(h)

  const aspects = toAspects(model.photos)
  const rows = breakRows(aspects)

  const rowNodes = rows.map((row, rowIndex) => {
    const isLast = rowIndex === rows.length - 1
    const children = row.map((photoIndex) => {
      const photo = model.photos[photoIndex]
      if (photo === undefined) return undefined
      return photoFigure(photo, aspects[photoIndex] ?? 1, h)
    })
    // The final row keeps its target height instead of stretching: a spacer
    // absorbs the slack, leaving the row left-aligned in whitespace.
    const slack = isLast ? lastRowSlack(aspects, rows) : 0
    if (slack > 0) {
      children.push(h.div([h.Style({ flex: `${slack} 1 0%` }), h.Class('hidden sm:block')], []))
    }
    return h.div(
      [
        h.Key(`row-${String(rowIndex)}-${String(row[0] ?? 0)}`),
        h.Class('flex items-start gap-x-(--spacing-2xl) lg:gap-x-(--spacing-4xl)'),
      ],
      children.filter((child): child is Exclude<typeof child, undefined> => child !== undefined),
    )
  })

  return h.div([], [...rowNodes, loadMoreButton(model, h)])
}
