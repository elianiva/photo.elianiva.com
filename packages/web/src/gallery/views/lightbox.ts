/**
 * Lightbox: the only place Photo bytes are fetched on the public site.
 * Plain white canvas, the original HD file object-contained — no chrome
 * beyond a close affordance. Escape closes via the keydown Subscription;
 * clicking anywhere outside the image also closes.
 */

import type { HtmlBuilder } from 'foldkit/html'
import { PhotoWithTags } from '@photo/shared'

import { originalUrl } from '@/lib/image'

import { Message } from '../model'
import type { Child } from './shared'

export const lightbox = (photo: PhotoWithTags, h: HtmlBuilder<Message>): Child =>
  h.div(
    [
      h.Key('lightbox'),
      h.Class('fixed inset-0 z-50 flex items-center justify-center bg-white p-6 sm:p-10 lg:p-16'),
      h.OnClick(Message.CloseLightbox()),
      h.Attribute('role', 'dialog'),
      h.AriaLabel(photo.title),
    ],
    [
      h.img([
        h.Class('max-h-full max-w-full w-auto h-auto object-contain'),
        h.Src(originalUrl(photo)),
        h.Alt(photo.title),
        h.Attribute('decoding', 'async'),
        h.Attribute('fetchpriority', 'high'),
        // Clicks on the image itself must not bubble to the close backdrop.
        h.OnClick(Message.ClickedPhoto({ id: photo.id })),
      ]),
      h.button(
        [
          h.Class(
            'absolute top-6 right-6 sm:top-8 sm:right-8 text-[10px] uppercase tracking-[0.3em] text-neutral-400 hover:text-neutral-900 transition-colors',
          ),
          h.OnClick(Message.CloseLightbox()),
          h.AriaLabel('Close'),
        ],
        ['Close'],
      ),
    ],
  )
