/**
 * Selection panel — the Library's right-hand panel: the Photo the operator has
 * selected, read at a glance and one click from the Editor. 320px, sunk below
 * the page like the sidebar, and drawn only on routes that list Photos.
 *
 * It reads the Library's own selection (`model.selected`), not a second one,
 * so a tick in the table, a tile in the grid and the Bulk Bar all agree about
 * what is held. One Photo selected is that Photo's card; several is a count and
 * a pointer to the Bulk Bar, which is where an action over many lives; none is
 * a line saying what to do.
 *
 * It states only what the Photo read model carries — number, Status, Ratio,
 * taken day, frame, Tags and the Exif line. `formatExifLine` is the one
 * producer of that line, so the panel and the public page cannot print it
 * two ways.
 */

import type { HtmlBuilder } from 'foldkit/html'
import { formatExifLine } from '@photo/shared'
import type { PhotoWithTags } from '@photo/shared'
import { Pencil, Trash2 } from 'lucide'

import * as Button from '@/components/ui/button'
import { status } from '@/components/ui/status'
import type { StatusVariant } from '@/components/ui/status'
import { icon } from '@/lib/icons'
import { smallUrl } from '@/lib/image'

import { Message as M } from '../model'
import type { Model, Msg } from '../model'
import { formatTaken } from './library-table'
import type { Child } from './shared'

const statusVariant = (photo: PhotoWithTags): StatusVariant =>
  photo.status === 'published' ? 'published' : photo.status === 'failed' ? 'failed' : 'draft'

const fact = (label: string, value: string, h: HtmlBuilder<Msg>): ReadonlyArray<Child> => [
  h.dt([h.Class('type-label text-role-text-secondary')], [label.toUpperCase()]),
  h.dd([h.Class('type-ui m-0 text-role-text-primary')], [value]),
]

const note = (text: string, h: HtmlBuilder<Msg>): Child =>
  h.p([h.Class('type-body m-0 text-center text-role-text-secondary italic')], [text])

const photoCard = (photo: PhotoWithTags, h: HtmlBuilder<Msg>): Child => {
  const exif = formatExifLine(photo)
  const tags = (photo.tags ?? []).map((tag) => `#${tag.slug}`).join('  ')
  const number = photo.number
  return h.div(
    [h.Class('flex flex-col gap-4')],
    [
      h.div(
        [
          h.Class(
            'flex aspect-square items-center justify-center overflow-hidden rounded-md bg-role-shadow p-5',
          ),
        ],
        [
          h.img([
            h.Class('max-h-full max-w-full object-contain'),
            h.Src(smallUrl(photo)),
            h.Alt(photo.title),
            h.Attribute('decoding', 'async'),
          ]),
        ],
      ),
      h.div(
        [h.Class('flex flex-col gap-2')],
        [
          ...(number === undefined || number === null
            ? []
            : [
                h.span(
                  [h.Class('type-exif text-role-text-secondary')],
                  [`NO. ${String(number).padStart(3, '0')}`],
                ),
              ]),
          h.h2([h.Class('type-section m-0 text-role-text-primary')], [photo.title]),
          status({ variant: statusVariant(photo) }, h),
        ],
      ),
      h.dl(
        [
          h.Class(
            'm-0 grid grid-cols-[72px_1fr] items-baseline gap-x-2 gap-y-2.5 border-t border-role-outline-variant pt-4',
          ),
        ],
        [
          ...fact('Taken', formatTaken(photo.takenAt), h),
          ...fact('Ratio', photo.ratio ?? '—', h),
          ...fact('Frame', `${String(photo.width)} × ${String(photo.height)}`, h),
          ...(tags === '' ? [] : fact('Tags', tags, h)),
          ...(exif === null ? [] : fact('Exif', exif, h)),
        ],
      ),
      h.div(
        [h.Class('flex gap-2')],
        [
          Button.button(
            {
              onClick: M.OpenedPhoto({ id: photo.id }),
              variant: 'accent',
              className: 'flex-1 justify-center',
            },
            h.span(
              [h.Class('inline-flex items-center gap-2')],
              [icon(h, Pencil, 'size-4'), 'Edit'],
            ),
            h,
          ),
          Button.button(
            {
              onClick: M.RequestDeletePhoto({ id: photo.id, label: photo.title }),
              variant: 'secondary',
              attributes: [h.AriaLabel(`Delete ${photo.title}`)],
            },
            icon(h, Trash2, 'size-4'),
            h,
          ),
        ],
      ),
    ],
  )
}

/** The panel. The selection's last id is the Photo shown: the one most
 *  recently ticked is the one the operator is looking at. An id off the loaded
 *  page — a selection kept across a page move — has no card to draw, and the
 *  count says so rather than the panel going quiet. */
export const selectionPanel = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const ids = model.selected
  const shown = ids.length === 1 ? model.photos.find((photo) => photo.id === ids[0]) : undefined
  return h.aside(
    [
      h.AriaLabel('Selection panel'),
      h.DataAttribute('slot', 'selection-panel'),
      h.Class(
        'bg-role-surface-sunken sticky top-0 hidden h-dvh w-80 shrink-0 flex-col overflow-y-auto px-6 py-8 xl:flex',
      ),
    ],
    [
      shown !== undefined
        ? photoCard(shown, h)
        : h.div(
            [h.Class('flex flex-1 items-center justify-center')],
            [
              note(
                ids.length > 1
                  ? `${String(ids.length)} photographs selected. Use the bar above the list to act on them.`
                  : ids.length === 1
                    ? 'That photograph is on another page.'
                    : 'Select a photograph to see its details.',
                h,
              ),
            ],
          ),
    ],
  )
}
