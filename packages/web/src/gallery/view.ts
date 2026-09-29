/**
 * Gallery view root — the public showcase. Editorial system: newsprint paper,
 * black ink, one display serif (Newsreader) over Libre Franklin, hairline rules
 * as the only structure, and no chrome competing with the photographs.
 * Region views live in `views/`.
 */

import { DateTime } from 'effect'
import type { Document, HtmlBuilder } from 'foldkit/html'

import { Message } from './model'
import type { Model } from './model'
import { grid, yearSpan } from './views/grid'
import { lightbox } from './views/lightbox'
import type { Child } from './views/shared'

// ---------------------------------------------------------------------------
// layout tokens
// ---------------------------------------------------------------------------

/** Shared page gutter: the design system's content column and page margins. */
const GUTTER =
  'mx-auto w-full max-w-(--layout-content-max) px-(--layout-margin-mobile) sm:px-(--layout-margin)'

/** Shared cursor feedback timing, from `motion.duration.fast`. */
const TRANSITION = 'transition-colors duration-(--motion-duration-fast)'

/** Current year via the effect DateTime module (lint rule). */
const currentYear = (): number => DateTime.toPartsUtc(DateTime.nowUnsafe()).year

// ---------------------------------------------------------------------------
// regions
// ---------------------------------------------------------------------------

const masthead = (h: HtmlBuilder<Message>): Child =>
  h.header(
    [
      h.Class(
        `${GUTTER} pt-(--spacing-3xl) lg:pt-(--spacing-4xl) flex items-baseline justify-between`,
      ),
    ],
    [
      h.a(
        [
          h.Href('/'),
          h.Class(
            `type-kicker text-role-text-primary hover:text-role-text-secondary ${TRANSITION}`,
          ),
        ],
        ['Elianiva'],
      ),
      h.span([h.Class('type-kicker text-role-text-disabled')], ['Photographs']),
    ],
  )

const hero = (model: Model, h: HtmlBuilder<Message>): Child => {
  const span = yearSpan(model.photos)
  return h.section(
    [
      h.Class(
        `${GUTTER} pt-(--spacing-4xl) pb-(--spacing-5xl) lg:pt-(--spacing-5xl) lg:pb-(--spacing-6xl)`,
      ),
    ],
    [
      h.h1(
        [
          h.Class(
            'type-nameplate-xs sm:type-nameplate-sm lg:type-nameplate text-role-text-primary',
          ),
        ],
        ['Photographs'],
      ),
      h.p(
        [h.Class('mt-(--spacing-xl) lg:mt-(--spacing-2xl) type-kicker text-role-text-disabled')],
        [span === '' ? 'Selected works' : `Selected works · ${span}`],
      ),
    ],
  )
}

const footer = (h: HtmlBuilder<Message>): Child =>
  h.footer(
    [
      h.Class(
        `${GUTTER} mt-(--spacing-2xl) border-t border-role-hairline py-(--spacing-3xl) flex items-baseline justify-between`,
      ),
    ],
    [
      h.span(
        [h.Class('type-kicker text-role-text-disabled')],
        [`© ${String(currentYear())} Elianiva`],
      ),
      h.span([h.Class('type-caption italic text-role-text-disabled')], ['All photographs.']),
    ],
  )

// ---------------------------------------------------------------------------
// document
// ---------------------------------------------------------------------------

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const selected =
    model.selectedId !== null
      ? model.photos.find((photo) => photo.id === model.selectedId)
      : undefined
  return {
    title: 'Photographs — elianiva',
    body: h.div(
      [h.Class('min-h-screen bg-role-surface text-role-text-primary')],
      [
        masthead(h),
        hero(model, h),
        h.main([h.Class(GUTTER)], [grid(model, h)]),
        footer(h),
        ...(selected !== undefined ? [lightbox(selected, h)] : []),
      ],
    ),
  }
}
