/**
 * The Settings page — the form over the Admin's one row (master
 * `8b3ebe985801026f`). Four sections, each a kicker over its controls, each
 * closed by a hairline and separated by 24px, and the page's own `Save settings`
 * / `Discard changes` at the foot. Explicit save rather than autosave, because
 * the header's `SAVED 2 MINUTES AGO` has to mean something: the stamp is
 * `settings.updatedAt`, and a dirty form replaces it with `UNSAVED CHANGES`
 * rather than leaving a page that claims to be saved while it is not.
 *
 * What the page edits is what the photograph pipeline reads: the export
 * defaults, the watermark, the metadata policy and the retention setting. It
 * used to close with a `SITE` section — a motto, an about paragraph, a
 * copyright line and a nav repeater — whose four columns the public site never
 * read, because every line the Front prints is written in the view that prints
 * it. A control that edits copy nothing renders is not a setting (migration
 * 0008).
 *
 * One deviation from the canvas remains, deliberate and recorded in
 * `CONTEXT.md`: the section the design labels `ARCHIVE` renders as `STORAGE`.
 * The canvas contradicts itself — its own sidebar block is already called
 * `Storage` — and ADR 0006 split the collision.
 *
 * The block reads `GetStorageUsage`, the same payload the sidebar's meter reads,
 * so the frame count, the byte total and the cap cannot come to disagree.
 */

import { DateTime, Option } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'

import * as Button from '@/components/ui/button'
import * as Select from '@/components/ui/select'
import * as Slider from '@/components/ui/slider'
import * as Swatch from '@/components/ui/swatch'
import * as ToggleRow from '@/components/ui/toggle-row'
import { WATERMARK_POSITIONS } from '@photo/shared'
import type { WatermarkPosition } from '@photo/shared'

import { Message as M } from '../model'
import type { Model, Msg } from '../model'
import { PREVIEW_LONG_EDGES, settingsUnsaved } from '../settings-draft'
import { storageFigure } from '../storage-index'
import type { Child } from './shared'

/** The watermark's three colours, named the way the operator reads them. The
 *  same three the Editor's Border panel picks between (CONTEXT.md, Mat). */
const WATERMARK_COLOURS = [
  { colour: 'white', label: 'White' },
  { colour: 'paper', label: 'Paper' },
  { colour: 'ink', label: 'Ink' },
] as const

/** The four corners and the centre, in the order the Select lists them, named
 *  the way the design's `$typography.exif` prints them. The four corners are the
 *  value set in `@photo/shared`; the labels belong to this control. */
const WATERMARK_POSITION_LABELS: ReadonlyArray<{ value: WatermarkPosition; label: string }> = [
  { value: 'bottom-left', label: 'BOTTOM LEFT' },
  { value: 'bottom-right', label: 'BOTTOM RIGHT' },
  { value: 'top-left', label: 'TOP LEFT' },
  { value: 'top-right', label: 'TOP RIGHT' },
  { value: 'centre', label: 'CENTRE' },
]

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
          options: WATERMARK_POSITION_LABELS,
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
          'Nothing is purged on a timer. A deleted photograph keeps its original in R2 until it is purged.',
        ],
      ),
    ],
    h,
  )
}

const draftRetainValue = (model: Model): string =>
  model.settingsDraft.retainForever ? 'forever' : 'never'

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
      actions(model, h),
    ],
  )
}
