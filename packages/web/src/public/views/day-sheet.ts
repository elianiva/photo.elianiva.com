/**
 * A section of the timeline, drawn as one sheet of proofs: the capture day's
 * numeral and month in a rail at the left, and its frames in a strip at the
 * right, each on its own bit of film.
 *
 * A frame is a photo at a fixed height with its width following its Ratio, so a
 * month of mixed landscapes and portraits packs into rows the way a contact
 * sheet does, and the whole archive reads at a glance instead of one column at
 * a time. The film is drawn rather than typed: the soft gray stock and the two slim rows
 * of sprocket holes are CSS over one `<img>`, so the frame is still a single
 * button to the lightbox.
 *
 * The frame's title is not printed under it. It appears over the frame on
 * hover and on focus, and is the button's accessible name always, so a reader
 * with no pointer gets the same sentence the photograph would have carried.
 *
 * ## The one mark by hand
 *
 * The newest frame on the page is circled in a grease pencil with a handwritten
 * word beside it. It is the only thing on the site drawn to look like a person
 * did it, and the mark is a fact the data already holds — the newest published
 * Photo — not a new setting nobody has chosen. Every other frame is plain.
 *
 * The rail counts the day's frames and the strip draws exactly those,
 * so the count is the same fact in both places.
 */

import { Option } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'

import { frameCount, figureUrl, placeholderStyle, type DaySection, type Figure } from '../content'
import { Message } from '../model'
import { BAND, tiltFor, type Child } from './shared'

/** The capture day is the rail's numeral; an unusable legacy date has none. */
const numeralOf = (section: DaySection): string => (section.day === null ? '' : String(section.day))

/** One row of sprocket holes along a frame's edge. */
const SPROCKETS =
  'pointer-events-none absolute inset-x-0 h-[3px] [background:repeating-linear-gradient(90deg,var(--role-surface)_0_3px,transparent_3px_9px)]'

const grease = (h: HtmlBuilder<Message>): ReadonlyArray<Child> => [
  h.span(
    [
      h.AriaHidden(true),
      h.Class(
        'pointer-events-none absolute -inset-x-2 -inset-y-1.5 z-10 -rotate-3 rounded-[48%_52%_46%_54%/55%_45%_55%_45%] border-[2.5px] border-role-accent',
      ),
    ],
    [],
  ),
  h.span(
    [
      h.AriaHidden(true),
      h.Class(
        'type-hand pointer-events-none absolute -top-7 right-0 z-10 -rotate-6 whitespace-nowrap text-role-accent',
      ),
    ],
    ['latest →'],
  ),
]

const frame = (
  photo: Figure,
  config: { readonly eager: boolean; readonly marked: boolean; readonly tilt: number },
  h: HtmlBuilder<Message>,
): Child =>
  h.div(
    [
      h.Key(photo.id),
      h.Class(`relative lg:w-auto ${photo.aspect < 1 ? 'w-[68%]' : 'w-full'}`),
      h.Style({ transform: `rotate(${config.tilt}deg)` }),
    ],
    [
      h.button(
        [
          h.Class(
            'group relative block w-full cursor-pointer bg-role-primary-hover py-[4px] transition-transform duration-200 hover:z-20 hover:-translate-y-1 hover:-rotate-[0.6deg] focus-visible:z-20 focus-visible:ring-role-focus/50 outline-none focus-visible:ring-[3px] lg:w-fit',
          ),
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
          h.span([h.Class(`${SPROCKETS} top-[0.5px]`)], []),
          h.img([
            h.Class('block h-auto w-full lg:h-[142px] lg:w-auto'),
            h.Style({ ...placeholderStyle(photo), aspectRatio: String(photo.aspect) }),
            h.Src(figureUrl(photo)),
            // The button's label is the photo's accessible name; a second
            // reading of the same sentence would only make the frame noisier.
            h.Alt(''),
            ...(config.eager
              ? [h.Loading('eager'), h.Fetchpriority('high')]
              : [h.Loading('lazy'), h.Decoding('async')]),
          ]),
          h.span([h.Class(`${SPROCKETS} bottom-[0.5px]`)], []),
          // The title, over the frame: hidden until hover or focus reaches it.
          h.span(
            [
              h.Class(
                'type-caption pointer-events-none absolute inset-x-0 -top-8 mx-auto w-max max-w-[260px] bg-role-primary px-2.5 py-1 italic text-role-on-primary opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100',
              ),
            ],
            [photo.title],
          ),
        ],
      ),
      ...(config.marked ? grease(h) : []),
    ],
  )

const rail = (section: DaySection, h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class('flex items-baseline gap-3 lg:flex-col lg:items-start lg:gap-1')],
    [
      // The day, the month and the count are all written by hand in the accent,
      // at the head of the rail, beside the actual capture day rather than a
      // month number that can be mistaken for the date.
      h.span(
        [h.Class('type-hand -rotate-3 text-[44px] leading-none text-role-accent')],
        [numeralOf(section)],
      ),
      h.span(
        [h.Class('type-hand -rotate-3 whitespace-nowrap text-role-accent lowercase')],
        [`${section.month} ${section.year}`, h.br([]), frameCount(section.figures.length)],
      ),
    ],
  )

/** `headsDocument` is the home page's first capture day — the one whose first frames
 *  are above the fold, and so the figures the browser is told to fetch now, and
 *  the one the grease pencil marks. */
export const daySheet = (
  section: DaySection,
  headsDocument: boolean,
  h: HtmlBuilder<Message>,
): Child =>
  h.section(
    [h.Class('flex flex-col')],
    [
      h.div(
        [
          h.Class(
            `${BAND} grid gap-x-5 border-t border-role-rule pt-4 lg:grid-cols-[120px_minmax(0,1fr)]`,
          ),
        ],
        [
          rail(section, h),
          h.div(
            [
              h.Class(
                'flex flex-col items-start gap-5 pb-5 pt-9 lg:flex-row lg:flex-wrap lg:gap-2.5 lg:pt-0',
              ),
            ],
            section.figures.map((photo, index) =>
              frame(
                photo,
                {
                  eager: headsDocument && index < 4,
                  marked: headsDocument && index === 0,
                  tilt: tiltFor(photo.id, index),
                },
                h,
              ),
            ),
          ),
        ],
      ),
    ],
  )
