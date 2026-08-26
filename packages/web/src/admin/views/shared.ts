/**
 * Shared Admin view helpers: formatting utilities and the tag combobox
 * embedding used by both the edit sheet and the upload dialog.
 *
 * The picker's items are the known Tag ids plus, when the typed text matches
 * no existing label, a `create:<label>` pseudo-item rendered inline. Selecting
 * either arrives as the child's Selected out-message and is folded in update.
 */

import { DateTime, Option as Opt } from 'effect'
import { inertHtml } from 'foldkit/html'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Tag } from '@photo/shared'

import { Multi } from '@foldkit/ui/combobox'

import { Message as M, TagMultiCombo } from '../model'
import type { Model, Msg } from '../model'

export type Child = Html | string

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

const comboViewInputs = (
  combo: Model['draftCombo'],
  tags: ReadonlyArray<Tag>,
  selectedIds: ReadonlyArray<string>,
): Multi.ViewInputs<string> => {
  const query = combo.inputValue.trim()
  const hasExactMatch = tags.some((tag) => tag.label.toLowerCase() === query.toLowerCase())
  const items = [
    ...tags.map((tag) => tag.id),
    ...(query !== '' && !hasExactMatch ? [`${CREATE_PREFIX}${query}`] : []),
  ]
  const displayText = (item: string): string =>
    item.startsWith(CREATE_PREFIX)
      ? `Create “${item.slice(CREATE_PREFIX.length)}”`
      : labelOf(tags, item)
  return {
    items,
    selectedValues: selectedIds,
    restingInputValue: '',
    inputPlaceholder: 'Filter or create tags…',
    // Keep the listbox in place: native <dialog> panels live in the top
    // layer, which no z-index can outrank, so a body-level portal would be
    // unclickable behind the upload Dialog / edit Sheet.
    anchor: { placement: 'bottom-start', gap: 8, padding: 8, portal: false },
    itemToValue: (item) => item,
    itemToDisplayText: displayText,
    // ItemConfig.content is the rendered listbox row (Html, not a string).
    // Built with `inertHtml` — static content needs no dispatch wiring, and
    // the outer builder isn't guaranteed to be in scope when foldkit calls
    // itemToConfig.
    itemToConfig: (item) => {
      const content = inertHtml.span([], [displayText(item)])
      return item.startsWith(CREATE_PREFIX)
        ? {
            className:
              'text-stone-500 italic data-active:bg-stone-100 data-selected:bg-transparent',
            content,
          }
        : { content }
    },
  }
}

export const embedCombo = (model: Model, which: 'draft' | 'upload', h: HtmlBuilder<Msg>): Child =>
  h.submodel({
    slotId: `${which}-tag-combo`,
    model: which === 'draft' ? model.draftCombo : model.uploadCombo,
    view: TagMultiCombo.view,
    viewInputs: comboViewInputs(
      which === 'draft' ? model.draftCombo : model.uploadCombo,
      model.tags,
      which === 'draft' ? model.draftTagIds : model.uploadTagIds,
    ),
    toParentMessage: (message) =>
      which === 'draft'
        ? M.GotDraftComboMessage({ message })
        : M.GotUploadComboMessage({ message }),
  })
