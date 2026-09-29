/**
 * Admin pages, one per route. The shell — header, overlays, toast stack —
 * lives in `view.ts` and every page renders inside it. Each arm below is its
 * own view function, and the view-identity transform brands each one, so
 * navigating between routes tears the old page down and builds the new one
 * rather than patching one into the other.
 */

import type { HtmlBuilder } from 'foldkit/html'
import type { PhotoWithTags, Tag } from '@photo/shared'

import * as Badge from '@/components/ui/badge'
import * as Button from '@/components/ui/button'
import * as SpecRow from '@/components/ui/spec-row'
import { originalUrl } from '@/lib/image'

import { atomsPage } from './atoms'
import { grid } from './grid'
import { Message as M } from '../model'
import type { Model, Msg } from '../model'
import { AppRoute, libraryRouter } from '../route'
import * as TagManager from '../tag-manager'
import type { Child } from './shared'
import { formatTakenAt } from './shared'

/** Plain anchor back to the Photo list — the runtime intercepts it, so there
 *  is no click handler here. */
const backToLibrary = (label: string, h: HtmlBuilder<Msg>): Child =>
  h.a(
    [
      h.Href(libraryRouter()),
      h.Class(
        'type-ui inline-flex items-center gap-1 text-role-text-secondary transition-colors duration-(--motion-duration-fast) hover:text-role-text-primary',
      ),
    ],
    [label],
  )

// ---------------------------------------------------------------------------
// filter bar: TagManager submodel (chips with counts + inline create +
// result line). No "All photos" pill — an empty chip selection *is* all
// photos; the count line states it.
// ---------------------------------------------------------------------------

const filterBar = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const activeLabel = model.tags.find((tag) => tag.slug === model.activeTagSlug)?.label
  return h.submodel({
    slotId: 'admin-tag-manager',
    model: model.tagManager,
    view: TagManager.view,
    viewInputs: {
      tags: model.tags,
      // Counts describe the loaded result set, so they only mean something
      // unfiltered — a filtered list would repeat the same count on every chip.
      ...(model.activeTagSlug === undefined
        ? {
            countFor: (tag: Tag): number =>
              model.photos.filter((photo) =>
                (photo.tags ?? []).some((entry) => entry.id === tag.id),
              ).length,
          }
        : { activeSlug: model.activeTagSlug }),
      resultText: `${String(model.photos.length)} photo${model.photos.length === 1 ? '' : 's'}${
        activeLabel !== undefined ? ` · filtered by “${activeLabel}”` : ''
      }`,
    },
    toParentMessage: (message) => M.GotTagManagerMessage({ message }),
  })
}

const libraryPage = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [],
    [
      h.h1([h.Class('mt-(--spacing-2xl) type-section text-role-text-primary')], ['Photos']),
      filterBar(model, h),
      grid(model, h),
    ],
  )

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
        backToLibrary('← Photos', h),
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
                  {
                    onClick: M.RetryFetchPhoto(),
                    variant: 'secondary',
                    className: 'mt-3',
                  },
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
          backToLibrary('← Photos', h),
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
/** `/admin/drafts` and `/admin/settings` are routes before they are pages.
 *  Both pages need domain work this branch does not have — a draft filter on
 *  the RPC surface, a settings singleton to read — so until they land the URL
 *  resolves, the route is right, and the page says it has nothing yet rather
 *  than pretending to. */
const forthcomingPage = (title: string, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('mt-(--spacing-2xl) flex flex-col items-start gap-4')],
    [
      h.h1([h.Class('type-section text-role-text-primary')], [title]),
      h.p(
        [h.Class('type-deck max-w-prose text-role-text-secondary')],
        ['This page is still being built.'],
      ),
      backToLibrary('← Photos', h),
    ],
  )

// ---------------------------------------------------------------------------
// NotFound
// ---------------------------------------------------------------------------

const notFoundPage = (path: string, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('mt-(--spacing-2xl) flex flex-col items-start gap-4')],
    [
      h.h1([h.Class('type-section text-role-text-primary')], ['Not found']),
      h.p(
        [h.Class('type-deck max-w-prose text-role-text-secondary')],
        [`Nothing in the Admin answers to “${path}”.`],
      ),
      backToLibrary('← Photos', h),
    ],
  )

// ---------------------------------------------------------------------------
// route switch
// ---------------------------------------------------------------------------

export const routePage = (model: Model, h: HtmlBuilder<Msg>): Child =>
  AppRoute.match(model.route, {
    Library: () => libraryPage(model, h),
    Atoms: () => atomsPage(model, h),
    Drafts: () => forthcomingPage('Drafts', h),
    Settings: () => forthcomingPage('Settings', h),
    Photo: () => photoPage(model, h),
    NotFound: ({ path }) => notFoundPage(path, h),
  })
