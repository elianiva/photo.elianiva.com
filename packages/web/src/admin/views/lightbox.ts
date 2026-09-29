/**
 * Admin lightbox: full-screen canvas in the design system's absolute shadow
 * color, with the original HD file object-contained — the only place card
 * bytes beyond the thumbnail are fetched. The client-decoded blurhash paints
 * the backdrop while the original loads. Escape closes and ←/→ step through
 * the loaded photos via the keydown Subscription (`../subscriptions`);
 * clicking the backdrop or Close also closes.
 *
 * The scrim is always dark, so it and its foreground use the design system's
 * absolute `color.shadow` / `color.glow` rather than theme-flipping roles.
 */

import type { HtmlBuilder } from 'foldkit/html'

import { placeholderDataUrl } from '@/lib/blurhash'
import { originalUrl } from '@/lib/image'

import { Message as M } from '../model'
import type { Model, Msg } from '../model'
import { formatTakenAt, type Child } from './shared'

export const lightbox = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const photo = model.photos.find((entry) => entry.id === model.selectedId)
  if (photo === undefined) return ''
  const placeholder =
    photo.blurhash !== undefined && photo.blurhash !== null
      ? placeholderDataUrl(photo.blurhash)
      : null
  const canStep = model.photos.length > 1
  const caption = [photo.title, formatTakenAt(photo.takenAt)].filter(Boolean).join(' · ')
  return h.div(
    [
      h.Key('admin-lightbox'),
      h.Class(
        'fixed inset-0 z-50 flex items-center justify-center bg-role-shadow/95 bg-cover bg-center p-(--spacing-xl) sm:p-(--spacing-3xl) lg:p-(--spacing-4xl)',
      ),
      h.Style(placeholder !== null ? { backgroundImage: `url(${placeholder})` } : {}),
      h.OnClick(M.CloseLightbox()),
      h.Attribute('role', 'dialog'),
      h.AriaLabel(photo.title),
    ],
    [
      h.img([
        h.Class('max-h-full max-w-full w-auto h-auto object-contain shadow-2xl'),
        h.Src(originalUrl(photo)),
        h.Alt(photo.title),
        h.Attribute('decoding', 'async'),
        h.Attribute('fetchpriority', 'high'),
        // Clicks on the image itself must not bubble to the close backdrop.
        h.OnClick(M.ClickedPhoto({ id: photo.id })),
      ]),
      h.div(
        [
          h.Class(
            'absolute inset-x-0 bottom-(--spacing-xl) text-center type-exif text-role-glow/60 pointer-events-none',
          ),
        ],
        [caption],
      ),
      h.button(
        [
          h.Class(
            'absolute top-(--spacing-xl) right-(--spacing-xl) px-(--spacing-md) py-(--spacing-xs) type-kicker text-role-glow/80 hover:bg-role-glow/10 hover:text-role-glow transition-colors duration-(--motion-duration-fast)',
          ),
          h.OnClick(M.CloseLightbox()),
          h.AriaLabel('Close'),
        ],
        ['Close'],
      ),
      ...(canStep
        ? [
            h.button(
              [
                h.Class(
                  'absolute left-(--spacing-lg) top-1/2 -translate-y-1/2 flex size-10 items-center justify-center text-2xl text-role-glow/80 hover:bg-role-glow/10 hover:text-role-glow transition-colors duration-(--motion-duration-fast)',
                ),
                h.OnClick(M.PrevPhoto()),
                h.AriaLabel('Previous photo'),
              ],
              ['‹'],
            ),
            h.button(
              [
                h.Class(
                  'absolute right-(--spacing-lg) top-1/2 -translate-y-1/2 flex size-10 items-center justify-center text-2xl text-role-glow/80 hover:bg-role-glow/10 hover:text-role-glow transition-colors duration-(--motion-duration-fast)',
                ),
                h.OnClick(M.NextPhoto()),
                h.AriaLabel('Next photo'),
              ],
              ['›'],
            ),
          ]
        : []),
    ],
  )
}
