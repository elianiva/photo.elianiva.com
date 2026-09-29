/**
 * Admin pages, one per route. The shell — sidebar, Page Head, overlays, toast
 * stack — lives in `view.ts` and every page renders inside it. Each arm below
 * is its own view function, and the view-identity transform brands each one, so
 * navigating between routes tears the old page down and builds the new one
 * rather than patching one into the other.
 */

import type { HtmlBuilder } from 'foldkit/html'
import type { PhotoWithTags, Tag } from '@photo/shared'
import { LayoutGrid, List } from 'lucide'

import * as Badge from '@/components/ui/badge'
import * as Button from '@/components/ui/button'
import { iconButton } from '@/components/ui/icon-button'
import * as SpecRow from '@/components/ui/spec-row'
import { originalUrl } from '@/lib/image'

import { atomsPage } from './atoms'
import { grid } from './grid'
import { libraryTable } from './library-table'
import { settingsPage } from './settings'
import { Message as M } from '../model'
import type { Model, Msg } from '../model'
import { AppRoute, libraryUrl, libraryViewOf } from '../route'
import type { LibraryView } from '../route'
import * as TagManager from '../tag-manager'
import type { Child } from './shared'
import { formatTakenAt } from './shared'

/** Plain anchor back to the Photo list — the runtime intercepts it, so there
 *  is no click handler here. */
const backToLibrary = (label: string, h: HtmlBuilder<Msg>): Child =>
  h.a(
    [
      h.Href(libraryUrl()),
      h.Class(
        'type-ui inline-flex items-center gap-1 text-role-text-secondary transition-colors duration-(--motion-duration-fast) hover:text-role-text-primary',
      ),
    ],
    [label],
  )

// ---------------------------------------------------------------------------
// filter bar: TagManager submodel (chips with counts + inline create +
// result line). No "All photos" pill — an empty chip selection *is* all
// photos; the count line states it. The sidebar's TAGS group is the same
// filter and the same counts; #26 replaces this bar with the design's own
// Filter Bar.
// ---------------------------------------------------------------------------

/** Counts come from `GetCounts`, so a chip and the sidebar row for the same
 *  Tag read from one number rather than two. */
const countForTag = (model: Model, tag: Tag): number =>
  model.counts.byTag.find((entry) => entry.id === tag.id)?.count ?? 0

/** The names of the applied filters, for the result line. */
const activeLabels = (model: Model): ReadonlyArray<string> =>
  model.tags.filter((tag) => model.activeTagIds.includes(tag.id)).map((tag) => tag.label)

const filterBar = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const labels = activeLabels(model)
  return h.submodel({
    slotId: 'admin-tag-manager',
    model: model.tagManager,
    view: TagManager.view,
    viewInputs: {
      tags: model.tags,
      countFor: (tag: Tag): number => countForTag(model, tag),
      ...(labels.length > 0 ? { activeIds: [...model.activeTagIds] } : {}),
      resultText: `${String(model.photos.length)} photo${model.photos.length === 1 ? '' : 's'}${
        labels.length > 0 ? ` · filtered by ${labels.map((label) => `“${label}”`).join(', ')}` : ''
      }`,
    },
    toParentMessage: (message) => M.GotTagManagerMessage({ message }),
  })
}

// ---------------------------------------------------------------------------
// the Library's view controls: a list/grid toggle and, in grid mode, the
// square-tile column count (2–6). Both are Library controls, so they live on
// the Library page rather than in the Page Head, which carries the title and
// the route's own actions. The view is route state — the URL's `view` — and
// the column count is a preference persisted on change.
// ---------------------------------------------------------------------------

const COL_CHOICES = [2, 3, 4, 5, 6] as const

/** The design's `Segment`: 28px of 4/12 padding, `$typography.exif`, no
 *  container box and no corner radius. The chosen step fills with
 *  `color.primary` and reads in `color.on-primary`. */
const colsToggle = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('flex items-center'), h.Role('group'), h.AriaLabel('Grid density')],
    COL_CHOICES.map((cols) =>
      h.button(
        [
          h.OnClick(M.SelectedCols({ cols })),
          h.AriaLabel(`${String(cols)} columns`),
          h.AriaPressed(String(cols === model.cols)),
          h.Class(
            cols === model.cols
              ? 'bg-role-primary px-(--spacing-md) py-(--spacing-xs) type-exif text-role-on-primary'
              : 'px-(--spacing-md) py-(--spacing-xs) type-exif text-role-text-secondary transition-colors duration-(--motion-duration-fast) hover:text-role-text-primary',
          ),
        ],
        [String(cols)],
      ),
    ),
  )

/** The design's `View` control: a `list` and a `squares-four` Icon Button, the
 *  current one filled and the other ghost. The grid toggle #26 places in the
 *  Filter Bar; the Filter Bar itself is #26's, so it sits in the Library's own
 *  control row for now. */
const viewToggle = (view: LibraryView, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Role('group'), h.AriaLabel('View'), h.Class('flex items-center gap-(--spacing-xs)')],
    (
      [
        { view: 'list', label: 'List view', glyph: List },
        { view: 'grid', label: 'Grid view', glyph: LayoutGrid },
      ] as const
    ).map((choice) =>
      iconButton(
        {
          onClick: M.SelectedView({ view: choice.view }),
          ariaLabel: choice.label,
          isPressed: view === choice.view,
          kind: view === choice.view ? 'filled' : 'ghost',
        },
        choice.glyph,
        h,
      ),
    ),
  )

const libraryPage = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const view = libraryViewOf(model.route)
  return h.div(
    [],
    [
      h.div(
        [
          h.Class(
            'mt-(--spacing-lg) flex flex-wrap items-center justify-between gap-(--spacing-lg)',
          ),
        ],
        [
          h.div([h.Class('flex items-center')], [view === 'grid' ? colsToggle(model, h) : '']),
          viewToggle(view, h),
        ],
      ),
      filterBar(model, h),
      // One Library read, two views. The tile grid and the table are the only
      // two ways to see the rows; there is no third path (no lightbox, no
      // Sheet).
      view === 'grid' ? grid(model, h) : libraryTable(model, h),
    ],
  )
}

// ---------------------------------------------------------------------------
// Photo — `/admin/photos/<id>`
// ---------------------------------------------------------------------------

const photoFacts = (photo: PhotoWithTags): ReadonlyArray<string> =>
  [
    formatTakenAt(photo.takenAt),
    `${String(photo.width)} × ${String(photo.height)}`,
    ...(photo.tags ?? []).map((tag) => tag.label),
  ].filter((fact) => fact !== '')

const photoPage = (model: Model, h: HtmlBuilder<Msg>): Child => {
  if (model.photoStatus !== 'ready' || model.photo === undefined) {
    return h.div(
      [h.Class('mt-(--spacing-3xl) flex flex-col items-start gap-4')],
      [
        backToLibrary('← Library', h),
        model.photoStatus === 'error'
          ? h.div(
              [
                h.Class(
                  'border border-role-accent bg-role-error-container p-(--spacing-lg) type-ui text-role-error',
                ),
              ],
              [
                h.p([], ['That Photo could not be loaded.']),
                Button.button(
                  { onClick: M.RetryFetchPhoto(), variant: 'secondary', className: 'mt-3' },
                  'Retry',
                  h,
                ),
              ],
            )
          : h.p([h.Class('type-exif text-role-text-secondary animate-pulse')], ['Loading photo…']),
      ],
    )
  }
  const photo = model.photo
  const meta = photo.metadata ?? {}
  const facts = photoFacts(photo)
  return h.div(
    [h.Class('mt-(--spacing-2xl) flex flex-col gap-(--spacing-xl)')],
    [
      h.div(
        [h.Class('flex flex-wrap items-center justify-between gap-3')],
        [
          backToLibrary('← Library', h),
          ...(facts.length > 0
            ? [h.span([h.Class('type-exif text-role-text-secondary')], [facts.join(' · ')])]
            : []),
        ],
      ),
      h.h1([h.Class('type-headline text-role-text-primary')], [photo.title]),
      h.figure(
        [h.Class('m-0')],
        [
          h.img([
            h.Class('max-h-[70vh] w-full bg-role-surface-container object-contain'),
            h.Src(originalUrl(photo)),
            h.Alt(photo.title),
            h.Attribute('decoding', 'async'),
          ]),
        ],
      ),
      ...(meta.caption !== undefined
        ? [h.p([h.Class('type-deck max-w-prose text-role-text-primary')], [meta.caption])]
        : []),
      ...(meta.location !== undefined || meta.camera !== undefined || meta.lens !== undefined
        ? [
            h.dl(
              [h.Class('flex flex-col')],
              [
                ...(meta.location !== undefined
                  ? [SpecRow.specRow({ label: 'Where', value: meta.location }, h)]
                  : []),
                ...(meta.camera !== undefined
                  ? [SpecRow.specRow({ label: 'Camera', value: meta.camera }, h)]
                  : []),
                ...(meta.lens !== undefined
                  ? [SpecRow.specRow({ label: 'Lens', value: meta.lens }, h)]
                  : []),
              ],
            ),
          ]
        : []),
      ...((photo.tags ?? []).length > 0
        ? [
            h.div(
              [h.Class('flex flex-wrap gap-1')],
              (photo.tags ?? []).map((tag) =>
                Badge.badge({ variant: 'secondary' }, [tag.label], h),
              ),
            ),
          ]
        : []),
    ],
  )
}

// ---------------------------------------------------------------------------
// routes whose pages are still being built
// ---------------------------------------------------------------------------
/** `Drafts`, `Uploads` and `Trash` are routes before they are pages. Each URL
 *  resolves, the route is right, and the Page Head above it names the page —
 *  but the body says what is actually true of it rather than pretending to.
 *  #29 and #36 own the bodies. */
const forthcomingPage = (note: string, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('mt-(--spacing-2xl) flex flex-col items-start gap-4')],
    [
      h.p([h.Class('type-deck max-w-prose text-role-text-secondary')], [note]),
      backToLibrary('← Library', h),
    ],
  )

/** `Scheduled` says what is actually true of it rather than calling itself
 *  empty: nothing is scheduled, because nothing records a publish time
 *  (CONTEXT.md, Status). */
const scheduledPage = (h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('mt-(--spacing-2xl) flex flex-col items-start gap-4')],
    [
      h.p(
        [h.Class('type-deck max-w-prose text-role-text-secondary')],
        [
          'Nothing is scheduled. A scheduled Photo is a draft with a publish time, and no publish time is recorded yet — so there is no schedule to show and nothing is waiting to be published.',
        ],
      ),
      backToLibrary('← Library', h),
    ],
  )

// ---------------------------------------------------------------------------
// NotFound
// ---------------------------------------------------------------------------

const notFoundPage = (path: string, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('mt-(--spacing-2xl) flex flex-col items-start gap-4')],
    [
      h.p(
        [h.Class('type-deck max-w-prose text-role-text-secondary')],
        [`Nothing in the Admin answers to “${path}”.`],
      ),
      backToLibrary('← Library', h),
    ],
  )

// ---------------------------------------------------------------------------
// route switch
// ---------------------------------------------------------------------------

export const routePage = (model: Model, h: HtmlBuilder<Msg>): Child =>
  AppRoute.match(model.route, {
    Library: () => libraryPage(model, h),
    Atoms: () => atomsPage(model, h),
    Drafts: () =>
      forthcomingPage(
        'The drafts list is still being built. Everything not published is already counted in the sidebar.',
        h,
      ),
    Scheduled: () => scheduledPage(h),
    Uploads: () =>
      forthcomingPage(
        model.queue.length === 0
          ? 'Nothing is queued for upload. The upload dialog runs a batch from the Library; the Upload button opens it.'
          : `${String(model.queue.length)} item${model.queue.length === 1 ? '' : 's'} in this session’s upload queue. Reopen the upload dialog to retry anything that failed.`,
        h,
      ),
    Trash: () =>
      forthcomingPage(
        'The Trash is still being built. A deleted photo is recoverable and nothing is purged on a timer.',
        h,
      ),
    Settings: () => settingsPage(model, h),
    Photo: () => photoPage(model, h),
    NotFound: ({ path }) => notFoundPage(path, h),
  })
