/**
 * Shared Admin view helpers: formatting utilities and the tag combobox
 * embedding the upload dialog uses.
 *
 * The picker's items are the known Tag ids plus, when the typed text matches
 * no existing label, a `create:<label>` pseudo-item rendered inline. Selecting
 * either arrives as the child's Selected out-message and is folded in update.
 */

import { DateTime, Option as Opt } from 'effect'
import { inertHtml } from 'foldkit/html'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Tag } from '@photo/shared'
import { Plus, X } from 'lucide'

import * as Combobox from '@/components/ui/combobox'
import type { Multi } from '@foldkit/ui/combobox'

import { icon } from '@/lib/icons'

import { Message as M, TagMultiCombo } from '../model'
import type { Model, Msg } from '../model'

export type Child = Html | string

/** The content column every page and the header align to. */
export const GUTTER = 'mx-auto w-full max-w-[1080px] px-4 sm:px-12'

export const formatBytes = (size: number): string =>
  size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`

export const formatTakenAt = (takenAt?: string): string => {
  if (takenAt === undefined || takenAt === '') return ''
  const maybe = DateTime.make(takenAt)
  if (Opt.isNone(maybe)) return takenAt
  const parts = DateTime.toPartsUtc(maybe.value)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

export const labelOf = (tags: ReadonlyArray<Tag>, id: string): string =>
  tags.find((tag) => tag.id === id)?.label ?? id

export const CREATE_PREFIX = 'create:'

/** Listbox row for an existing tag: label with a trailing check when picked,
 *  matching the styled combobox's selected-item affordance (the item class
 *  reserves `pr-8` for it). Built inert — static content needs no dispatch
 *  wiring, and the outer builder isn't guaranteed to be in scope when
 *  foldkit calls itemToConfig. */
const tagRow = (label: string, isSelected: boolean): Html =>
  inertHtml.span(
    [inertHtml.Class('flex w-full items-center gap-2 truncate')],
    [
      inertHtml.span([inertHtml.Class('truncate')], [label]),
      ...(isSelected ? [Combobox.comboboxCheck(inertHtml)] : []),
    ],
  )

/** Listbox row for the create pseudo-item: plus icon + “Create “x””, styled
 *  as a distinct action rather than a regular option. */
const createRow = (label: string): Html =>
  inertHtml.span(
    [inertHtml.Class('flex w-full items-center gap-2 type-exif text-role-text-secondary')],
    [
      icon(inertHtml, Plus, 'size-3.5 shrink-0'),
      inertHtml.span([inertHtml.Class('truncate')], [`Create “${label}”`]),
    ],
  )

const comboViewInputs = (
  combo: Model['uploadCombo'],
  tags: ReadonlyArray<Tag>,
  selectedIds: ReadonlyArray<string>,
): Multi.ViewInputs<string> => {
  const query = combo.inputValue.trim()
  const hasExactMatch = tags.some((tag) => tag.label.toLowerCase() === query.toLowerCase())
  const items = [
    ...tags.map((tag) => tag.id),
    ...(query !== '' && !hasExactMatch ? [`${CREATE_PREFIX}${query}`] : []),
  ]
  const isCreate = (item: string): boolean => item.startsWith(CREATE_PREFIX)
  return Combobox.multiViewInputs<string>({
    items,
    selectedValues: selectedIds,
    restingInputValue: '',
    inputPlaceholder: 'Filter or create tags…',
    ariaLabel: 'Tags',
    // Keep the listbox in place: native <dialog> panels live in the top
    // layer, which no z-index can outrank, so a body-level portal would be
    // unclickable behind the upload Dialog / edit Sheet.
    anchor: { placement: 'bottom-start', gap: 8, padding: 8, portal: false },
    buttonContent: Combobox.comboboxChevron(inertHtml),
    itemToValue: (item) => item,
    itemToDisplayText: (item) =>
      isCreate(item) ? `Create “${item.slice(CREATE_PREFIX.length)}”` : labelOf(tags, item),
    itemToConfig: (item, { isSelected }) =>
      isCreate(item)
        ? {
            className: 'data-active:bg-role-surface-container data-selected:bg-transparent',
            content: createRow(item.slice(CREATE_PREFIX.length)),
          }
        : { content: tagRow(labelOf(tags, item), isSelected) },
  })
}

/** Removable chip for one picked tag under the picker input. */
const pickedChip = (label: string, onRemove: Msg, h: HtmlBuilder<Msg>): Child =>
  h.span(
    [
      h.Class(
        'inline-flex max-w-full items-center gap-0.5 border border-role-outline bg-transparent py-1 pr-1 pl-2 type-exif text-role-text-primary',
      ),
    ],
    [
      h.span([h.Class('truncate')], [label]),
      h.button(
        [
          h.OnClick(onRemove),
          h.AriaLabel(`Remove tag ${label}`),
          h.Title(`Remove tag “${label}”`),
          h.Class(
            'shrink-0 p-1 text-role-text-disabled transition-colors duration-120 hover:bg-role-surface-hover hover:text-role-text-primary focus-visible:outline-none',
          ),
        ],
        [icon(h, X, 'size-3')],
      ),
    ],
  )

export const embedCombo = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const selectedIds = model.uploadTagIds
  const onRemove = (id: string): Msg => M.RemoveUploadTag({ id })
  return h.div(
    [h.Class('flex flex-col gap-2')],
    [
      h.submodel({
        slotId: 'upload-tag-combo',
        model: model.uploadCombo,
        view: TagMultiCombo.view,
        viewInputs: comboViewInputs(model.uploadCombo, model.tags, selectedIds),
        toParentMessage: (message) => M.GotUploadComboMessage({ message }),
      }),
      // Picked tags as removable chips — the multi-select input itself rests
      // empty by design, so without these the selection is invisible until the
      // listbox is opened.
      ...(selectedIds.length > 0
        ? [
            h.div(
              [h.Class('flex flex-wrap gap-1'), h.Role('list'), h.AriaLabel('Selected tags')],
              selectedIds.map((id) => pickedChip(labelOf(model.tags, id), onRemove(id), h)),
            ),
          ]
        : []),
    ],
  )
}
