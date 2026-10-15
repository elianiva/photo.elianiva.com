/**
 * Rows: a run of photographs laid out as justified rows, edge to edge, with
 * nothing cropped. It is the one arrangement the home page and a Tag page share.
 *
 * Every photo is drawn in its own Ratio. A frame's width is its Ratio times a
 * common row height, and a flex row grows each frame in proportion to its
 * Ratio, so a row's frames always share one height and fill the row's width
 * exactly — and because the height follows from the width through the same
 * Ratio, the box is never anything but the photo's own proportion. The layout
 * is plain CSS, so it is the same server-rendered and in the browser, needs no
 * measuring script, and re-flows with the window.
 *
 * The last row is not stretched: an empty trailing flex item takes the free
 * space, so a half-full last row keeps the frames' natural size instead of
 * blowing two photographs up to the page's width.
 *
 * The title is the button's accessible name always and appears over the frame
 * on hover and on focus.
 *
 * A photo below the fold is fetched lazily. `eagerCount` is how many frames at
 * the head of the page are above the fold and fetched now.
 */

import { Option } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'

import { figureUrl, placeholderStyle, type Figure } from '../content'
import { Message } from '../model'
import type { Child } from './shared'

/** The row height the rows aim for, which grows with the window. */
const ROW_HEIGHT = 'clamp(100px, 15vw, 260px)'

const frame = (photo: Figure, eager: boolean, h: HtmlBuilder<Message>): Child =>
  h.figure(
    [
      h.Key(photo.id),
      h.Class('m-0 min-w-0'),
      h.Style({
        width: `calc(${ROW_HEIGHT} * ${photo.aspect})`,
        flexGrow: String(photo.aspect),
        flexBasis: `calc(${ROW_HEIGHT} * ${photo.aspect})`,
      }),
    ],
    [
      h.button(
        [
          h.Class(
            'group relative block w-full cursor-pointer overflow-hidden bg-role-surface-container focus-visible:ring-role-focus/50 outline-none focus-visible:ring-[3px]',
          ),
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
            h.Class(
              'block h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]',
            ),
            h.Style(placeholderStyle(photo)),
            h.Src(figureUrl(photo)),
            // The button's label is the photo's accessible name.
            h.Alt(''),
            ...(eager
              ? [h.Loading('eager'), h.Fetchpriority('high')]
              : [h.Loading('lazy'), h.Decoding('async')]),
          ]),
          h.span(
            [
              h.Class(
                'pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-linear-to-t from-role-shadow/75 to-transparent px-3 pb-2.5 pt-8 text-left opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100',
              ),
            ],
            [
              h.span([h.Class('type-caption italic text-role-mat-paper')], [photo.title]),
              ...(photo.exif === null
                ? []
                : [h.span([h.Class('type-exif text-role-mat-paper/70')], [photo.exif])]),
            ],
          ),
        ],
      ),
    ],
  )

export const rows = (
  figures: ReadonlyArray<Figure>,
  eagerCount: number,
  h: HtmlBuilder<Message>,
): Child =>
  h.div(
    [h.Class("flex flex-wrap gap-2 after:grow-[9999] after:content-[''] lg:gap-2.5")],
    figures.map((photo, index) => frame(photo, index < eagerCount, h)),
  )
