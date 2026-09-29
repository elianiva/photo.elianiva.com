/**
 * Admin Library grid: a fixed square-tile CSS grid whose column count the
 * operator picks (2–6, persisted to localStorage under its own key). Tiles
 * show the client-decoded blurhash placeholder until the thumbnail loads —
 * the box is `aspect-square` at every size, so the placeholder appearing or
 * the bytes arriving never moves the rows around it. Hovering reveals the
 * Tags plus Edit / Delete, and clicking a tile opens the Editor route (the
 * lightbox-as-tile-click path is retired, decision 2).
 *
 * The overlay is a sibling of the click target — not a child — so clicks on
 * its buttons can never bubble into opening the Editor.
 *
 * It is one of the Library's two views over the same `ListLibraryRows` read,
 * so its paging is the table's Pager and its error and filtered-empty states
 * are the shared ones, not a second arrangement of the same facts. A Library
 * with no Photographs at all is `library-empty.ts`, the design's own state with
 * the two real pickers.
 */

import type { HtmlBuilder } from 'foldkit/html'
import type { PhotoWithTags } from '@photo/shared'

import * as Badge from '@/components/ui/badge'
import * as Button from '@/components/ui/button'
import { placeholderDataUrl } from '@/lib/blurhash'
import { srcSet, thumbUrl } from '@/lib/image'

import { Message as M } from '../model'
import type { GridCols, Model, Msg } from '../model'
import { libraryEmpty } from './library-empty'
import { libraryPager } from './library-pager'
import { libraryError, libraryIsEmpty, libraryNoMatch } from './library-states'
import type { Child } from './shared'

// ---------------------------------------------------------------------------
// tile sizing hints
// ---------------------------------------------------------------------------

/** The grid sits in the Admin's content column (`max-w-(--layout-content-max)`,
 *  1080px) behind `px-(--layout-margin-mobile)` / `sm:px-(--layout-margin)`
 *  gutters, with `gap-2` / `sm:gap-3` between tiles. `sizes` tells the browser
 *  how wide one tile will be so it can pick from `srcset` before layout; the
 *  numbers here mirror those tokens, and a token change is a two-line change
 *  rather than a guess. */
const tileSizes = (cols: GridCols): string => {
  const gapsSm = ((cols - 1) * 0.75).toFixed(2)
  const gapsXs = ((cols - 1) * 0.5).toFixed(2)
  return [
    `(min-width: 1080px) calc((67.5rem - 6rem - ${gapsSm}rem) / ${String(cols)})`,
    `(min-width: 640px) calc((100vw - 6rem - ${gapsSm}rem) / ${String(cols)})`,
    `calc((100vw - 2rem - ${gapsXs}rem) / ${String(cols)})`,
  ].join(', ')
}

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
    [h.Key(photo.id), h.DataAttribute('slot', 'photo-tile'), h.Class('group relative m-0')],
    [
      h.div(
        [
          h.Class(
            'aspect-square w-full cursor-pointer overflow-hidden border border-role-hairline bg-role-surface-container bg-cover bg-center',
          ),
          h.Style({
            // The decoded blurhash paints the box until thumbnail bytes
            // arrive; photos uploaded before blurhash existed fall back to
            // the plain neutral background.
            ...(placeholder !== null ? { backgroundImage: `url(${placeholder})` } : {}),
          }),
          // The tile says which background it is painting, so the placeholder
          // is an observable fact rather than an opaque inline style.
          h.DataAttribute('placeholder', placeholder === null ? 'none' : 'blurhash'),
          // A tile opens the Editor, which is the Photo route — the same
          // destination the pencil reaches. There is no lightbox any more.
          h.OnClick(M.OpenedPhoto({ id: photo.id })),
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
            'pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-(--spacing-sm) bg-gradient-to-t from-role-shadow/60 to-transparent p-(--spacing-sm) opacity-0 transition-opacity duration-(--motion-duration-fast) group-hover:opacity-100 group-focus-within:opacity-100',
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
                  onClick: M.OpenedPhoto({ id: photo.id }),
                  variant: 'secondary',
                  className: 'bg-role-mat-white/90 backdrop-blur',
                },
                'Edit',
                h,
              ),
              Button.button(
                {
                  onClick: M.RequestDeletePhoto({ id: photo.id, label: photo.title }),
                  variant: 'destructive',
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
  h.p(
    [h.Class('mt-(--spacing-3xl) type-exif text-role-text-secondary animate-pulse')],
    ['Loading photos…'],
  )

// ---------------------------------------------------------------------------
// grid
// ---------------------------------------------------------------------------

export const grid = (model: Model, h: HtmlBuilder<Msg>): Child => {
  if (model.status === 'loading') return loadingState(h)
  if (model.status === 'error') return libraryError(model, h)
  if (model.photos.length === 0) {
    return libraryIsEmpty(model) ? libraryEmpty(h) : libraryNoMatch(model, h)
  }
  return h.div(
    [],
    [
      h.div(
        [
          h.DataAttribute('slot', 'library-grid'),
          h.Class('mt-2 grid gap-2 sm:gap-3'),
          h.Style({ gridTemplateColumns: `repeat(${String(model.cols)}, minmax(0, 1fr))` }),
        ],
        model.photos.map((photo) => photoTile(photo, tileSizes(model.cols), h)),
      ),
      libraryPager(model, h),
    ],
  )
}
