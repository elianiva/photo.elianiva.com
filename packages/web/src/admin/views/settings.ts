/**
 * The Settings page — the form over the Admin's one row (master
 * `8b3ebe985801026f`). Five sections, each a kicker over its controls, each
 * closed by a hairline and separated by 24px, and the page's own `Save settings`
 * / `Discard changes` at the foot. Explicit save rather than autosave, because
 * the header's `SAVED 2 MINUTES AGO` has to mean something: the stamp is
 * `settings.updatedAt`, and a dirty form replaces it with `UNSAVED CHANGES`
 * rather than leaving a page that claims to be saved while it is not.
 *
 * Two deviations from the canvas, both deliberate and both recorded in
 * `CONTEXT.md`:
 *
 *   - The section the design labels `ARCHIVE` renders as `STORAGE`. The canvas
 *     contradicts itself — its own sidebar block is already called `Storage` —
 *     and ADR 0008 split the collision (ADR 0008).
 *   - `SECTIONS` is an ordered repeater of `{ label, kind, target }` rather than
 *     the canvas's single `ALL · STREET · LANDSCAPE · SERIES · ABOUT` string.
 *     A string that cannot be routed is a field whose value nothing can honour.
 *
 * The block reads `GetStorageUsage`, the same payload the sidebar's meter reads,
 * so the frame count, the byte total and the cap cannot come to disagree.
 */

import { DateTime, Option } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide'

import * as Button from '@/components/ui/button'
import * as IconButton from '@/components/ui/icon-button'
import * as Input from '@/components/ui/input'
import * as Select from '@/components/ui/select'
import * as Slider from '@/components/ui/slider'
import * as Swatch from '@/components/ui/swatch'
import * as ToggleRow from '@/components/ui/toggle-row'
import { WATERMARK_POSITIONS } from '@photo/shared'

import { Message as M } from '../model'
import type { Model, Msg } from '../model'
import {
  PREVIEW_LONG_EDGES,
  SECTION_KINDS,
  sectionKindLabels,
  settingsUnsaved,
  watermarkPositionLabels,
} from '../settings-draft'
import { storageFigure } from '../storage-index'
import type { Child } from './shared'

/** The watermark's three colours, named the way the operator reads them. The
 *  same three the Editor's Border panel picks between (CONTEXT.md, Mat). */
const WATERMARK_COLOURS = [
  { colour: 'white', label: 'White' },
  { colour: 'paper', label: 'Paper' },
  { colour: 'ink', label: 'Ink' },
] as const

const captionClass = 'italic type-caption text-role-text-secondary'

/** One section: a kicker, its controls, and the hairline the design closes
 *  every section with. The 24px below the rule is the same 24px the stack
 *  leaves between sections, so the two read as one rhythm. */
const section = (kicker: string, rows: ReadonlyArray<Child>, h: HtmlBuilder<Msg>): Child =>
  h.section(
    [h.Class('flex flex-col gap-(--spacing-md) border-b border-role-hairline pb-(--spacing-xl)')],
    [h.h2([h.Class('type-kicker text-role-text-secondary')], [kicker]), ...rows],
  )

// ---------------------------------------------------------------------------
// EXPORT DEFAULTS
// ---------------------------------------------------------------------------

const formatOptions = [
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WEBP' },
  { value: 'avif', label: 'AVIF' },
]

const longEdgeOptions = PREVIEW_LONG_EDGES.map((edge) => ({
  value: String(edge),
  label: `${String(edge)} PX`,
}))

const exportDefaults = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const draft = model.settingsDraft
  return section(
    'EXPORT DEFAULTS',
    [
      Select.select(
        {
          id: 'settings-preview-long-edge',
          label: 'PREVIEW LONG EDGE',
          value: String(draft.defaultPreviewLongEdge),
          options: longEdgeOptions,
          onChange: (raw) =>
            M.SetSettingsNumber({ field: 'defaultPreviewLongEdge', value: Number(raw) }),
        },
        h,
      ),
      Select.select(
        {
          id: 'settings-preview-format',
          label: 'FORMAT',
          value: draft.defaultPreviewFormat,
          options: formatOptions,
          onChange: (raw) =>
            M.SetPreviewFormat({
              value: raw === 'jpeg' || raw === 'webp' || raw === 'avif' ? raw : 'avif',
            }),
        },
        h,
      ),
      Slider.slider(
        {
          id: 'settings-preview-quality',
          label: 'PREVIEW QUALITY',
          value: draft.defaultPreviewQuality,
          min: 1,
          max: 100,
          step: 1,
          onInput: (value) => M.SetSettingsNumber({ field: 'defaultPreviewQuality', value }),
        },
        h,
      ),
      Slider.slider(
        {
          id: 'settings-full-quality',
          label: 'FULL QUALITY',
          value: draft.defaultFullQuality,
          min: 1,
          max: 100,
          step: 1,
          onInput: (value) => M.SetSettingsNumber({ field: 'defaultFullQuality', value }),
        },
        h,
      ),
    ],
    h,
  )
}

// ---------------------------------------------------------------------------
// WATERMARK
// ---------------------------------------------------------------------------

const watermark = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const draft = model.settingsDraft
  return section(
    'WATERMARK',
    [
      ToggleRow.toggleRow(
        {
          id: 'settings-watermark-enabled',
          label: 'Watermark new uploads',
          isChecked: draft.watermarkEnabled,
          onToggle: (isChecked) => M.SetWatermarkEnabled({ isChecked }),
        },
        h,
      ),
      h.div(
        [
          h.Class('flex items-center gap-(--spacing-sm)'),
          h.Role('group'),
          h.AriaLabel('Watermark colour'),
        ],
        WATERMARK_COLOURS.map((entry) =>
          Swatch.swatch(
            {
              colour: entry.colour,
              label: entry.label,
              isSelected: draft.watermarkColour === entry.colour,
              onSelect: M.SetWatermarkColour({ colour: entry.colour }),
            },
            h,
          ),
        ),
      ),
      h.p([h.Class(captionClass)], ['White, paper or ink.']),
      Select.select(
        {
          id: 'settings-watermark-position',
          label: 'POSITION',
          value: draft.watermarkPosition,
          options: WATERMARK_POSITIONS.map((position) => ({
            value: position,
            label: watermarkPositionLabels[position],
          })),
          onChange: (raw) =>
            M.SetWatermarkPosition({
              value: WATERMARK_POSITIONS.find((position) => position === raw) ?? 'bottom-right',
            }),
        },
        h,
      ),
      // A contract, not a description of what ships today: nothing stamps a
      // watermark yet (that is E2), and this string is the promise it inherits.
      // If E2 ever bakes the mark into the original as well, this line and
      // `CONTEXT.md` change in the same commit.
      h.p(
        [h.Class(captionClass)],
        ['Applies to published renditions. Downloads always serve the unmarked original.'],
      ),
    ],
    h,
  )
}

// ---------------------------------------------------------------------------
// METADATA
// ---------------------------------------------------------------------------

const metadata = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const draft = model.settingsDraft
  return section(
    'METADATA',
    [
      ToggleRow.toggleRow(
        {
          id: 'settings-keep-exif',
          label: 'Keep EXIF data',
          isChecked: draft.defaultKeepExif,
          onToggle: (isChecked) => M.SetMetadataPolicy({ field: 'defaultKeepExif', isChecked }),
        },
        h,
      ),
      ToggleRow.toggleRow(
        {
          id: 'settings-remove-gps',
          label: 'Remove GPS location',
          isChecked: draft.defaultRemoveGps,
          onToggle: (isChecked) => M.SetMetadataPolicy({ field: 'defaultRemoveGps', isChecked }),
        },
        h,
      ),
      Input.input(
        {
          id: 'settings-copyright',
          label: 'COPYRIGHT',
          value: draft.copyright,
          onInput: (value) => M.SetSettingsText({ field: 'copyright', value }),
          placeholder: '© Elianiva',
        },
        h,
      ),
    ],
    h,
  )
}

// ---------------------------------------------------------------------------
// STORAGE
// ---------------------------------------------------------------------------

/** The design's 4px bar: a `color.rule` fill over a track the `Free` half of
 *  it draws invisibly. Hidden from assistive tech because the sentence above it
 *  says the same fraction in words. A cap of zero is an aggregate that could
 *  not be read rather than a full bucket; dividing by it would be NaN, and a
 *  NaN width silently vanishes. */
const storageBar = (usedPercent: number, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.AriaHidden(true), h.Class('h-1 w-full overflow-hidden bg-transparent')],
    [h.div([h.Class('h-full bg-role-rule'), h.Style({ width: `${usedPercent.toFixed(2)}%` })], [])],
  )

const storage = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const { bytes, capBytes } = model.storage
  const usedPercent = capBytes > 0 ? Math.min(100, Math.max(0, (bytes / capBytes) * 100)) : 0
  return section(
    'STORAGE',
    [
      h.p(
        [h.Class('type-exif text-role-text-primary')],
        [storageFigure({ photos: model.storage.photos, bytes, capBytes })],
      ),
      storageBar(usedPercent, h),
      Button.button(
        {
          onClick: M.ExportCsvIndex({}),
          variant: 'ghost',
          isDisabled: model.settingsIndexing,
        },
        model.settingsIndexing ? 'Building the index…' : 'Export a CSV index',
        h,
      ),
      Select.select(
        {
          id: 'settings-retain',
          label: 'RETAIN',
          value: draftRetainValue(model),
          options: [{ value: 'forever', label: 'FOREVER' }],
          onChange: (raw) => M.SetRetention({ forever: raw !== 'never' }),
          // Nothing purges on a timer anywhere in the chain, so the only value
          // this offers is the one that is true. A second option would be a
          // setting for a purge that does not exist.
          isDisabled: true,
        },
        h,
      ),
      h.p(
        [h.Class(captionClass)],
        [
          'Nothing is purged on a timer. Emptying the Trash is the only thing that frees its bytes.',
        ],
      ),
    ],
    h,
  )
}

const draftRetainValue = (model: Model): string =>
  model.settingsDraft.retainForever ? 'forever' : 'never'

// ---------------------------------------------------------------------------
// SITE
// ---------------------------------------------------------------------------

/** One Section's row. The target field appears only for the three kinds that
 *  go somewhere, which is what the `SiteSection` union in `@photo/shared` is
 *  for: an `all` row cannot hold a target even by accident. */
const sectionRow = (model: Model, index: number, h: HtmlBuilder<Msg>): Child => {
  const row = model.settingsDraft.sections[index]
  if (row === undefined) return h.empty
  const isFirst = index === 0
  const isLast = index === model.settingsDraft.sections.length - 1
  return h.li(
    [h.Class('flex flex-wrap items-end gap-(--spacing-md)')],
    [
      Input.input(
        {
          id: `settings-section-${String(index)}-label`,
          label: 'LABEL',
          value: row.label,
          onInput: (value) => M.EditedSection({ edit: { _tag: 'SetLabel', index, value } }),
          placeholder: 'Street',
        },
        h,
      ),
      Select.select(
        {
          id: `settings-section-${String(index)}-kind`,
          label: 'KIND',
          value: row.kind,
          options: SECTION_KINDS.map((kind) => ({ value: kind, label: sectionKindLabels[kind] })),
          onChange: (raw) =>
            M.EditedSection({
              edit: {
                _tag: 'SetKind',
                index,
                kind: SECTION_KINDS.find((candidate) => candidate === raw) ?? row.kind,
              },
            }),
          className: 'w-[180px]',
        },
        h,
      ),
      ...(row.kind === 'all'
        ? []
        : [
            Input.input(
              {
                id: `settings-section-${String(index)}-target`,
                label: 'TARGET',
                value: row.target,
                onInput: (value) => M.EditedSection({ edit: { _tag: 'SetTarget', index, value } }),
                placeholder: row.kind === 'page' ? 'about' : 'street',
              },
              h,
            ),
          ]),
      h.div(
        [h.Class('flex items-center gap-(--spacing-xs) pb-(--spacing-sm)')],
        [
          IconButton.iconButton(
            {
              ariaLabel: `Move ${row.label === '' ? 'section' : row.label} up`,
              onClick: M.EditedSection({ edit: { _tag: 'Move', index, delta: -1 } }),
              isDisabled: isFirst,
            },
            ArrowUp,
            h,
          ),
          IconButton.iconButton(
            {
              ariaLabel: `Move ${row.label === '' ? 'section' : row.label} down`,
              onClick: M.EditedSection({ edit: { _tag: 'Move', index, delta: 1 } }),
              isDisabled: isLast,
            },
            ArrowDown,
            h,
          ),
          IconButton.iconButton(
            {
              ariaLabel: `Remove ${row.label === '' ? 'section' : row.label}`,
              onClick: M.EditedSection({ edit: { _tag: 'Remove', index } }),
            },
            Trash2,
            h,
          ),
        ],
      ),
    ],
  )
}

const site = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const draft = model.settingsDraft
  return section(
    'SITE',
    [
      Input.input(
        {
          id: 'settings-motto',
          label: 'MOTTO',
          value: draft.motto,
          onInput: (value) => M.SetSettingsText({ field: 'motto', value }),
          placeholder: 'Street, mostly. Landscape, sometimes.',
        },
        h,
      ),
      h.fieldset(
        [h.Class('flex flex-col gap-(--spacing-md) border-0 p-0')],
        [
          h.legend([h.Class('type-kicker text-role-text-secondary')], ['SECTIONS']),
          draft.sections.length === 0
            ? h.p(
                [h.Class(captionClass)],
                ['No sections yet. The Folio prints what this list holds, in this order.'],
              )
            : h.ul(
                [h.Class('flex flex-col gap-(--spacing-md)'), h.AriaLabel('Site sections')],
                draft.sections.map((_, index) => sectionRow(model, index, h)),
              ),
          Button.button(
            { onClick: M.EditedSection({ edit: { _tag: 'Add' } }), variant: 'ghost' },
            'Add a section',
            h,
          ),
        ],
      ),
      Input.input(
        {
          id: 'settings-about-copy',
          label: 'ABOUT COPY',
          value: draft.aboutCopy,
          onInput: (value) => M.SetSettingsText({ field: 'aboutCopy', value }),
          placeholder: 'One camera, one lens, and a lot of walking.',
        },
        h,
      ),
    ],
    h,
  )
}

// ---------------------------------------------------------------------------
// the header's stamp
// ---------------------------------------------------------------------------

/** `SAVED 2 MINUTES AGO` — the design's `$typography.exif` stamp, read off
 *  `settings.updatedAt`. The clock is a parameter and read from `DateTime` here
 *  rather than held in the Model, because a stamp that only moves when the
 *  Model does is a stamp that lies about being two minutes old an hour later;
 *  the Page Head already reads the ambient `navigator` for its keycap, so this
 *  is the same convention. Tests pass the instant they mean. */
export const settingsStamp = (model: Model, now: DateTime.Utc = DateTime.nowUnsafe()): string => {
  // An unsaved edit is the whole point of the stamp: a header that still says
  // SAVED over a form with changes in it is claiming something untrue.
  if (settingsUnsaved(model.settingsDraft, model.settings)) return 'UNSAVED CHANGES'
  const updatedAt = model.settings?.updatedAt
  // Null is a row nobody has saved yet, which is not the same as a row saved in
  // 1970 and must not be printed as one.
  if (updatedAt === undefined || updatedAt === null) return 'NOT SAVED YET'
  const savedAt = DateTime.make(updatedAt)
  if (Option.isNone(savedAt)) return 'SAVED JUST NOW'
  const elapsed = now.epochMilliseconds - savedAt.value.epochMilliseconds
  if (!Number.isFinite(elapsed) || elapsed < 0) return 'SAVED JUST NOW'
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'SAVED JUST NOW'
  if (minutes < 60) return `SAVED ${String(minutes)} MINUTE${minutes === 1 ? '' : 'S'} AGO`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `SAVED ${String(hours)} HOUR${hours === 1 ? '' : 'S'} AGO`
  const days = Math.floor(hours / 24)
  return `SAVED ${String(days)} DAY${days === 1 ? '' : 'S'} AGO`
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

/** `Save settings` and `Discard changes`, both inert until the draft differs
 *  from the row. A discard with nothing to discard and a save with nothing to
 *  save are the same no-op, and both buttons say so by being off. */
const actions = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const unsaved = settingsUnsaved(model.settingsDraft, model.settings)
  return h.div(
    [h.Class('flex items-center gap-(--spacing-sm)')],
    [
      Button.button(
        { onClick: M.SaveSettings({}), isDisabled: !unsaved || model.settingsSaving },
        model.settingsSaving ? 'Saving…' : 'Save settings',
        h,
      ),
      Button.button(
        { onClick: M.DiscardSettings({}), variant: 'secondary', isDisabled: !unsaved },
        'Discard changes',
        h,
      ),
    ],
  )
}

const notLoaded = (h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('flex flex-col items-start gap-4 pt-(--spacing-xl)')],
    [h.p([h.Class('type-deck text-role-text-secondary')], ['Loading settings…'])],
  )

const failed = (h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('flex flex-col items-start gap-4 pt-(--spacing-xl)')],
    [
      h.p(
        [h.Class('type-deck text-role-text-secondary')],
        ['The settings could not be read, so nothing is drawn to edit over a row nobody has seen.'],
      ),
      Button.button({ onClick: M.RetryFetchSettings({}), variant: 'secondary' }, 'Retry', h),
    ],
  )

export const settingsPage = (model: Model, h: HtmlBuilder<Msg>): Child => {
  if (model.settingsStatus === 'error') return failed(h)
  // The form is withheld until the row is in hand. Drawing the controls over the
  // column defaults would invite a save that overwrites a row nobody read.
  if (model.settings === undefined) return notLoaded(h)
  return h.div(
    [h.Class('flex flex-col gap-(--spacing-xl) pt-(--spacing-2xl)')],
    [
      exportDefaults(model, h),
      watermark(model, h),
      metadata(model, h),
      storage(model, h),
      site(model, h),
      actions(model, h),
    ],
  )
}
