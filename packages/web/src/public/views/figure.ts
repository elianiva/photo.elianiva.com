/**
 * Figure: one plate with its placard. `column` is a plate inside a flow, `about`
 * the About page's wide plate — the two are the same element at two measures,
 * so the slot only names where the plate sits and only the slot changes how it
 * is drawn. The lede's Page One slot is gone with the Page One plate: a
 * photograph is drawn the same way wherever it falls in the archive.
 *
 * The About page's plate is the design's Figure at the full content measure,
 * and its placard is set one step larger there (`type-deck` at `desktop`,
 * falling back to the caption size and a two-line clamp on the mobile master),
 * so `type-deck` rides on the slot rather than on the About page wrapping this.
 *
 * `loading` is an override rather than a slot fact because a slot says where a
 * plate sits, not whether the reader has scrolled to it: the About page draws
 * its second plate only on the mobile master, where it sits below the fold and
 * must not be fetched, and the Front's first Section fetches the plate at the
 * head of its flow because that one is above the fold.
 *
 * The mobile Figure master (size=mobile) differs from the desktop one at every
 * level: the placard is a two-line clamped title with a zero-padded number
 * under it, and the Exif line is gone. One tree carries both variants on the
 * `lg` breakpoint — the desktop composition needs its full 1080px
 * measure, so `lg` is where the `size` axis flips.
 */

import { Option } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'

import { frameNo, frameNoShort, plateUrl, RATIO_VALUE, type Figure as Plate } from '../content'
import { Message } from '../model'
import type { Child } from './shared'

/** Where a plate sits. `column` is a plate in a flow, and `about` is the About
 *  page's own full-measure plate. */
export const figureSlots = ['column', 'about'] as const
export type FigureSlot = (typeof figureSlots)[number]

export type FigureConfig = Readonly<{
  plate: Plate
  slot: FigureSlot
  /** Whether the browser fetches the original now. Defaults to the slot's own
   *  answer: a plate in a flow is below the fold, the About page's own plate is
   *  the page. */
  loading?: 'eager' | 'lazy'
}>

/** The placard title's measure. The mobile master clamps the caption to two
 *  lines; the desktop masters print it whole, at the caption's size in a
 *  Section and at the deck's on the About page. */
const titleClass = (slot: FigureSlot): string =>
  slot === 'about'
    ? 'type-caption italic text-role-text-primary line-clamp-2 lg:line-clamp-none lg:type-deck'
    : 'type-caption italic text-role-text-primary line-clamp-2 lg:line-clamp-none'

export const figure = (config: FigureConfig, h: HtmlBuilder<Message>): Child => {
  const { plate, slot } = config
  const loading = config.loading ?? (slot === 'column' ? 'lazy' : 'eager')
  return h.figure(
    [h.Key(plate.id), h.Class('flex flex-col gap-2 lg:gap-3')],
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
        [h.Class('flex flex-col gap-2 lg:flex-row lg:items-baseline lg:justify-between lg:gap-4')],
        [
          h.span([h.Class(titleClass(slot))], [plate.title]),
          // The mobile placard number is bare, not "No. 024".
          h.span(
            [h.Class('type-exif whitespace-nowrap text-role-text-secondary lg:hidden')],
            [frameNoShort(plate.index)],
          ),
          h.span(
            [h.Class('hidden type-exif whitespace-nowrap text-role-text-secondary lg:inline')],
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
        : [h.span([h.Class('hidden type-exif text-role-text-disabled lg:block')], [plate.exif])]),
    ],
  )
}
