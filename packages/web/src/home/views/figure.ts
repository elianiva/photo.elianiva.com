/**
 * Figure: one plate with its placard. `page` is the lede's Page One plate,
 * `column` a plate inside a section — the two are otherwise identical, so the
 * variant only names the slot it occupies and only the slot changes how the
 * bytes are fetched.
 *
 * The mobile Figure master (size=mobile) differs from the desktop one at every
 * level: the placard is a two-line clamped title with a zero-padded number
 * under it, and the Exif line is gone. One tree carries both variants on the
 * `desktop` breakpoint — the desktop composition needs its full 1080px
 * measure, so `breakpoint.desktop` is where the `size` axis flips.
 */

import { Option } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'

import { frameNo, frameNoShort, plateUrl, RATIO_VALUE, type Figure as Plate } from '../content'
import { Message } from '../model'
import type { Child } from './shared'

export const figure = (plate: Plate, variant: 'page' | 'column', h: HtmlBuilder<Message>): Child =>
  h.figure(
    [h.Key(plate.id), h.Class('flex flex-col gap-(--spacing-sm) desktop:gap-(--spacing-md)')],
    [
      h.button(
        [
          h.Class('block w-full cursor-pointer overflow-hidden bg-role-surface-container'),
          h.Style({ aspectRatio: String(RATIO_VALUE[plate.ratio]) }),
          h.OnClick(Message.ClickedFigure({ id: plate.id })),
          // Enter and Space are the button's own keys; the handler is here so a
          // keyboard reader gets the lightbox the mouse does.
          h.OnKeyDownPreventDefault((key) =>
            key === 'Enter' || key === ' '
              ? Option.some(Message.ClickedFigure({ id: plate.id }))
              : Option.none(),
          ),
          h.Tabindex(0),
          h.Attribute('role', 'button'),
          h.AriaLabel(`View ${plate.title}`),
        ],
        [
          h.img([
            h.Class('h-full w-full object-cover'),
            h.Src(plateUrl(plate)),
            // The placard below is the plate's accessible name; a second reading
            // of the same sentence would only make the figure noisier.
            h.Alt(''),
            ...(variant === 'page'
              ? [h.Loading('eager'), h.Fetchpriority('high')]
              : [h.Loading('lazy'), h.Decoding('async')]),
          ]),
        ],
      ),
      h.figcaption(
        [
          h.Class(
            'flex flex-col gap-(--spacing-sm) desktop:flex-row desktop:items-baseline desktop:justify-between desktop:gap-(--spacing-lg)',
          ),
        ],
        [
          h.span(
            [
              h.Class(
                'type-caption italic text-role-text-primary line-clamp-2 desktop:line-clamp-none',
              ),
            ],
            [plate.title],
          ),
          // The mobile placard number is bare, not "No. 024".
          h.span(
            [h.Class('type-exif whitespace-nowrap text-role-text-secondary desktop:hidden')],
            [frameNoShort(plate.index)],
          ),
          h.span(
            [h.Class('hidden type-exif whitespace-nowrap text-role-text-secondary desktop:inline')],
            [frameNo(plate.index)],
          ),
        ],
      ),
      // The exposure line runs the full measure below the caption, not beside
      // the frame number: at column width it is one line, and tucked into the
      // caption row it wraps. The mobile Figure master omits it entirely.
      //
      // A Photo carrying none of the facts an Exif line is made of has no line
      // at all (CONTEXT.md), so the element is left out rather than rendered
      // empty — an empty line under a plate reads as a bug in the photograph.
      ...(plate.exif === null
        ? []
        : [
            h.span(
              [h.Class('hidden type-exif text-role-text-disabled desktop:block')],
              [plate.exif],
            ),
          ]),
    ],
  )
