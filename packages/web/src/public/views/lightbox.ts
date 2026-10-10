/**
 * Lightbox: the only place photo bytes are fetched a second time. The figure
 * sits on the design system's pure-white mat — no chrome beyond a close
 * affordance, and under the photograph the facts it was made with (camera,
 * lens, exposure, day) when the Photo carries any. Escape closes via the keydown Subscription; clicking anywhere
 * outside the image also closes.
 */

import { Option } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'

import { figurePreviewUrl, type Figure } from '../content'
import { Message } from '../model'
import type { Child } from './shared'

export const lightbox = (figure: Figure, h: HtmlBuilder<Message>): Child =>
  h.div(
    [
      h.Key('lightbox'),
      h.Class(
        'fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-role-mat-white p-6 sm:p-12 lg:gap-6 lg:p-16',
      ),
      h.OnClick(Message.CloseLightbox()),
      // Tab cycles back to the close button so focus never leaves the dialog.
      // The message is benign: re-selecting the open photo changes nothing.
      h.OnKeyDownFocus((key) =>
        key === 'Tab'
          ? Option.some({
              focusSelector: '#lightbox-close',
              message: Message.ClickedFigure({ id: figure.id }),
            })
          : Option.none(),
      ),
      h.Attribute('role', 'dialog'),
      h.AriaModal(true),
      h.AriaLabel(figure.title),
    ],
    [
      h.div(
        [h.Class('flex min-h-0 w-full flex-1 items-center justify-center')],
        [
          h.img([
            h.Class('max-h-full max-w-full h-auto w-auto object-contain'),
            h.Src(figurePreviewUrl(figure)),
            h.Alt(figure.title),
            h.Attribute('decoding', 'async'),
            h.Attribute('fetchpriority', 'high'),
            // Clicks on the image itself must not bubble to the close backdrop.
            h.OnClick(Message.ClickedFigure({ id: figure.id })),
          ]),
        ],
      ),
      ...(figure.details.length === 0
        ? []
        : [
            h.dl(
              [
                h.Class(
                  'grid max-h-[28vh] w-full max-w-[1080px] shrink-0 grid-cols-2 gap-x-6 gap-y-3 overflow-y-auto border-t border-role-hairline pt-4 sm:grid-cols-4 lg:flex lg:flex-wrap lg:justify-center lg:gap-x-10',
                ),
                h.OnClick(Message.ClickedFigure({ id: figure.id })),
              ],
              figure.details.map((detail) =>
                h.div(
                  [h.Class('flex min-w-0 flex-col gap-0.5')],
                  [
                    h.dt([h.Class('type-label text-role-text-disabled uppercase')], [detail.label]),
                    h.dd([h.Class('type-exif text-role-text-primary break-words')], [detail.value]),
                  ],
                ),
              ),
            ),
          ]),
      h.button(
        [
          h.Id('lightbox-close'),
          h.Autofocus(true),
          h.Class(
            'absolute top-12 right-12 type-label text-role-text-disabled hover:text-role-text-primary transition-colors duration-120 sm:top-16 sm:right-16',
          ),
          h.OnClick(Message.CloseLightbox()),
          h.AriaLabel('Close'),
        ],
        ['Close'],
      ),
    ],
  )
