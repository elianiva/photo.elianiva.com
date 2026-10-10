/**
 * The Settings draft — the working copy of the singleton the form edits, and
 * the mappings between it and the wire: the row as read, the draft as the
 * controls see it, and the payload a save sends.
 *
 * One struct rather than a field per control, because the page's dirty test is
 * "does the draft differ from the row" and per-control state would have to
 * answer that question a field at a time. It is also why the page needs no
 * single-select submodel: a `Segment` group is the state of one dropdown, and
 * every dropdown here is a field of this one value.
 *
 * Every field here has a control, and every control edits something the
 * photograph pipeline reads. The draft used to carry five more — a copyright
 * line, a motto, an about paragraph, a nav and a volume — of which one was
 * carried without a control and the other four the public site never read,
 * because every line the home page prints is written in the view that prints it
 * (migration 0008). Copy is not a setting.
 */

import { Schema as S } from 'effect'
import {
  MatColour,
  RenditionFormat,
  WatermarkPosition,
  type Settings,
  type SettingsInput,
} from '@photo/shared'

export const SettingsDraft = S.Struct({
  defaultPreviewLongEdge: S.Number,
  defaultPreviewFormat: RenditionFormat,
  defaultPreviewQuality: S.Number,
  defaultFullQuality: S.Number,
  watermarkEnabled: S.Boolean,
  watermarkColour: MatColour,
  watermarkPosition: WatermarkPosition,
  defaultKeepExif: S.Boolean,
  defaultRemoveGps: S.Boolean,
  retainForever: S.Boolean,
})
export type SettingsDraft = typeof SettingsDraft.Type

/** The rendition defaults migration 0005 declares. Named because the Editor
 *  falls back to them too: its Details tab prints the Photo's own settings, and
 *  before the draft has loaded the column defaults are the honest answer. */
export const DEFAULT_PREVIEW_LONG_EDGE = 1200
export const DEFAULT_PREVIEW_QUALITY = 82
export const DEFAULT_FULL_QUALITY = 92

/** What a page draws before the row has arrived, so the first paint is the page
 *  the row would produce rather than a flash of zeroes. */
export const emptySettingsDraft: SettingsDraft = {
  defaultPreviewLongEdge: DEFAULT_PREVIEW_LONG_EDGE,
  defaultPreviewFormat: 'avif',
  defaultPreviewQuality: DEFAULT_PREVIEW_QUALITY,
  defaultFullQuality: DEFAULT_FULL_QUALITY,
  watermarkEnabled: false,
  watermarkColour: 'white',
  watermarkPosition: 'bottom-right',
  defaultKeepExif: true,
  defaultRemoveGps: true,
  retainForever: true,
}

/** The row as the form holds it. The one function every comparison and every
 *  discard goes through, so "what the row says" is stated once. */
export const toSettingsDraft = (settings: Settings): SettingsDraft => ({
  defaultPreviewLongEdge: settings.defaultPreviewLongEdge,
  defaultPreviewFormat: settings.defaultPreviewFormat,
  defaultPreviewQuality: settings.defaultPreviewQuality,
  defaultFullQuality: settings.defaultFullQuality,
  watermarkEnabled: settings.watermarkEnabled,
  watermarkColour: settings.watermarkColour,
  watermarkPosition: settings.watermarkPosition,
  defaultKeepExif: settings.defaultKeepExif,
  defaultRemoveGps: settings.defaultRemoveGps,
  retainForever: settings.retainForever,
})

/** What a save sends: the whole row, because the row is a singleton. A partial
 *  write would be a second way to describe a page state, and `Save settings` is
 *  one call over one form. */
export const settingsInputOf = (draft: SettingsDraft): SettingsInput => ({
  defaultPreviewLongEdge: draft.defaultPreviewLongEdge,
  defaultPreviewFormat: draft.defaultPreviewFormat,
  defaultPreviewQuality: draft.defaultPreviewQuality,
  defaultFullQuality: draft.defaultFullQuality,
  watermarkEnabled: draft.watermarkEnabled,
  watermarkColour: draft.watermarkColour,
  watermarkPosition: draft.watermarkPosition,
  defaultKeepExif: draft.defaultKeepExif,
  defaultRemoveGps: draft.defaultRemoveGps,
  retainForever: draft.retainForever,
})

/** Whether the form has unsaved work, which is the whole of what `Save
 *  settings` is enabled by and the whole of what makes the header's
 *  `SAVED 2 MINUTES AGO` stale. Written out rather than compared as a
 *  serialisation, so a field added to the draft is a compile error here rather
 *  than a comparison that quietly stops looking at it. */
export const sameSettingsDraft = (a: SettingsDraft, b: SettingsDraft): boolean =>
  a.defaultPreviewLongEdge === b.defaultPreviewLongEdge &&
  a.defaultPreviewFormat === b.defaultPreviewFormat &&
  a.defaultPreviewQuality === b.defaultPreviewQuality &&
  a.defaultFullQuality === b.defaultFullQuality &&
  a.watermarkEnabled === b.watermarkEnabled &&
  a.watermarkColour === b.watermarkColour &&
  a.watermarkPosition === b.watermarkPosition &&
  a.defaultKeepExif === b.defaultKeepExif &&
  a.defaultRemoveGps === b.defaultRemoveGps &&
  a.retainForever === b.retainForever

/** Whether the form has unsaved work. `saved` is the row as read, and a Model
 *  that has not read it yet has nothing to be different from — which is the
 *  answer both the header stamp and the Save button want. The one definition of
 *  "unsaved", so the three places that ask cannot disagree. */
export const settingsUnsaved = (draft: SettingsDraft, saved: Settings | undefined): boolean =>
  saved !== undefined && !sameSettingsDraft(draft, toSettingsDraft(saved))

// ---------------------------------------------------------------------------
// the option sets the Selects list
// ---------------------------------------------------------------------------

/** `PREVIEW LONG EDGE`. 1200 is the value the design draws; the rest are the
 *  sizes either side of it a preview Rendition is usefully made at. */
export const PREVIEW_LONG_EDGES = [600, 800, 1200, 1600, 2000] as const
