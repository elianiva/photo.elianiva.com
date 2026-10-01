/**
 * Sidebar — the Admin's navigation column (master `e4b0b09450e7d630`).
 * 248px, pinned to the start of the shell and as tall as the viewport, on
 * `color.surface.container` behind a 1px `color.hairline` rule.
 *
 * Four bands, top to bottom: the brand, the primary nav, the `TAGS` group, and
 * the footer. Every band is closed by a hairline, because a hairline is the
 * broadsheet's one structural device and four bands of the same grey text with
 * nothing between them read as one long list of eight rows rather than as a
 * masthead, a nav, an index and a footer. The primary nav's counts come from
 * `GetCounts`; the TAGS group's and the footer's meter are the same read, so a
 * tag cannot show one number in the sidebar and another on the Library bar. The
 * footer's email is the verified Access claim, not a constant.
 *
 * A row is a link when it navigates and a button when it acts in place, which
 * is the whole of the `Sidebar Item` atom's two shapes. Every primary-nav row
 * is a link with a real `href` out of the route table, so a cold load of that
 * URL boots the Admin on the row the operator last looked at.
 *
 * The `TAGS` group is the rail's only band that grows, so it is the band that
 * scrolls: the rail is exactly as tall as the viewport, and a twentieth Tag
 * must not push the meter and the way out of the Admin off the bottom of it.
 */

import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Tag } from '@photo/shared'
import { ArrowUpRight, Clock, Images, LogOut, MoreHorizontal, NotebookPen, Settings } from 'lucide'
import type { IconNode } from 'lucide'

import * as Dialog from '@/components/ui/dialog'
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
const SIDEBAR_WIDTH = 'w-[248px]'
const SIDEBAR_PADDING = 'py-6 pr-3 pl-3'

/** The rail's action gutter: the 24px column at every row's trailing edge that
 *  holds a Tag's `⋯`. It is drawn on every row whether or not the row fills it,
 *  so the counts in both groups end on one edge — a nav count and a Tag count
 *  are the same kind of number, and two right edges for them is two numbers
 *  that cannot be read down. */
const ROW_GUTTER = 'w-6 shrink-0'

/** One row of the rail: the item, then the action gutter. The gutter is a
 *  sibling of the item rather than a child of it, because a Tag row is a
 *  `<button>` and its `⋯` is a `<button>`, and a button inside a button is not
 *  markup. It also means the `⋯` sits outside the selected row's own box, which
 *  is where an action on a row belongs. */
const railRow = (item: Html, gutter: Html | undefined, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('flex items-center')],
    [
      h.div([h.Class('min-w-0 flex-1')], [item]),
      h.div([h.Class(`flex justify-end ${ROW_GUTTER}`)], gutter === undefined ? [] : [gutter]),
    ],
  )

// ---------------------------------------------------------------------------
// brand
// ---------------------------------------------------------------------------

/** The rail's masthead. `Elianiva` over `THE DESK`, closed by the rule that
 *  separates it from the nav: without it the wordmark and the first nav row sat
 *  on the same grey with nothing to say one was the rail's name and the other
 *  was a destination. */
const brand = (h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('flex shrink-0 flex-col gap-1 border-b border-role-hairline pb-4')],
    [
      // The design's wordmark. `THE DESK` is display copy for this one place —
      // it is not a route, a type, or a directory (CONTEXT.md).
      h.span([h.Class('type-nameplate-xs leading-none text-role-text-primary')], ['Elianiva']),
      h.span([h.Class('type-kicker text-role-text-secondary')], ['THE DESK']),
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
    [h.Class('flex flex-col gap-2')],
    [
      h.div(
        [h.Class('flex items-baseline justify-between gap-2')],
        [
          h.span([h.Class('type-kicker text-role-text-secondary')], ['Library']),
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
        [h.AriaHidden(true), h.Class('h-0.5 w-full overflow-hidden bg-role-hairline')],
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

/** One primary-nav row, inside the rail's shared action gutter. The gutter is
 *  empty here — a nav row's action is the navigation itself — but it is drawn,
 *  because the Tag rows below put their `⋯` in the same column and a count that
 *  ends on one edge in one group and another edge in the next cannot be read
 *  down. */
const navRow = (model: Model, row: NavRow, h: HtmlBuilder<Msg>): Child =>
  railRow(
    SidebarItem.sidebarItem(
      {
        label: row.label,
        href: appRouteToUrl(row.route),
        state: model.route._tag === row.route._tag ? 'active' : 'default',
        icon: row.glyph,
        ...(row.count === undefined ? {} : { count: row.count }),
      },
      h,
    ),
    undefined,
    h,
  )

/** The rows, in the design's order. Two of them report no count at all, and
 *  both for the honest reason `CONTEXT.md` already states: `Scheduled` is a
 *  display label over a draft with no publish time recorded, so there is no
 *  Scheduled Photo to count, and `Settings` is a singleton with no rows.
 *
 *  Every row carries a glyph. The design leaves `Settings` without one and
 *  reserves the slot, so the labels line up either way — but a rail of four
 *  destinations where three are marked and one is not reads as a glyph that
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
    {
      route: AppRoute.Drafts(),
      label: 'Drafts',
      glyph: NotebookPen,
      count: String(model.counts.byStatus.draft),
    },
    { route: AppRoute.Scheduled(), label: 'Scheduled', glyph: Clock },
    { route: AppRoute.Settings(), label: 'Settings', glyph: Settings },
  ]
  return h.nav(
    [
      h.AriaLabel('Admin sections'),
      h.DataAttribute('slot', 'sidebar-nav'),
      h.Class('flex shrink-0 flex-col border-b border-role-hairline pt-3 pb-3'),
    ],
    rows.map((row) => navRow(model, row, h)),
  )
}

// ---------------------------------------------------------------------------
// tags group
// ---------------------------------------------------------------------------

const tagCountFor = (model: Model, tag: Tag): number =>
  model.counts.byTag.find((entry) => entry.id === tag.id)?.count ?? 0

/** The `⋯` affordance on one tag row. It carries no label of its own — the
 *  row's label is already in the row — so it is named for the Tag it acts on,
 *  which is what a screen reader needs to say out loud. It fills the row's
 *  action gutter: 24px of 4px padding around a 16px glyph. */
const tagActionsButton = (tag: Tag, h: HtmlBuilder<Msg>): Html =>
  h.button(
    [
      h.OnClick(M.OpenedTagActions({ id: tag.id })),
      h.AriaLabel(`Tag actions for ${tag.label}`),
      h.Title(`Tag actions for “${tag.label}”`),
      h.Class(
        'hover:bg-role-surface-hover focus-visible:ring-role-focus/50 shrink-0 p-1 text-role-text-disabled transition-colors duration-120 hover:text-role-text-primary focus-visible:outline-none focus-visible:ring-[3px]',
      ),
      h.DataAttribute('slot', 'tag-actions'),
    ],
    [icon(h, MoreHorizontal, 'size-4')],
  )

/** One Tag in the index. The `⋯` is passed as the row's gutter rather than
 *  drawn inside it, so the row stays one button whose whole width toggles the
 *  filter. */
const tagRow = (model: Model, tag: Tag, h: HtmlBuilder<Msg>): Child => {
  const selected = model.activeTagIds.includes(tag.id)
  return h.div(
    [h.Key(`tag-${tag.id}`)],
    [
      railRow(
        SidebarItem.sidebarItem(
          {
            label: tag.label,
            state: selected ? 'active' : 'default',
            onClick: M.ToggledTagFilter({ id: tag.id }),
            count: String(tagCountFor(model, tag)),
            attributes: [h.AriaPressed(String(selected))],
          },
          h,
        ),
        tagActionsButton(tag, h),
        h,
      ),
    ],
  )
}

/** The index of Tags. It is the rail's one band that grows, so it is the band
 *  that scrolls: the list takes whatever height is left over and scrolls inside
 *  it, rather than growing the rail past the viewport and carrying the storage
 *  meter and the sign-out link off the bottom with it. */
const tagsGroup = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('flex min-h-0 flex-1 flex-col pt-3 pb-4'), h.DataAttribute('slot', 'sidebar-tags')],
    [
      h.h2([h.Class('type-kicker shrink-0 pb-2 text-role-text-secondary')], ['Tags']),
      ...(model.tags.length === 0
        ? [h.p([h.Class('px-2 type-exif-sm text-role-text-disabled')], ['No tags yet.'])]
        : [
            h.div(
              [h.Class('flex min-h-0 flex-1 flex-col overflow-y-auto')],
              model.tags.map((tag) => tagRow(model, tag, h)),
            ),
          ]),
    ],
  )

// ---------------------------------------------------------------------------
// the per-tag actions Dialog
// ---------------------------------------------------------------------------

/** The design's `⋯` menu, as a Dialog. The Desk has no Menu atom — #23 drew
 *  the atom set and a menu is not in it — and a two-action sheet is the
 *  smallest container that is keyboard- and screen-reader-complete. Delete
 *  still routes through the shared confirm Dialog, so the destructive path is
 *  the same one every other delete takes. */
export const tagActionsDialog = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const tag = model.tags.find((candidate) => candidate.id === model.tagActionsId)
  return h.submodel({
    slotId: 'admin-tag-actions',
    model: model.tagActions,
    view: Dialog.view,
    viewInputs: Dialog.styledViewInputs<Msg>(
      {
        panelClass: 'w-full max-w-sm',
        content: (render, innerH) => [
          h.div(
            [h.Class('flex flex-col gap-4')],
            [
              h.div(
                [h.Class('flex items-start justify-between gap-2')],
                [
                  Dialog.title(
                    { attributes: render.title },
                    [tag === undefined ? 'Tag' : `Tag · ${tag.label}`],
                    innerH,
                  ),
                  Dialog.closeButton({ attributes: render.closeButton }, ['×'], innerH),
                ],
              ),
              h.form(
                [
                  h.OnSubmit(M.SubmitTagCreate()),
                  h.DataAttribute('slot', 'tag-create-form'),
                  h.Class('flex flex-col gap-2'),
                ],
                [
                  h.label(
                    [h.Class('type-kicker text-role-text-secondary'), h.For('admin-tag-create')],
                    ['New tag'],
                  ),
                  h.input([
                    h.Id('admin-tag-create'),
                    h.Value(model.tagActionLabel),
                    h.OnInput((value) => M.SetTagActionLabel({ value })),
                    h.Placeholder('New tag…'),
                    h.Class(
                      'h-9 border-0 border-b border-role-outline bg-transparent type-exif placeholder:text-role-text-disabled focus:border-role-rule focus:outline-none',
                    ),
                  ]),
                  h.div(
                    [h.Class('flex justify-end')],
                    [
                      h.button(
                        [
                          h.Type('submit'),
                          h.AriaLabel('Create tag'),
                          h.Class(
                            'border border-role-rule px-4 py-2 type-ui text-role-text-primary transition-colors duration-120 hover:bg-role-surface-hover',
                          ),
                          h.DataAttribute('slot', 'button'),
                        ],
                        ['Create tag'],
                      ),
                    ],
                  ),
                ],
              ),
              h.div(
                [h.Class('border-role-hairline flex flex-col gap-2 border-t pt-4')],
                [
                  h.p(
                    [h.Class('type-caption text-role-text-secondary')],
                    [
                      tag === undefined
                        ? 'Open a tag’s actions to delete it.'
                        : `Deleting “${tag.label}” detaches it from every Photo. The Photos themselves are not deleted.`,
                    ],
                  ),
                  h.div(
                    [h.Class('flex justify-end')],
                    [
                      ...(tag === undefined
                        ? []
                        : [
                            h.button(
                              [
                                h.Type('button'),
                                h.OnClick(M.RequestDeleteTag({ id: tag.id, label: tag.label })),
                                h.AriaLabel(`Delete tag ${tag.label}`),
                                h.Class(
                                  'border border-role-accent px-4 py-2 type-ui text-role-accent transition-colors duration-120 hover:bg-role-accent hover:text-role-on-accent',
                                ),
                                h.DataAttribute('slot', 'button'),
                              ],
                              ['Delete tag'],
                            ),
                          ]),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      },
      h,
    ),
    toParentMessage: (message) => M.GotTagActionsMessage({ message }),
  })
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
      h.Class('flex shrink-0 flex-col gap-3 border-t border-role-hairline pt-4'),
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
            'inline-flex items-center gap-1.5 px-2 type-caption text-role-text-primary transition-colors duration-120 hover:text-role-text-secondary',
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
  // the brand, the Tag index and the meter below the nav are content no other
  // landmark contains. Without it every one of them is a node the document
  // cannot place.
  h.aside(
    [
      h.AriaLabel('Admin'),
      h.Class(
        `${SIDEBAR_WIDTH} ${SIDEBAR_PADDING} bg-role-surface-container sticky top-0 flex h-dvh shrink-0 flex-col border-r border-role-hairline`,
      ),
      h.DataAttribute('slot', 'sidebar'),
    ],
    [brand(h), primaryNav(model, h), tagsGroup(model, h), footer(model, h)],
  )
