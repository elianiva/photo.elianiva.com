/**
 * Gallery view root — the public showcase. Editorial system: pure white
 * canvas, one display serif (Cormorant Garamond) over a quiet sans, hairline
 * rules as the only structure, and no chrome competing with the photographs.
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

/** Shared horizontal gutter so masthead, grid and footer align. */
const GUTTER = 'px-6 sm:px-12 lg:px-20'

/** Current year via the effect DateTime module (lint rule). */
const currentYear = (): number => DateTime.toPartsUtc(DateTime.nowUnsafe()).year

// ---------------------------------------------------------------------------
// regions
// ---------------------------------------------------------------------------

const masthead = (h: HtmlBuilder<Message>): Child =>
  h.header(
    [h.Class(`${GUTTER} pt-10 lg:pt-14 flex items-baseline justify-between`)],
    [
      h.a(
        [
          h.Href('/'),
          h.Class(
            'text-[11px] font-medium uppercase tracking-[0.4em] text-neutral-900 hover:text-neutral-500 transition-colors',
          ),
        ],
        ['Elianiva'],
      ),
      h.span([h.Class('text-[10px] uppercase tracking-[0.3em] text-neutral-400')], ['Photographs']),
    ],
  )

const hero = (model: Model, h: HtmlBuilder<Message>): Child => {
  const span = yearSpan(model.photos)
  return h.section(
    [h.Class(`${GUTTER} pt-16 pb-20 lg:pt-24 lg:pb-32`)],
    [
      h.h1(
        [
          h.Class(
            'font-serif font-light text-6xl sm:text-7xl lg:text-8xl leading-[1.02] tracking-tight text-neutral-900',
          ),
        ],
        ['Photographs'],
      ),
      h.p(
        [h.Class('mt-6 lg:mt-8 text-[10px] uppercase tracking-[0.35em] text-neutral-400')],
        [span === '' ? 'Selected works' : `Selected works · ${span}`],
      ),
    ],
  )
}

const footer = (h: HtmlBuilder<Message>): Child =>
  h.footer(
    [
      h.Class(
        `${GUTTER} mt-8 border-t border-neutral-200 py-10 flex items-baseline justify-between`,
      ),
    ],
    [
      h.span(
        [h.Class('text-[10px] uppercase tracking-[0.3em] text-neutral-400')],
        [`© ${String(currentYear())} Elianiva`],
      ),
      h.span(
        [h.Class('font-serif italic font-light text-sm text-neutral-300')],
        ['All photographs.'],
      ),
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
      [h.Class('min-h-screen bg-white text-neutral-900')],
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
