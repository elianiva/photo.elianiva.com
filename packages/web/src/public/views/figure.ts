/**
 * Figure: one photo with its placard. `column` is a photo inside a flow, `about`
 * the About page's wide photo — the two are the same element at two measures,
 * so the slot only names where the photo sits and only the slot changes how it
 * is drawn. The intro's Page One slot is gone with the Page One photo: a
 * photograph is drawn the same way wherever it falls in the archive.
 *
 * The About page's photo is the design's Figure at the full content measure,
 * and its placard is set one step larger there (`type-lead` at `desktop`,
 * falling back to the caption size and a two-line clamp on the mobile master),
 * so `type-lead` rides on the slot rather than on the About page wrapping this.
 *
 * `loading` is an override rather than a slot fact because a slot says where a
 * photo sits, not whether the reader has scrolled to it: the About page draws
 * its second photo only on the mobile master, where it sits below the fold and
 * must not be fetched, and the home page's first Month fetches the photo at the
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

import { frameNo, frameNoShort, figureUrl, type Figure } from '../content'
import { Message } from '../model'
import type { Child } from './shared'

/** Where a photo sits. `column` is a photo in a flow, and `about` is the About
 *  page's own full-measure photo. */
export const figureSlots = ['column', 'about'] as const
export type FigureSlot = (typeof figureSlots)[number]

export type FigureConfig = Readonly<{
  photo: Figure
  slot: FigureSlot
  /** Whether the browser fetches the original now. Defaults to the slot's own
   *  answer: a photo in a flow is below the fold, the About page's own photo is
   *  the page. */
  loading?: 'eager' | 'lazy'
}>

/** The placard title's measure. The mobile master clamps the caption to two
 *  lines; the desktop masters print it whole, at the caption's size in a
 *  Month and at the deck's on the About page. */
const titleClass = (slot: FigureSlot): string =>
  slot === 'about'
    ? 'type-caption italic text-role-text-primary line-clamp-2 lg:line-clamp-none lg:type-lead'
    : 'type-caption italic text-role-text-primary line-clamp-2 lg:line-clamp-none'

export const figure = (config: FigureConfig, h: HtmlBuilder<Message>): Child => {
  const { photo, slot } = config
  const loading = config.loading ?? (slot === 'column' ? 'lazy' : 'eager')
  return h.figure(
    [h.Key(photo.id), h.Class('flex flex-col gap-2 lg:gap-3')],
    [
      h.button(
        [
          h.Class('block w-full cursor-pointer overflow-hidden bg-role-surface-container'),
          h.Style({ aspectRatio: String(photo.aspect) }),
          h.OnClick(Message.ClickedFigure({ id: photo.id })),
          // Enter and Space are the button's own keys; the handler is here so a
          // keyboard reader gets the lightbox the mouse does.
          h.OnKeyDownPreventDefault((key) =>
            key === 'Enter' || key === ' '
              ? Option.some(Message.ClickedFigure({ id: photo.id }))
              : Option.none(),
          ),
          h.Tabindex(0),
          h.Attribute('role', 'button'),
          h.AriaLabel(`View ${photo.title}`),
        ],
        [
          h.img([
            h.Class('h-full w-full object-cover'),
            h.Src(figureUrl(photo)),
            // The placard below is the photo's accessible name; a second reading
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
          h.span([h.Class(titleClass(slot))], [photo.title]),
          // The mobile placard number is bare, not "No. 024".
          h.span(
            [h.Class('type-exif whitespace-nowrap text-role-text-secondary lg:hidden')],
            [frameNoShort(photo.index)],
          ),
          h.span(
            [h.Class('hidden type-exif whitespace-nowrap text-role-text-secondary lg:inline')],
            [frameNo(photo.index)],
          ),
        ],
      ),
      // The exposure line runs the full measure below the caption, not beside
      // the frame number: at column width it is one line, and tucked into the
      // caption row it wraps. The mobile Figure master omits it entirely.
      //
      // A Photo carrying none of the facts an Exif line is made of has no line
      // at all (CONTEXT.md), so the element is left out rather than rendered
      // empty — an empty line under a photo reads as a bug in the photograph.
      ...(photo.exif === null
        ? []
        : [h.span([h.Class('hidden type-exif text-role-text-disabled lg:block')], [photo.exif])]),
    ],
  )
}
