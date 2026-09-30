/**
 * Page Head — the title bar every route draws (master `8eef803483156676`).
 * A `$typography.headline` title hard left on the page's left edge, a 3px
 * `color.rule` rule under the whole bar, and the header's own actions on the
 * right: the search field with its shortcut keycap, and the primary Upload
 * button.
 *
 * The title and the actions are read off the route through one table
 * (`pageHeadOf`), never hard-coded per view, so a new route cannot ship a head
 * that disagrees with its own URL. The table is also the single place the
 * document title is derived from, so the browser tab and the page cannot name
 * the same page two ways.
 *
 * The in-flight upload readout sits here too. A batch keeps chaining after the
 * dialog closes, and this bar is the one place left to get back to it.
 */

import type { Document, HtmlBuilder } from 'foldkit/html'

import * as Button from '@/components/ui/button'
import * as Search from '@/components/ui/search'
import * as Spinner from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

import { Message as M } from '../model'
import type { Model, Msg } from '../model'
import { AppRoute } from '../route'
import { SEARCH_INPUT_ID, searchShortcutLabel } from '../subscriptions'
import { settingsStamp } from './settings'
import type { Child } from './shared'

export interface PageHead {
  /** The headline the bar prints. */
  readonly title: string
  /** Whether the bar carries the search field. Only routes whose page is a
   *  Photo list can answer a query, so only they get a field that does
   *  something — a search box on a page with no list is a control that lies. */
  readonly isSearchable: boolean
  /** Whether the bar carries the primary Upload button. */
  readonly isUploadable: boolean
  /** The stamp the bar prints beside the title, for the one route that has a
   *  form whose staleness is a thing the operator has to be told about. Absent
   *  on every other route, which has nothing to be stale against. */
  readonly stamp?: string
}

/** The head for a route. One table, read by the view and by the document title
 *  alike. `Atoms` is the design-system sheet and the Editor is #30's, so
 *  neither carries the Library's actions. Every arm is annotated: inferred from
 *  the first one, its booleans would narrow to that arm's literals and reject
 *  the rest. */
export const pageHeadOf = (model: Model): PageHead =>
  AppRoute.match(model.route, {
    Library: (): PageHead => ({ title: 'Library', isSearchable: true, isUploadable: true }),
    Drafts: (): PageHead => ({ title: 'Drafts', isSearchable: true, isUploadable: true }),
    Scheduled: (): PageHead => ({ title: 'Scheduled', isSearchable: true, isUploadable: true }),
    Settings: (): PageHead => ({
      title: 'Settings',
      isSearchable: false,
      // The design's Settings header carries the stamp and nothing else: no
      // search, and no Upload button over a page with no list to upload into.
      isUploadable: false,
      stamp: settingsStamp(model),
    }),
    Atoms: (): PageHead => ({ title: 'Atoms', isSearchable: false, isUploadable: false }),
    Photo: (): PageHead => ({
      title:
        model.photoStatus === 'ready' && model.photo !== undefined ? model.photo.title : 'Photo',
      isSearchable: false,
      isUploadable: false,
    }),
    NotFound: (): PageHead => ({ title: 'Not found', isSearchable: false, isUploadable: false }),
  })

/** The search field, inside a form so Enter submits and the browser wires the
 *  label for free. The keycap is the shortcut this document owns, and it is
 *  the one the `subscriptions` listener answers to. The form carries a slot so
 *  a submit can name it: the search form is the page's own. */
const searchField = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.form(
    [
      h.OnSubmit(M.SubmittedSearch()),
      h.AriaLabel('Search photos'),
      h.DataAttribute('slot', 'search-form'),
      h.Class('w-[260px]'),
    ],
    [
      Search.search(
        {
          id: SEARCH_INPUT_ID,
          value: model.searchQuery,
          onInput: (value) => M.SetSearchQuery({ value }),
          placeholder: 'Search photographs',
          hint: searchShortcutLabel(),
          ariaLabel: 'Search photographs',
        },
        h,
      ),
    ],
  )

const uploadAction = (model: Model, h: HtmlBuilder<Msg>): Child =>
  model.uploading
    ? Button.button(
        { onClick: M.OpenUpload(), variant: 'secondary' },
        h.span(
          [h.Class('inline-flex items-center gap-1.5')],
          [
            Spinner.spinner({ className: 'size-3' }, h),
            `Uploading ${String(model.queue.filter((item) => item.status === 'done' || item.status === 'processing').length)}/${String(model.batchTotal)}`,
          ],
        ),
        h,
      )
    : Button.button({ onClick: M.OpenUpload() }, 'Upload', h)

const headerActions = (head: PageHead, model: Model, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('flex items-center gap-(--spacing-lg)')],
    [
      ...(head.isSearchable ? [searchField(model, h)] : []),
      ...(head.isUploadable ? [uploadAction(model, h)] : []),
    ],
  )

/** The bar. `gutter` is passed in rather than imported so the bar and the page
 *  below it share one measure without either of them owning the other. */
export const pageHead = (model: Model, h: HtmlBuilder<Msg>, gutter: string): Child => {
  const head = pageHeadOf(model)
  return h.header(
    [
      h.DataAttribute('slot', 'page-head'),
      h.Class(cn(gutter, 'pb-(--spacing-lg) pt-(--spacing-2xl)')),
    ],
    [
      h.div(
        [
          h.Class(
            'flex flex-wrap items-end justify-between gap-x-(--spacing-lg) gap-y-(--spacing-sm)',
          ),
        ],
        [
          h.h1([h.Class('type-headline text-role-text-primary')], [head.title]),
          ...(head.stamp === undefined
            ? []
            : [
                h.span(
                  [
                    h.AriaLive('polite'),
                    h.Class('type-exif text-role-text-disabled'),
                    h.DataAttribute('slot', 'page-head-stamp'),
                  ],
                  [head.stamp],
                ),
              ]),
          headerActions(head, model, h),
        ],
      ),
      // The design's 3px `color.rule` under the whole bar, the only thick rule
      // on the Desk.
      h.div(
        [
          h.AriaHidden(true),
          h.Class('mt-(--spacing-lg) h-(--stroke-width-strong) w-full bg-role-rule'),
        ],
        [],
      ),
    ],
  )
}

/** The document title, from the same table the bar reads, so the tab and the
 *  page never name one route two ways. */
export const documentTitle = (model: Model): Document['title'] =>
  `${pageHeadOf(model).title} — Admin`
