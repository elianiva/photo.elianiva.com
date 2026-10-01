/**
 * Sidebar — the Admin's navigation column (master `e4b0b09450e7d630`).
 * 248px, pinned to the start of the shell and as tall as the viewport, on
 * `color.surface.container` behind a 1px `color.hairline` rule.
 *
 * Four bands, top to bottom: the brand, the primary nav, the `TAGS` group, and
 * the footer. The primary nav's counts come from `GetCounts`; the TAGS group's
 * are the same read, so a tag cannot show one number in the sidebar and
 * another on the Library bar. The footer's email is the verified Access claim
 * and its meter is `GetStorageUsage` — neither is a constant.
 *
 * A row is a link when it navigates and a button when it acts in place, which
 * is the whole of the `Sidebar Item` atom's two shapes. Every primary-nav row
 * is a link with a real `href` out of the route table, so a cold load of that
 * URL boots the Admin on the row the operator last looked at.
 */

import type { HtmlBuilder } from 'foldkit/html'
import type { Tag } from '@photo/shared'
import { ArrowUpRight, Clock, Images, LogOut, MoreHorizontal, NotebookPen } from 'lucide'
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

// ---------------------------------------------------------------------------
// storage meter
// ---------------------------------------------------------------------------

const GB = 1e9

/** `7.9 / 50 GB` — the design's readout, in decimal gigabytes, with the unit on
 *  the cap only so the two numbers read as one fraction. */
const meterReadout = (bytes: number, capBytes: number): string =>
  `${(bytes / GB).toFixed(1)} / ${Math.round(capBytes / GB).toString()} GB`

/** The track is the design's 2px `color.hairline` bar; the `Used` segment is
 *  `color.rule` over it, and the `Free` segment the design draws invisibly is
 *  simply the rest of the track. The bar is hidden from assistive tech because
 *  the readout beside it already says the same fraction in words. */
const storageMeter = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const { bytes, capBytes } = model.storage
  // A cap of zero is an aggregate that could not be read, not a full bucket;
  // dividing by it would be NaN, and a NaN width would silently vanish.
  const usedPercent = capBytes > 0 ? Math.min(100, Math.max(0, (bytes / capBytes) * 100)) : 0
  return h.div(
    [h.Class('mt-3 flex flex-col gap-2 border-t border-role-hairline pt-3')],
    [
      h.div(
        [h.Class('flex items-baseline justify-between gap-2')],
        [
          h.span([h.Class('type-kicker text-role-text-secondary')], ['Storage']),
          h.span([h.Class('type-exif text-role-text-primary')], [meterReadout(bytes, capBytes)]),
        ],
      ),
      h.div(
        [h.AriaHidden(true), h.Class('h-0.5 w-full overflow-hidden bg-role-hairline')],
        [
          h.div(
            [
              h.Class('h-full bg-role-rule'),
              h.DataAttribute('slot', 'storage-meter-used'),
              h.Style({ width: `${usedPercent.toFixed(2)}%` }),
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
  /** The design leaves the 16px icon slot empty on three of the six rows
   *  rather than inventing a glyph for each; the atom reserves the slot either
   *  way, so the labels line up either way. */
  readonly glyph?: IconNode
  readonly count?: string
}

const navRow = (model: Model, row: NavRow, h: HtmlBuilder<Msg>): Child =>
  SidebarItem.sidebarItem(
    {
      label: row.label,
      href: appRouteToUrl(row.route),
      state: model.route._tag === row.route._tag ? 'active' : 'default',
      ...(row.glyph === undefined ? {} : { icon: row.glyph }),
      ...(row.count === undefined ? {} : { count: row.count }),
    },
    h,
  )

/** The rows, in the design's order. Two of them report no count at all, and
 *  both for the honest reason `CONTEXT.md` already states: `Scheduled` is a
 *  display label over a draft with no publish time recorded, so there is no
 *  Scheduled Photo to count, and `Settings` is a singleton with no rows. */
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
    { route: AppRoute.Settings(), label: 'Settings' },
  ]
  return h.nav(
    [
      h.AriaLabel('Admin sections'),
      h.DataAttribute('slot', 'sidebar-nav'),
      h.Class('flex flex-col'),
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
 *  which is what a screen reader needs to say out loud. */
const tagActionsButton = (tag: Tag, h: HtmlBuilder<Msg>): Child =>
  h.button(
    [
      h.OnClick(M.OpenedTagActions({ id: tag.id })),
      h.AriaLabel(`Tag actions for ${tag.label}`),
      h.Title(`Tag actions for “${tag.label}”`),
      h.Class(
        'hover:bg-role-surface-hover focus-visible:ring-role-focus/50 mr-1 shrink-0 p-1 text-role-text-disabled transition-colors duration-120 hover:text-role-text-primary focus-visible:outline-none focus-visible:ring-[3px]',
      ),
      h.DataAttribute('slot', 'tag-actions'),
    ],
    [icon(h, MoreHorizontal, 'size-4')],
  )

const tagsGroup = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('mt-6 flex flex-col gap-1'), h.DataAttribute('slot', 'sidebar-tags')],
    [
      h.h2([h.Class('type-kicker text-role-text-disabled')], ['Tags']),
      ...(model.tags.length === 0
        ? [h.p([h.Class('px-2 type-exif-sm text-role-text-disabled')], ['No tags yet.'])]
        : [
            h.div(
              [h.Class('flex flex-col')],
              model.tags.map((tag) => {
                const selected = model.activeTagIds.includes(tag.id)
                return h.div(
                  [h.Key(`tag-${tag.id}`), h.Class('group flex items-center')],
                  [
                    h.div(
                      [h.Class('min-w-0 flex-1')],
                      [
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
                      ],
                    ),
                    tagActionsButton(tag, h),
                  ],
                )
              }),
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

const footer = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const signOut = signOutUrl(model)
  return h.div(
    [h.Class('mt-auto pt-6'), h.DataAttribute('slot', 'sidebar-footer')],
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
      storageMeter(model, h),
      ...(signOut === undefined
        ? []
        : [
            h.div(
              [h.Class('mt-2')],
              [
                SidebarItem.sidebarItem(
                  { label: 'Sign out', state: 'default', href: signOut, icon: LogOut },
                  h,
                ),
              ],
            ),
          ]),
      h.a(
        [
          h.Href('/'),
          h.Class(
            'mt-1 inline-flex items-center gap-1.5 px-2 type-caption text-role-text-primary transition-colors duration-120 hover:text-role-text-secondary',
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
  h.div(
    [
      h.Class(
        `${SIDEBAR_WIDTH} ${SIDEBAR_PADDING} bg-role-surface-container sticky top-0 flex h-dvh shrink-0 flex-col gap-4 border-r border-role-hairline`,
      ),
      h.DataAttribute('slot', 'sidebar'),
    ],
    [
      h.div(
        [h.Class('flex flex-col gap-1')],
        [
          // The design's wordmark. `THE DESK` is display copy for this one
          // place — it is not a route, a type, or a directory (CONTEXT.md).
          h.span([h.Class('type-nameplate-xs leading-none text-role-text-primary')], ['Elianiva']),
          h.span([h.Class('type-kicker text-role-text-secondary')], ['THE DESK']),
        ],
      ),
      primaryNav(model, h),
      tagsGroup(model, h),
      footer(model, h),
    ],
  )
