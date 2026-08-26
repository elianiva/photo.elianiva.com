/**
 * Admin edit sheet: right-side Sheet for editing a Photo's metadata and tags,
 * with save and destructive delete actions.
 */

import type { HtmlBuilder } from 'foldkit/html'

import * as Button from '@/components/ui/button'
import * as Input from '@/components/ui/input'
import * as Sheet from '@/components/ui/sheet'
import { cardSizes, srcSet, thumbUrl } from '@/lib/image'

import { Message as M } from '../model'
import type { Model, Msg } from '../model'
import { embedCombo, type Child } from './shared'

const draftFieldInput = (
  model: Model,
  field: 'title' | 'slug' | 'takenAt' | 'caption' | 'location' | 'camera' | 'lens',
  label: string,
  h: HtmlBuilder<Msg>,
): Child =>
  field === 'caption'
    ? h.div(
        [h.Class('flex flex-col gap-1.5 w-full')],
        [
          h.label([h.For('draft-caption'), h.Class('text-sm font-medium')], ['Caption']),
          h.textarea([
            h.Id('draft-caption'),
            h.Value(model.draft.caption),
            h.OnInput((value) => M.SetDraftField({ field: 'caption', value })),
            h.Class(
              'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
            ),
          ]),
        ],
      )
    : Input.input(
        {
          id: `draft-${field}`,
          label,
          value: model.draft[field],
          onInput: (value) => M.SetDraftField({ field, value }),
          ...(field === 'takenAt' && { type: 'datetime-local', placeholder: 'From EXIF' }),
        },
        h,
      )

const editSheetContent = (
  model: Model,
  render: Sheet.SheetContent<Msg>,
  h: HtmlBuilder<Msg>,
): ReadonlyArray<Child> => {
  const editing = model.photos.find((photo) => photo.id === model.editingId)
  return [
    h.div(
      [h.Class('p-4 flex flex-col gap-4 overflow-y-auto')],
      [
        h.div(
          [h.Class('flex items-start justify-between gap-2')],
          [
            Sheet.title({ attributes: render.title }, ['Edit photo'], h),
            Sheet.closeButton({ attributes: render.closeButton }, ['×'], h),
          ],
        ),
        Sheet.description(
          { attributes: render.description },
          [editing?.slug ?? 'Adjust metadata and tags.'],
          h,
        ),
        editing !== undefined
          ? h.img([
              h.Class('w-full rounded-lg bg-stone-100 max-h-72 object-contain'),
              h.Src(thumbUrl(editing)),
              h.Attribute('srcset', srcSet(editing)),
              h.Attribute('sizes', cardSizes),
              h.Alt(editing.title),
            ])
          : '',
        draftFieldInput(model, 'title', 'Title', h),
        draftFieldInput(model, 'slug', 'Slug', h),
        draftFieldInput(model, 'takenAt', 'Taken at', h),
        draftFieldInput(model, 'location', 'Location', h),
        draftFieldInput(model, 'camera', 'Camera', h),
        draftFieldInput(model, 'lens', 'Lens', h),
        draftFieldInput(model, 'caption', 'Caption', h),
        h.div(
          [h.Class('flex flex-col gap-1.5')],
          [h.span([h.Class('text-sm font-medium')], ['Tags']), embedCombo(model, 'draft', h)],
        ),
      ],
    ),
    h.div(
      [h.Class('p-4 pt-0 mt-auto flex items-center gap-2')],
      [
        Button.button(
          {
            onClick: M.SaveEdits(),
            isDisabled: model.saving,
            className: 'flex-1',
          },
          model.saving ? 'Saving…' : 'Save changes',
          h,
        ),
        Button.button(
          {
            onClick: M.RequestDeletePhoto({
              id: editing?.id ?? '',
              label: editing?.title ?? 'this photo',
            }),
            variant: 'destructive',
            className: 'flex-1',
          },
          'Delete',
          h,
        ),
      ],
    ),
  ]
}

export const editSheet = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.submodel({
    slotId: 'admin-edit-sheet',
    model: model.editSheet,
    view: Sheet.view,
    viewInputs: Sheet.styledViewInputs<Msg>(
      {
        side: 'right',
        panelClass: 'w-full max-w-md',
        content: (render, innerH) => editSheetContent(model, render, innerH),
      },
      h,
    ),
    toParentMessage: (message) => M.GotEditSheetMessage({ message }),
  })
