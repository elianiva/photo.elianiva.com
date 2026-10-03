/**
 * Admin pages, one per route. The shell — sidebar, Page Head, overlays, toast
 * stack — lives in `view.ts` and every page renders inside it. Each arm below
 * is its own view function, and the view-identity transform brands each one, so
 * navigating between routes tears the old page down and builds the new one
 * rather than patching one into the other.
 */

import type { HtmlBuilder } from 'foldkit/html'
import type { PhotoWithTags } from '@photo/shared'

import * as Badge from '@/components/ui/badge'
import * as Button from '@/components/ui/button'
import * as DropZone from '@/components/ui/drop-zone'
import * as FileDrop from '@/components/ui/file-drop'
import * as SpecRow from '@/components/ui/spec-row'
import { originalUrl } from '@/lib/image'

import { atomsPage } from './atoms'
import { libraryFilterBar } from './filter-bar'
import { grid } from './grid'
import { libraryTable } from './library-table'
import { libraryIsEmpty } from './library-states'
import { settingsPage } from './settings'
import { Message as M, UPLOAD_ACCEPT, UPLOAD_CONSTRAINTS } from '../model'
import type { Model, Msg } from '../model'
import { AppRoute, libraryUrl, libraryViewOf } from '../route'
import type { Child } from './shared'
import { formatTakenAt } from './shared'

/** Plain anchor back to the Photo list — the runtime intercepts it, so there
 *  is no click handler here. */
const backToLibrary = (label: string, h: HtmlBuilder<Msg>): Child =>
  h.a(
    [
      h.Href(libraryUrl()),
      h.Class(
        'type-ui inline-flex items-center gap-1 text-role-text-secondary transition-colors duration-120 hover:text-role-text-primary',
      ),
    ],
    [label],
  )

// ---------------------------------------------------------------------------
// the Library page
// ---------------------------------------------------------------------------

const libraryPage = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const view = libraryViewOf(model.route)
  return h.div(
    [],
    [
      // One Library read, two views. The Filter Bar's `VIEW` group is the
      // toggle and its `DENSITY` group is drawn only when the grid is, so
      // every control over the list is in the bar rather than beside it.
      libraryFilterBar(model, h),
      // The design's Drop Zone strip sits between the Filter Bar and the rows,
      // and over any Library that holds a Photograph: the zero-Photograph state
      // has its own pickers (`library-empty.ts`), so a second drop target there
      // would be the same affordance twice. It is the Library's strip and not
      // the page's, so a filter that hides every row hides the rows only — an
      // operator who has narrowed the list to nothing can still drop the
      // photographs they came to upload. Copy is JPEG-only (decision 6).
      ...(libraryIsEmpty(model)
        ? []
        : [
            h.submodel({
              slotId: 'admin-library-file-drop',
              model: model.fileDrop,
              view: FileDrop.view,
              viewInputs: DropZone.dropZone(
                {
                  message: 'Drop photographs to upload',
                  constraints: UPLOAD_CONSTRAINTS,
                  multiple: true,
                  accept: UPLOAD_ACCEPT,
                  className: 'mt-6',
                },
                h,
              ),
              toParentMessage: (message) => M.GotFileDropMessage({ message }),
            }),
          ]),
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
      [h.Class('mt-12 flex flex-col items-start gap-4')],
      [
        backToLibrary('← Library', h),
        model.photoStatus === 'error'
          ? h.div(
              [
                h.Class(
                  'border border-role-accent bg-role-error-container p-4 type-ui text-role-error',
                ),
              ],
              [
                h.p([], ['That photograph could not be loaded.']),
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
    [h.Class('mt-8 flex flex-col gap-6')],
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

/** `Scheduled` says what is actually true of it rather than calling itself
 *  empty: nothing is scheduled, because nothing records a publish time
 *  (CONTEXT.md, Status). */
const scheduledPage = (h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('mt-8 flex flex-col items-start gap-4')],
    [
      h.p(
        [h.Class('type-deck max-w-prose text-role-text-secondary')],
        [
          'Nothing is scheduled. A scheduled photograph is a draft with a publish time, and none of the drafts has one yet.',
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
    [h.Class('mt-8 flex flex-col items-start gap-4')],
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
    Scheduled: () => scheduledPage(h),
    Settings: () => settingsPage(model, h),
    Photo: () => photoPage(model, h),
    NotFound: ({ path }) => notFoundPage(path, h),
  })
