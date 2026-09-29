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
 * `volume` rides along unedited. The row authors `VOL. V` for the Masthead and
 * the design's SITE section draws only MOTTO, SECTIONS and ABOUT COPY, so the
 * draft carries the stored value through every save rather than adding a
 * control the canvas does not have or letting a save of the other fifteen
 * fields reset it.
 */

import { Schema as S } from 'effect'
import {
  MatColour,
  RenditionFormat,
  SiteSection,
  SiteSections,
  WatermarkPosition,
  type Settings,
  type SettingsInput,
} from '@photo/shared'

/** A free-text column as a control holds it: the empty string rather than null,
 *  because an input cannot hold "no value" the way a nullable column can. The
 *  two collapse at the boundary in {@link settingsInputOf}. */
const draftText = (value: string | null): string => value ?? ''

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
  copyright: S.String,
  retainForever: S.Boolean,
  volume: S.String,
  motto: S.String,
  aboutCopy: S.String,
  sections: SiteSections,
})
export type SettingsDraft = typeof SettingsDraft.Type

/** What a page draws before the row has arrived: the column defaults migration
 *  0005 declares, so the first paint is the page the row would produce rather
 *  than a flash of zeroes. */
export const emptySettingsDraft: SettingsDraft = {
  defaultPreviewLongEdge: 1200,
  defaultPreviewFormat: 'avif',
  defaultPreviewQuality: 82,
  defaultFullQuality: 92,
  watermarkEnabled: false,
  watermarkColour: 'white',
  watermarkPosition: 'bottom-right',
  defaultKeepExif: true,
  defaultRemoveGps: true,
  copyright: '',
  retainForever: true,
  volume: 'V',
  motto: '',
  aboutCopy: '',
  sections: [],
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
  copyright: draftText(settings.copyright),
  retainForever: settings.retainForever,
  volume: settings.volume,
  motto: draftText(settings.motto),
  aboutCopy: draftText(settings.aboutCopy),
  sections: [...settings.sections],
})

/** What a save sends: the whole row, because the row is a singleton. A partial
 *  write would be a second way to describe a page state, and `Save settings` is
 *  one call over one form.
 *
 *  An empty field is `null` on the wire, not `''` — a nullable column carries
 *  "never written", and a zero-length string is not it. */
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
  copyright: draft.copyright === '' ? null : draft.copyright,
  retainForever: draft.retainForever,
  volume: draft.volume,
  motto: draft.motto === '' ? null : draft.motto,
  aboutCopy: draft.aboutCopy === '' ? null : draft.aboutCopy,
  sections: draft.sections,
})

/** Whether the form has unsaved work, which is the whole of what `Save
 *  settings` is enabled by and the whole of what makes the header's
 *  `SAVED 2 MINUTES AGO` stale. Written out rather than compared as a
 *  serialisation, so a field added to the draft is a compile error here rather
 *  than a comparison that quietly stops looking at it. */
export const sameSettingsDraft = (a: SettingsDraft, b: SettingsDraft): boolean => {
  const scalarsMatch =
    a.defaultPreviewLongEdge === b.defaultPreviewLongEdge &&
    a.defaultPreviewFormat === b.defaultPreviewFormat &&
    a.defaultPreviewQuality === b.defaultPreviewQuality &&
    a.defaultFullQuality === b.defaultFullQuality &&
    a.watermarkEnabled === b.watermarkEnabled &&
    a.watermarkColour === b.watermarkColour &&
    a.watermarkPosition === b.watermarkPosition &&
    a.defaultKeepExif === b.defaultKeepExif &&
    a.defaultRemoveGps === b.defaultRemoveGps &&
    a.copyright === b.copyright &&
    a.retainForever === b.retainForever &&
    a.volume === b.volume &&
    a.motto === b.motto &&
    a.aboutCopy === b.aboutCopy
  if (!scalarsMatch) return false
  return a.sections.every((section, index) => {
    const other = b.sections[index]
    if (other === undefined) return false
    if (section.kind !== other.kind || section.label !== other.label) return false
    if (section.kind === 'all') return true
    return section.target === (other.kind === 'all' ? undefined : other.target)
  })
}

/** Whether the form has unsaved work. `saved` is the row as read, and a Model
 *  that has not read it yet has nothing to be different from — which is the
 *  answer both the header stamp and the Save button want. The one definition of
 *  "unsaved", so the three places that ask cannot disagree. */
export const settingsUnsaved = (draft: SettingsDraft, saved: Settings | undefined): boolean =>
  saved !== undefined && !sameSettingsDraft(draft, toSettingsDraft(saved))

// ---------------------------------------------------------------------------
// the nav repeater
// ---------------------------------------------------------------------------

export const SECTION_KINDS = ['all', 'tag', 'series', 'page'] as const
export type SectionKind = (typeof SECTION_KINDS)[number]

/** What a row can be told to do. One schema rather than a field per operation,
 *  so `update` has one case per edit and the reducer below is the only place
 *  that knows a Section's shape. */
export const SectionEdit = S.Union([
  S.Struct({ _tag: S.Literal('SetLabel'), index: S.Number, value: S.String }),
  S.Struct({ _tag: S.Literal('SetTarget'), index: S.Number, value: S.String }),
  S.Struct({ _tag: S.Literal('SetKind'), index: S.Number, kind: S.Literals(SECTION_KINDS) }),
  S.Struct({ _tag: S.Literal('Move'), index: S.Number, delta: S.Literals([-1, 1]) }),
  S.Struct({ _tag: S.Literal('Remove'), index: S.Number }),
  S.Struct({ _tag: S.Literal('Add') }),
])
export type SectionEdit = typeof SectionEdit.Type

/** A fresh row. `all` is the only kind with no target, and a fresh row of any
 *  other kind starts on an empty one rather than inheriting the last row's —
 *  a target is a slug, and a slug is not a default. */
const freshSection = (kind: SectionKind): SiteSection =>
  kind === 'all' ? { kind: 'all', label: '' } : { kind, label: '', target: '' }

export const applySectionEdit = (
  sections: ReadonlyArray<SiteSection>,
  edit: SectionEdit,
): ReadonlyArray<SiteSection> => {
  switch (edit._tag) {
    case 'SetLabel':
      return sections.map((section, at) =>
        at === edit.index ? { ...section, label: edit.value } : section,
      )
    case 'SetTarget':
      // The `all` Section is the Front itself and goes nowhere, so it has no
      // target to set — and the union says so, which is why this narrows.
      return sections.map((section, at) =>
        at === edit.index && section.kind !== 'all' ? { ...section, target: edit.value } : section,
      )
    case 'SetKind':
      // Re-typing a row is the one edit that changes its shape. `all` has no
      // target to keep, the other three need one, and neither is worth
      // carrying across: the old target named a destination under the old kind.
      return sections.map((section, at) => (at === edit.index ? freshSection(edit.kind) : section))
    case 'Move': {
      const to = edit.index + edit.delta
      const moving = sections[edit.index]
      const displaced = sections[to]
      // A move off either end is a no-op rather than a wrap: the row is already
      // where the button would put it.
      if (moving === undefined || displaced === undefined) return sections
      const next = [...sections]
      next[edit.index] = displaced
      next[to] = moving
      return next
    }
    case 'Remove':
      return sections.filter((_, at) => at !== edit.index)
    case 'Add':
      return [...sections, freshSection('tag')]
  }
}

// ---------------------------------------------------------------------------
// the option sets the Selects list
// ---------------------------------------------------------------------------

/** The four corners and the centre, in the order the Select lists them, with
 *  the labels the design's `$typography.exif` prints. */
export const watermarkPositionLabels: Readonly<Record<WatermarkPosition, string>> = {
  'bottom-left': 'BOTTOM LEFT',
  'bottom-right': 'BOTTOM RIGHT',
  'top-left': 'TOP LEFT',
  'top-right': 'TOP RIGHT',
  centre: 'CENTRE',
}

export const sectionKindLabels: Readonly<Record<SectionKind, string>> = {
  all: 'All photos',
  tag: 'Tag',
  series: 'Series',
  page: 'Page',
}

/** `PREVIEW LONG EDGE`. 1200 is the value the design draws and the value
 *  `image.preview.long-edge` declares in the broadsheet; the rest are the
 *  sizes either side of it a preview Rendition is usefully made at. */
export const PREVIEW_LONG_EDGES = [600, 800, 1200, 1600, 2000] as const
