/**
 * The Settings page — the form over the Admin's one row (master
 * `8b3ebe985801026f`). Four sections, each a label over its controls, each
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
 * read, because every line the home page prints is written in the view that prints
 * it. A control that edits copy nothing renders is not a setting (migration
 * 0008).
 *
 * One deviation from the canvas remains, deliberate and recorded in
 * `CONTEXT.md`: the section the design labels `ARCHIVE` renders as `STORAGE`.
 * The canvas contradicts itself — its own sidebar block is already called
 * `Storage` — and ADR 0006 split the collision.
 *
 * The block reads `GetCounts`, the same payload the sidebar's meter and the
 * nav's rows read, so the frame count, the Trash count and the Library's own
 * total cannot come to disagree.
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

const captionClass = 'type-caption italic text-role-text-secondary'

/** One section: the title and what it governs on the left, its controls on
 *  the right, a hairline between sections. Below `sm` the two stack. */
const section = (
  label: string,
  summary: string,
  rows: ReadonlyArray<Child>,
  h: HtmlBuilder<Msg>,
): Child =>
  h.section(
    [
      h.Class(
        'grid gap-x-12 gap-y-5 border-b border-role-hairline py-8 sm:grid-cols-[200px_minmax(0,1fr)]',
      ),
    ],
    [
      h.div(
        [h.Class('flex flex-col gap-2')],
        [
          h.h2([h.Class('type-label text-role-text-secondary')], [label]),
          h.p([h.Class(captionClass)], [summary]),
        ],
      ),
      h.div([h.Class('flex max-w-[560px] flex-col gap-6')], rows),
    ],
  )

/** Two controls side by side, so a short Select does not take a whole line. */
const pair = (children: ReadonlyArray<Child>, h: HtmlBuilder<Msg>): Child =>
  h.div([h.Class('grid gap-6 sm:grid-cols-2')], children)

/** Switches in one hairline box, each with the sentence that says what it does. */
const toggleGroup = (rows: ReadonlyArray<Child>, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('flex flex-col divide-y divide-role-hairline border border-role-hairline px-4')],
    rows,
  )

const toggle = (
  config: Readonly<{
    id: string
    label: string
    description: string
    isChecked: boolean
    onToggle: (isChecked: boolean) => Msg
  }>,
  h: HtmlBuilder<Msg>,
): Child => ToggleRow.toggleRow({ ...config, className: 'py-3' }, h)

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
    'What a new photograph is exported with, unless the Editor overrides it.',
    [
      pair(
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
        ],
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
  const isOn = draft.watermarkEnabled
  return section(
    'WATERMARK',
    // A contract, not a description of what ships today: nothing stamps a
    // watermark yet (that is E2), and this string is the promise it inherits.
    // If E2 ever bakes the mark into the original as well, this line and
    // `CONTEXT.md` change in the same commit.
    'Stamped on published renditions. Downloads always serve the unmarked original.',
    [
      toggleGroup(
        [
          toggle(
            {
              id: 'settings-watermark-enabled',
              label: 'Watermark new uploads',
              description: 'Off leaves every rendition unmarked.',
              isChecked: isOn,
              onToggle: (isChecked) => M.SetWatermarkEnabled({ isChecked }),
            },
            h,
          ),
        ],
        h,
      ),
      // The choices below only mean something while the mark is on, so they
      // stand down with it rather than staying live and inert.
      h.div(
        [
          h.Class(
            `flex flex-col gap-6 transition-opacity duration-120 ${isOn ? '' : 'pointer-events-none opacity-50'}`,
          ),
          ...(isOn ? [] : [h.AriaDisabled(true)]),
        ],
        [
          h.div(
            [h.Class('flex flex-col gap-2')],
            [
              h.span([h.Class('type-label text-role-text-secondary')], ['COLOUR']),
              h.div(
                [
                  h.Class('flex items-center gap-1'),
                  h.Role('group'),
                  h.AriaLabel('Watermark colour'),
                ],
                WATERMARK_COLOURS.flatMap((entry) => [
                  Swatch.swatch(
                    {
                      colour: entry.colour,
                      label: entry.label,
                      isSelected: draft.watermarkColour === entry.colour,
                      onSelect: M.SetWatermarkColour({ colour: entry.colour }),
                    },
                    h,
                  ),
                ]),
              ),
            ],
          ),
          Select.select(
            {
              id: 'settings-watermark-position',
              label: 'POSITION',
              value: draft.watermarkPosition,
              options: WATERMARK_POSITION_LABELS,
              isDisabled: !isOn,
              onChange: (raw) =>
                M.SetWatermarkPosition({
                  value: WATERMARK_POSITIONS.find((position) => position === raw) ?? 'bottom-right',
                }),
            },
            h,
          ),
        ],
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
    'What a published rendition carries from the original file.',
    [
      toggleGroup(
        [
          toggle(
            {
              id: 'settings-keep-exif',
              label: 'Keep EXIF data',
              description: 'Camera, lens and exposure details stay in the file.',
              isChecked: draft.defaultKeepExif,
              onToggle: (isChecked) => M.SetMetadataPolicy({ field: 'defaultKeepExif', isChecked }),
            },
            h,
          ),
          toggle(
            {
              id: 'settings-remove-gps',
              label: 'Remove GPS location',
              description: 'Strips where the photograph was taken.',
              isChecked: draft.defaultRemoveGps,
              onToggle: (isChecked) =>
                M.SetMetadataPolicy({ field: 'defaultRemoveGps', isChecked }),
            },
            h,
          ),
        ],
        h,
      ),
    ],
    h,
  )
}

// ---------------------------------------------------------------------------
// STORAGE
// ---------------------------------------------------------------------------

/** One figure and what it counts. Both numbers come from `GetCounts`, which
 *  counts rows — the design's `4.2 GB OF 20 GB` came from `SUM(bytes)`, a
 *  column only an upload writes, so it read `0.0 GB` for every Photograph older
 *  than the column. The Trash count is the half of this block that is new
 *  information: nothing else in the Admin lists the Trash, so this is the one
 *  place the operator can see that three photographs are waiting there. */
const stat = (value: number, label: string, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('flex flex-col gap-1')],
    [
      h.span([h.Class('type-headline tabular-nums text-role-text-primary')], [String(value)]),
      h.span([h.Class('type-label text-role-text-secondary')], [label]),
    ],
  )

const storage = (model: Model, h: HtmlBuilder<Msg>): Child =>
  section(
    'STORAGE',
    'What the Library holds, and a copy of it you can keep.',
    [
      h.div(
        [h.Class('flex gap-12')],
        [stat(model.counts.total, 'FRAMES', h), stat(model.counts.trashed, 'IN TRASH', h)],
      ),
      h.div(
        [h.Class('flex flex-col items-start gap-2')],
        [
          Button.button(
            {
              onClick: M.ExportCsvIndex({}),
              variant: 'secondary',
              isDisabled: model.settingsIndexing,
            },
            model.settingsIndexing ? 'Building the index…' : 'Export a CSV index',
            h,
          ),
          h.p([h.Class(captionClass)], ['One row per photograph, with its metadata.']),
        ],
      ),
      // Nothing purges on a timer anywhere in the chain, so retention is a
      // fact to read rather than a control: a Select with one option is a
      // setting for a purge that does not exist.
      h.div(
        [h.Class('flex flex-col gap-1')],
        [
          h.span([h.Class('type-label text-role-text-secondary')], ['RETENTION']),
          h.span([h.Class('type-exif text-role-text-primary')], ['FOREVER']),
          h.p(
            [h.Class(captionClass)],
            [
              'Nothing is purged on a timer. A deleted photograph keeps its original in R2 until a purge runs.',
            ],
          ),
        ],
      ),
    ],
    h,
  )

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
 *  from the row, in a bar that sticks to the foot of the viewport so a long
 *  form never hides them. The stamp rides with them: it is the answer to "did
 *  that save?", so it belongs next to the button that saves. */
const actions = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const unsaved = settingsUnsaved(model.settingsDraft, model.settings)
  return h.div(
    [
      h.Class(
        'sticky bottom-0 z-10 flex items-center justify-between gap-4 border-t border-role-hairline bg-role-surface py-4',
      ),
      h.DataAttribute('slot', 'settings-actions'),
    ],
    [
      h.span(
        [
          h.AriaLive('polite'),
          h.Class(`type-exif ${unsaved ? 'text-role-text-primary' : 'text-role-text-disabled'}`),
          h.DataAttribute('slot', 'page-head-stamp'),
        ],
        [settingsStamp(model)],
      ),
      h.div(
        [h.Class('flex items-center gap-2')],
        [
          Button.button(
            { onClick: M.DiscardSettings({}), variant: 'secondary', isDisabled: !unsaved },
            'Discard changes',
            h,
          ),
          Button.button(
            {
              onClick: M.SaveSettings({}),
              isDisabled: !unsaved || model.settingsSaving,
              className: 'whitespace-nowrap',
            },
            model.settingsSaving ? 'Saving…' : 'Save settings',
            h,
          ),
        ],
      ),
    ],
  )
}

const notLoaded = (h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('flex flex-col items-start gap-4 pt-6')],
    [h.p([h.Class('type-lead text-role-text-secondary')], ['Loading settings…'])],
  )

const failed = (h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('flex flex-col items-start gap-4 pt-6')],
    [
      h.p(
        [h.Class('type-lead text-role-text-secondary')],
        ['The settings could not be read, so there is nothing to show.'],
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
    [h.Class('flex flex-col pt-2')],
    [
      exportDefaults(model, h),
      watermark(model, h),
      metadata(model, h),
      storage(model, h),
      actions(model, h),
    ],
  )
}
