/**
 * Admin Library grid: a fixed square-tile CSS grid whose column count the
 * operator picks (2–6, persisted to localStorage under its own key). Tiles
 * are black mats, each holding its photograph whole, and show the client-decoded
 * blurhash placeholder until the thumbnail loads —
 * the box is `aspect-square` at every size, so the placeholder appearing or
 * the bytes arriving never moves the rows around it. Hovering reveals the
 * title, Status and Edit / Delete; clicking a tile selects it, which is what the
 * Selection panel and the Bulk Bar read, and the pencil opens the Editor route (the
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

import { Check, Pencil, Trash2 } from 'lucide'

import { iconButton } from '@/components/ui/icon-button'
import { status } from '@/components/ui/status'
import type { StatusVariant } from '@/components/ui/status'
import { icon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { placeholderDataUrl } from '@/lib/blurhash'
import { originalUrl } from '@/lib/image'

import { Message as M } from '../model'
import type { Model, Msg } from '../model'
import { libraryEmpty } from './library-empty'
import { addTagDialog, bulkBar } from './library-table'
import { libraryPager } from './library-pager'
import { libraryError, libraryIsEmpty, libraryNoMatch } from './library-states'
import type { Child } from './shared'

// ---------------------------------------------------------------------------
// photo tile
// ---------------------------------------------------------------------------

/** A tile's action sits on the mat, so it is drawn in the mat's own white. */
const TILE_ACTION = 'size-8 rounded text-role-mat-white hover:bg-role-mat-white/20'

const photoTile = (photo: PhotoWithTags, model: Model, h: HtmlBuilder<Msg>): Child => {
  const placeholder =
    photo.blurhash !== undefined && photo.blurhash !== null
      ? placeholderDataUrl(photo.blurhash)
      : null
  const isSelected = model.selected.includes(photo.id)
  const variant: StatusVariant =
    photo.status === 'published' ? 'published' : photo.status === 'failed' ? 'failed' : 'draft'
  return h.figure(
    [h.Key(photo.id), h.DataAttribute('slot', 'photo-tile'), h.Class('group relative m-0')],
    [
      // The mat: a photograph sits whole on `color.shadow`, as it would on a
      // contact sheet, rather than being cropped to fill the square. A tile
      // selects, because the Selection panel and the Bulk Bar both read the
      // selection; the pencil is what opens the Editor.
      h.div(
        [
          h.Class(
            cn(
              'flex aspect-square w-full cursor-pointer items-center justify-center overflow-hidden rounded-md bg-role-shadow bg-cover bg-center p-3 outline-2 -outline-offset-2 transition-[outline-color] duration-120',
              isSelected
                ? 'outline outline-role-accent'
                : 'outline outline-transparent hover:outline-role-outline',
            ),
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
          h.DataAttribute('selected', String(isSelected)),
          h.OnClick(M.ToggledRowSelection({ id: photo.id })),
          h.Attribute('role', 'button'),
          h.AriaPressed(String(isSelected)),
          h.AriaLabel(`Select ${photo.title}`),
        ],
        [
          h.img([
            h.Class('max-h-full max-w-full object-contain'),
            h.Src(originalUrl(photo)),
            h.Alt(''),
            h.Attribute('loading', 'lazy'),
            h.Attribute('decoding', 'async'),
          ]),
        ],
      ),
      // The selection mark, filled once ticked and drawn on hover otherwise.
      h.span(
        [
          h.AriaHidden(true),
          h.Class(
            cn(
              'pointer-events-none absolute top-2.5 right-2.5 grid size-[18px] place-content-center rounded border-[1.5px] transition-opacity duration-120',
              isSelected
                ? 'border-role-accent bg-role-accent text-role-on-accent'
                : 'border-role-mat-white/70 opacity-0 group-hover:opacity-100',
            ),
          ),
        ],
        isSelected ? [icon(h, Check, 'size-3')] : [],
      ),
      // The overlay is a sibling of the click target — not a child — so
      // clicks on its buttons can never bubble into the tile's selection.
      h.div(
        [
          h.Class(
            'pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 rounded-b-md bg-gradient-to-t from-role-shadow/90 to-transparent px-3 pt-8 pb-2.5 opacity-0 transition-opacity duration-120 group-hover:opacity-100 group-focus-within:opacity-100',
          ),
        ],
        [
          h.div(
            [h.Class('flex min-w-0 flex-col gap-1')],
            [
              h.span([h.Class('type-caption truncate text-role-mat-white')], [photo.title]),
              status({ variant, className: 'text-role-mat-white' }, h),
            ],
          ),
          h.div(
            [h.Class('pointer-events-auto flex shrink-0 gap-1')],
            [
              iconButton(
                {
                  ariaLabel: `Edit ${photo.title}`,
                  onClick: M.OpenedPhoto({ id: photo.id }),
                  className: TILE_ACTION,
                  iconClass: 'size-4',
                },
                Pencil,
                h,
              ),
              iconButton(
                {
                  ariaLabel: `Delete ${photo.title}`,
                  onClick: M.RequestDeletePhoto({ id: photo.id, label: photo.title }),
                  className: TILE_ACTION,
                  iconClass: 'size-4',
                },
                Trash2,
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
  h.p([h.Class('mt-12 type-exif text-role-text-secondary animate-pulse')], ['Loading photos…'])

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
      // The grid selects too, so it draws the same Bulk Bar the table does,
      // and the Add-tag dialog that bar opens.
      ...(model.selected.length > 0 ? [h.div([h.Class('mt-4')], [bulkBar(model, h)])] : []),
      h.div(
        [
          h.DataAttribute('slot', 'library-grid'),
          h.Class('mt-2 grid gap-2 sm:gap-3'),
          h.Style({ gridTemplateColumns: `repeat(${String(model.cols)}, minmax(0, 1fr))` }),
        ],
        model.photos.map((photo) => photoTile(photo, model, h)),
      ),
      libraryPager(model, h),
      addTagDialog(model, h),
    ],
  )
}
