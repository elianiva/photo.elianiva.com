/**
 * Sidebar — the Admin's navigation column (master `e4b0b09450e7d630`).
 * 232px, pinned to the start of the shell and as tall as the viewport, on
 * `color.surface.sunken` — a step below the page, so the rail is told apart by
 * its ground rather than by a rule.
 *
 * Three bands, top to bottom: the brand, the primary nav, and the footer.
 * The footer is closed by a hairline and the brand and nav are
 * spaced apart, so three bands of the same grey text still read as a header, a
 * nav and a footer rather than one long list. The
 * primary nav's counts and the footer's meter are the same read, so the Library
 * total cannot show one number on the rail and another on the Library bar. The
 * footer's email is the verified Access claim, not a constant.
 *
 * A row is a link when it navigates and a button when it acts in place, which
 * is the whole of the `Sidebar Item` atom's two shapes. Every primary-nav row
 * is a link with a real `href` out of the route table, so a cold load of that
 * URL boots the Admin on the row the operator last looked at.
 *
 * There is no Tag index here. A Tag is picked where it is applied — the upload
 * dialog's combo and the Library's Bulk Bar — and a filter the operator cannot
 * see set is not a filter, so `?tag=` is not in the URL's vocabulary either.
 */

import type { HtmlBuilder } from 'foldkit/html'
import { ArrowUpRight, Clock, Images, LogOut, Moon, Settings, Sun } from 'lucide'
import type { IconNode } from 'lucide'

import * as SidebarItem from '@/components/ui/sidebar-item'
import { icon } from '@/lib/icons'

import { Message as M } from '../model'
import type { Model, Msg } from '../model'
import {
  AppRoute,
  appRouteToUrl,
  defaultLibraryFilters,
  libraryRoute,
  libraryViewOf,
} from '../route'
import type { AppRoute as AppRouteType } from '../route'
import type { Child } from './shared'

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

/** The design's 248px column, and the padding either side of the brand. */
const SIDEBAR_WIDTH = 'w-[232px]'
const SIDEBAR_PADDING = 'px-3 py-6'

// ---------------------------------------------------------------------------
// brand
// ---------------------------------------------------------------------------

/** The rail's header. `Elianiva` over `THE DESK`, closed by the rule that
 *  separates it from the nav: without it the wordmark and the first nav row sat
 *  on the same grey with nothing to say one was the rail's name and the other
 *  was a destination. */
const brand = (h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('flex shrink-0 flex-col gap-1.5 px-3 pb-6')],
    [
      // The design's wordmark. `THE DESK` is display copy for this one place —
      // it is not a route, a type, or a directory (CONTEXT.md).
      h.span([h.Class('type-wordmark-md leading-none text-role-text-primary')], ['Elianiva']),
      h.span([h.Class('type-label text-role-text-secondary')], ['THE DESK']),
    ],
  )

// ---------------------------------------------------------------------------
// library meter
// ---------------------------------------------------------------------------

/** The rail's one measurement: how much of the Library a visitor can see.
 *
 *  It replaces the design's `7.9 / 50 GB` bucket meter. That meter read
 *  `SUM(bytes)`, and `bytes` is written only by an upload — every Photograph
 *  older than the column reports zero, so the one number on the rail was wrong
 *  for the whole of the existing Library and would have stayed wrong. A cap of
 *  20 GiB that six photographs fill by 0.0% is a readout that cannot say
 *  anything for years. The Library's own composition is a fact `GetCounts`
 *  measures exactly, and it answers the question the operator actually has:
 *  is anything on this site not live? */
const libraryMeter = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const { total, byStatus } = model.counts
  // A total of zero is an empty Library, not a full one; dividing by it would
  // be NaN, and a NaN width would silently vanish.
  const livePercent = total > 0 ? Math.min(100, Math.max(0, (byStatus.published / total) * 100)) : 0
  return h.div(
    [h.Class('flex flex-col gap-2 px-3')],
    [
      h.div(
        [h.Class('flex items-baseline justify-between gap-2')],
        [
          h.span([h.Class('type-label text-role-text-secondary')], ['Library']),
          h.span(
            [h.Class('type-exif text-role-text-primary'), h.DataAttribute('slot', 'library-live')],
            [`${String(byStatus.published)} OF ${String(total)} LIVE`],
          ),
        ],
      ),
      // The design's 2px `color.hairline` track with the measured segment over
      // it. Hidden from assistive tech because the readout beside it already
      // says the same fraction in words.
      h.div(
        [h.AriaHidden(true), h.Class('h-0.5 w-full overflow-hidden bg-role-outline-variant')],
        [
          h.div(
            [
              h.Class('h-full bg-role-rule'),
              h.DataAttribute('slot', 'library-meter-live'),
              h.Style({ width: `${livePercent.toFixed(2)}%` }),
            ],
            [],
          ),
        ],
      ),
    ],
  )
}

// ---------------------------------------------------------------------------
// primary nav
// ---------------------------------------------------------------------------

/** One destination. `count` is the design's count slot, and the rows that have
 *  no count to report pass nothing — the atom reserves the slot rather than
 *  printing a zero that would read as a claim. */
interface NavRow {
  readonly route: AppRouteType
  readonly label: string
  readonly glyph: IconNode
  readonly count?: string
}

/** One primary-nav row. */
const navRow = (model: Model, row: NavRow, h: HtmlBuilder<Msg>): Child =>
  SidebarItem.sidebarItem(
    {
      label: row.label,
      href: appRouteToUrl(row.route),
      state: model.route._tag === row.route._tag ? 'active' : 'default',
      icon: row.glyph,
      ...(row.count === undefined ? {} : { count: row.count }),
    },
    h,
  )

/** The rows, in the design's order. Two of them report no count at all, and
 *  both for the honest reason `CONTEXT.md` already states: `Scheduled` is a
 *  display label over a draft with no publish time recorded, so there is no
 *  Scheduled Photo to count, and `Settings` is a singleton with no rows. A
 *  draft is a Status on the Filter Bar, not a page of its own, so there is no
 *  `Drafts` row here: the Library with `DRAFTS` selected is the drafts list.
 *
 *  Every row carries a glyph. The design leaves `Settings` without one and
 *  reserves the slot, so the labels line up either way — but a rail of three
 *  destinations where two are marked and one is not reads as a glyph that
 *  failed to load, not as a decision, so this is the one place the drawing is
 *  overruled. */
const primaryNav = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const rows: ReadonlyArray<NavRow> = [
    {
      route: libraryRoute({ ...defaultLibraryFilters, view: libraryViewOf(model.route) }),
      label: 'Library',
      glyph: Images,
      count: String(model.counts.total),
    },
    { route: AppRoute.Scheduled(), label: 'Scheduled', glyph: Clock },
    { route: AppRoute.Settings(), label: 'Settings', glyph: Settings },
  ]
  return h.nav(
    [
      h.AriaLabel('Admin sections'),
      h.DataAttribute('slot', 'sidebar-nav'),
      h.Class('flex shrink-0 flex-col gap-0.5'),
    ],
    rows.map((row) => navRow(model, row, h)),
  )
}

// ---------------------------------------------------------------------------
// footer
// ---------------------------------------------------------------------------

/** `https://<team>/cdn-cgi/access/logout`. The team domain is the one the gate
 *  verified the claim against, and the gate compares it to the token's `iss`,
 *  so the binding is the issuer itself and already carries its scheme — this
 *  only appends the endpoint. The row is not drawn at all where the team
 *  domain is blank, because on the `dev` stage there is no Access session to
 *  end and the link would go nowhere. */
const signOutUrl = (model: Model): string | undefined =>
  model.session.teamDomain === null
    ? undefined
    : `${model.session.teamDomain}/cdn-cgi/access/logout`

/** The rail's foot: who is signed in, how full the bucket is, the way out of
 *  the Admin and the way out of the Admin's document. Closed by a hairline
 *  above, which is the rule the storage meter used to draw for itself — one
 *  rule for the band instead of a rule that moved with whichever of the two
 *  lines above it happened to be present. */
const footer = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const signOut = signOutUrl(model)
  return h.div(
    [
      h.Class('mt-auto flex shrink-0 flex-col gap-3 border-t border-role-outline-variant pt-4'),
      h.DataAttribute('slot', 'sidebar-footer'),
    ],
    [
      // The verified claim, or nothing: a dev stage has no Access identity to
      // print, and a placeholder address would be a lie about who is signed in.
      ...(model.session.email === null
        ? []
        : [
            h.p(
              [
                h.Class('type-exif-sm truncate text-role-text-secondary'),
                h.Title(model.session.email),
              ],
              [model.session.email],
            ),
          ]),
      libraryMeter(model, h),
      SidebarItem.sidebarItem(
        {
          label: model.theme === 'dark' ? 'Light mode' : 'Dark mode',
          state: 'default',
          icon: model.theme === 'dark' ? Sun : Moon,
          onClick: M.ToggledTheme(),
        },
        h,
      ),
      ...(signOut === undefined
        ? []
        : [
            SidebarItem.sidebarItem(
              { label: 'Sign out', state: 'default', href: signOut, icon: LogOut },
              h,
            ),
          ]),
      h.a(
        [
          h.Href('/'),
          h.Class(
            'inline-flex items-center gap-1.5 px-3 type-caption text-role-text-primary transition-colors duration-120 hover:text-role-text-secondary',
          ),
          h.DataAttribute('slot', 'view-site'),
        ],
        ['View site', icon(h, ArrowUpRight, 'size-3 shrink-0')],
      ),
    ],
  )
}

// ---------------------------------------------------------------------------
// the column
// ---------------------------------------------------------------------------

export const sidebar = (model: Model, h: HtmlBuilder<Msg>): Child =>
  // `<aside>` rather than `<div>`: the rail is a complementary landmark, and
  // the brand and the meter below the nav are content no other landmark
  // contains. Without it every one of them is a node the document cannot place.
  h.aside(
    [
      h.AriaLabel('Admin'),
      h.Class(
        `${SIDEBAR_WIDTH} ${SIDEBAR_PADDING} bg-role-surface-sunken sticky top-0 flex h-dvh shrink-0 flex-col`,
      ),
      h.DataAttribute('slot', 'sidebar'),
    ],
    [brand(h), primaryNav(model, h), footer(model, h)],
  )
