/**
 * Lightbox: the only place plate bytes are fetched a second time. The figure
 * sits on the design system's pure-white mat — no chrome beyond a close
 * affordance. Escape closes via the keydown Subscription; clicking anywhere
 * outside the image also closes.
 */

import { Option } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'

import { plateUrl, type Figure } from '../content'
import { Message } from '../model'
import type { Child } from './shared'

export const lightbox = (figure: Figure, h: HtmlBuilder<Message>): Child =>
  h.div(
    [
      h.Key('lightbox'),
      h.Class(
        'fixed inset-0 z-50 flex items-center justify-center bg-role-mat-white p-(--spacing-xl) sm:p-(--spacing-3xl) lg:p-(--spacing-4xl)',
      ),
      h.OnClick(Message.CloseLightbox()),
      // Tab cycles back to the close button so focus never leaves the dialog.
      // The message is benign: re-selecting the open plate changes nothing.
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
      h.img([
        h.Class('max-h-full max-w-full h-auto w-auto object-contain'),
        h.Src(plateUrl(figure)),
        h.Alt(figure.title),
        h.Attribute('decoding', 'async'),
        h.Attribute('fetchpriority', 'high'),
        // Clicks on the image itself must not bubble to the close backdrop.
        h.OnClick(Message.ClickedFigure({ id: figure.id })),
      ]),
      h.button(
        [
          h.Id('lightbox-close'),
          h.Autofocus(true),
          h.Class(
            'absolute top-(--spacing-3xl) right-(--spacing-3xl) type-kicker text-role-text-disabled hover:text-role-text-primary transition-colors duration-(--motion-duration-fast) sm:top-(--spacing-4xl) sm:right-(--spacing-4xl)',
          ),
          h.OnClick(Message.CloseLightbox()),
          h.AriaLabel('Close'),
        ],
        ['Close'],
      ),
    ],
  )
