/**
 * Admin view root: header (search + tag filter + Upload), tag filter pills,
 * and composition of the region views in `views/` (masonry grid, edit Sheet,
 * upload Dialog, confirm AlertDialog, toast stack).
 */

import type { Document, HtmlBuilder } from 'foldkit/html'

import * as Button from '@/components/ui/button'
import * as Input from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { Message as M } from './model'
import type { Model, Msg } from './model'
import { editSheet } from './views/edit-sheet'
import { grid } from './views/grid'
import { confirmDialog, toastStack } from './views/overlays'
import type { Child } from './views/shared'
import { uploadDialog } from './views/upload-dialog'

// ---------------------------------------------------------------------------
// header: search + tag filter pills + upload button
// ---------------------------------------------------------------------------

const header = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.header(
    [
      h.Class(
        'sticky top-0 z-20 border-b border-stone-200 bg-white/85 backdrop-blur px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-3',
      ),
    ],
    [
      h.div(
        [h.Class('flex items-center gap-4 mr-auto')],
        [
          h.a(
            [h.Href('/'), h.Class('text-sm font-semibold tracking-tight hover:text-stone-600')],
            ['photo.elianiva.com'],
          ),
          h.span([h.Class('text-xs uppercase tracking-widest text-stone-400')], ['Admin']),
        ],
      ),
      h.form(
        [h.OnSubmit(M.SubmitSearch()), h.Class('flex items-center gap-2')],
        [
          h.div(
            [h.Class('w-56')],
            [
              Input.input(
                {
                  id: 'admin-search',
                  label: '',
                  value: model.search,
                  placeholder: 'Search title…',
                  onInput: (value) => M.SetSearch({ value }),
                  wrapperClass: '!w-full',
                },
                h,
              ),
            ],
          ),
          Button.button({ onClick: M.SubmitSearch(), variant: 'outline', size: 'sm' }, 'Search', h),
        ],
      ),
      Button.button({ onClick: M.OpenUpload(), size: 'sm' }, 'Upload photos', h),
    ],
  )

const filterBar = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const active = model.activeTagSlug ?? ''
  const pill = (
    label: string,
    slug: string | undefined,
    isActive: boolean,
    onDelete?: Msg,
  ): Child =>
    h.span(
      [
        h.Key(`pill-${slug ?? 'all'}`),
        h.Class('inline-flex items-center overflow-hidden rounded-full border'),
      ],
      [
        h.button(
          [
            h.OnClick(M.FilterByTag(slug === undefined ? { slug: '' } : { slug })),
            h.Class(
              cn(
                'pl-3 pr-2 py-1 text-xs font-medium transition-colors',
                isActive ? 'bg-stone-900 text-white' : 'bg-white text-stone-700 hover:bg-stone-100',
                onDelete !== undefined && 'pr-1',
              ),
            ),
          ],
          [label],
        ),
        ...(onDelete !== undefined
          ? [
              h.button(
                [
                  h.OnClick(onDelete),
                  h.AriaLabel(`Delete tag ${label}`),
                  h.Class('pr-2.5 text-xs text-stone-400 hover:text-red-600'),
                ],
                ['×'],
              ),
            ]
          : []),
      ],
    )

  return h.div(
    [h.Class('flex flex-wrap items-center gap-2 mt-6')],
    [
      pill('All photos', undefined, active === ''),
      ...model.tags.map((tag) =>
        pill(
          tag.label,
          tag.slug,
          active === tag.slug,
          M.RequestDeleteTag({ id: tag.id, label: tag.label }),
        ),
      ),
    ],
  )
}

// ---------------------------------------------------------------------------
// document
// ---------------------------------------------------------------------------

export const view = (model: Model, h: HtmlBuilder<Msg>): Document => ({
  title: 'Admin — photo.elianiva.com',
  body: h.div(
    [h.Class('min-h-screen bg-stone-50 text-stone-900')],
    [
      header(model, h),
      h.main(
        [h.Class('mx-auto max-w-6xl px-6 pb-24')],
        [
          h.h1([h.Class('mt-8 text-2xl font-semibold tracking-tight')], ['Photos']),
          filterBar(model, h),
          grid(model, h),
        ],
      ),
      editSheet(model, h),
      uploadDialog(model, h),
      confirmDialog(model, h),
      toastStack(model, h),
    ],
  ),
})
