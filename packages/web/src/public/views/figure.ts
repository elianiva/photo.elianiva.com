/**
 * Figure: one plate with its placard. `page` is the lede's Page One plate,
 * `column` a plate inside a Section, `about` the About page's wide plate — the
 * three are the same element at three measures, so the slot only names where
 * the plate sits and only the slot changes how it is drawn.
 *
 * The About page's plate is the design's Figure at the full content measure,
 * and its placard is set one step larger there (`type-deck` at `desktop`,
 * falling back to the caption size and a two-line clamp on the mobile master),
 * so `type-deck` rides on the slot rather than on the About page wrapping this.
 *
 * `loading` is an override rather than a slot fact because the About page draws
 * its second plate only on the mobile master: a plate the desktop composition
 * never lays out must not be fetched there, and on the mobile one it sits below
 * the fold. Lazy is the answer for that plate and the slot's own eager answer
 * is wrong for it.
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

/** Where a plate sits. `page` is Page One, `column` is a Section column, and
 *  `about` is the About page's own full-measure plate. */
export const figureSlots = ['page', 'column', 'about'] as const
export type FigureSlot = (typeof figureSlots)[number]

export type FigureConfig = Readonly<{
  plate: Plate
  slot: FigureSlot
  /** Whether the browser fetches the original now. Defaults to the slot's own
   *  answer: a plate in a Section is below the fold, a page's lead is not. */
  loading?: 'eager' | 'lazy'
}>

/** The placard title's measure. The mobile master clamps the caption to two
 *  lines; the desktop masters print it whole, at the caption's size in a
 *  Section and at the deck's on the About page. */
const titleClass = (slot: FigureSlot): string =>
  slot === 'about'
    ? 'type-caption italic text-role-text-primary line-clamp-2 desktop:line-clamp-none desktop:type-deck'
    : 'type-caption italic text-role-text-primary line-clamp-2 desktop:line-clamp-none'

export const figure = (config: FigureConfig, h: HtmlBuilder<Message>): Child => {
  const { plate, slot } = config
  const loading = config.loading ?? (slot === 'column' ? 'lazy' : 'eager')
  return h.figure(
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
            ...(loading === 'eager'
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
          h.span([h.Class(titleClass(slot))], [plate.title]),
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
}
