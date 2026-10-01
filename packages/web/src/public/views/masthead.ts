/**
 * Masthead: the broadsheet's front page, printed at the top of every public
 * document. Four bands and one sandwich of rules — the flag, the nameplate, the
 * folio, and the fold.
 *
 * The anatomy is the newspaper's, not a nav bar's, and each part is the part a
 * newspaper uses it for:
 *
 * - the **flag** is the banner line above the name: place, address, year — the
 *   three facts about a paper that do not change between issues
 * - the **nameplate** is the paper's name, and it is the loudest thing on the
 *   page. Newspaper design has one rule about it that outlives every other
 *   fashion: dominance. A nameplate smaller than the things around it is a logo
 *   in a header, which is what this used to be — 44px, centred, with the
 *   Folio's rules the only structure on the page.
 * - the **folio** is the sections line, and it is the only navigation
 * - the **rules** are the structure. There is no card, no border, no shadow and
 *   no fill anywhere in here: a broadsheet is separated by rules and by nothing
 *   else, and every rule on the page lines up down the whole document because
 *   each of them is inside the same band.
 *
 * ## The one red rule
 *
 * The palette is ink on cream, and this is the only place on the site that
 * spends a second colour: the heavy rule the masthead closes on. The New
 * Yorker's own rule for a hundred years is cream paper, deep ink, a single red
 * rule and no ornament at all; a nineteenth-century paper's is the same idea in
 * two inks, the nameplate in black and the register line in red. One rule, at
 * the fold, every page — so the red reads as a mark rather than as decoration,
 * and a reader who scrolls two hundred photographs never sees it again.
 *
 * There is no fleuron. A printer's flower is the one ornament this design could
 * afford, and the ornament that earns a page's trust is the restraint that
 * leaves room for it.
 *
 * ## The nameplate's three tracks
 *
 * The nameplate is the centre cell of a `1fr auto 1fr` grid, so it is centred
 * *structurally*: the hairline beside it is the leftover measure on each side,
 * which means the name stays exactly centred no matter how long the flag above
 * it is. Centring with `text-align: center` over centred tracks would drift the
 * moment the flag's two ends stopped being the same width, and a nameplate that
 * sits a pixel off the axis reads as a mistake rather than as a decision. The
 * two hairlines flanking the name are that grid's side cells, and they are the
 * one piece of print furniture on the site that is drawn rather than typed —
 * they are what a broadsheet runs on either side of its name.
 *
 * The name is set in capitals with the tracking opened up. All-capitals type is
 * spaced for lowercase neighbours, so untreated it reads too light at display
 * sizes; `type-nameplate`'s own `-0.03em` is a mixed-case setting, so the
 * capitals take `letter-spacing.5` over it — the same correction a compositor
 * makes by hand, and the reason the letters here sit evenly rather than gapping
 * at `A` and closing up at `L`.
 *
 * ## What is not here
 *
 * The masthead counts nothing. It used to carry a volume numeral, an issue
 * number and the date of the newest photograph — computed strings that made the
 * header count things the site does not publish, and that any of them could
 * contradict after one edit. What is left is the address, a country and a year:
 * the three things that are true whatever the archive holds.
 *
 * ## The Folio's two ends and the Folio's middle
 *
 * The folio's own links are written lowercase and rendered uppercase by one
 * `uppercase` on the nav, because the middle is not authored at all: a Tag is
 * created, renamed and deleted in the Admin, and it is typed however its author
 * typed it. Two mechanisms — literal capitals on the ends and a transform on
 * the middle — would mean renaming one behaved differently from renaming the
 * other, and would render the same word two ways.
 *
 * A site's Folio is therefore whatever its Tags say it is, and a site with no
 * Tag on a published photograph prints `all` and `about` with nothing between
 * them, which is a real state rather than a broken nav.
 *
 * The Folio **wraps** rather than scrolls. It used to carry a link to `/search`
 * and a link to `/rss.xml`; neither is a route, so both were a 404 wearing a
 * nav link, and a folio is allowed to take two lines on a phone, which is the
 * only way every Tag stays visible with no hidden overflow and no script.
 *
 * The Folio is shared chrome: the Front, the About page and a Tag page print
 * the same nameplate over the same folio, and only the link the reader is on
 * changes. `current` is the Folio's own `href` for that document — `routeHref`
 * in `../route` — so which link is marked is read off the route table rather than
 * off a position in this list.
 */

import type { HtmlBuilder } from 'foldkit/html'

import * as NavLink from '@/components/ui/nav-link'

import type { FolioEntry } from '../content'
import type { Message } from '../model'
import { routeHref, tagPath } from '../route'
import { BAND, type Child } from './shared'

/**
 * The three tracks every centred band in here is built on: `auto` for the
 * thing that must be centred, `1fr` for whatever measure is left over on each
 * side of it. The flag's two ends sit at the outer edges of the outer tracks,
 * the nameplate's rules fill them.
 */
const TRACKS = 'grid grid-cols-[1fr_auto_1fr]'

/** A rule is a filled band, and the width is the design's stroke scale: the
 *  heavy rule is the edge of the paper, the hairline is the fold inside it. */
const HEAVY = 'h-(--stroke-width-bold) bg-role-rule'
const HAIR = 'h-(--stroke-width-subtle) bg-role-rule'
/** The hairlines flanking the name, in the warm grey rather than in ink: they
 *  are print furniture beside the name, not structure under it. */
const FLANK = 'h-(--stroke-width-subtle) bg-role-hairline'
/** The masthead's one red rule. See the note on the second colour. */
const FOLD = 'h-(--stroke-width-bold) bg-role-accent'

/** A rule, drawn rather than typed. */
const rule = (className: string, h: HtmlBuilder<Message>): Child =>
  h.div([h.Class(className)], [])

/**
 * A stack of rules separated by bare stock, which is the gap a compositor
 * leaves between two rules so they read as two. `gap-0.5` is that stock: 2px,
 * less than the hairline's own thickness doubled, so the pair still reads as
 * one mark from across a room.
 */
const ruleStack = (weights: ReadonlyArray<string>, h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class('flex flex-col gap-0.5')],
    weights.map((weight) => rule(weight, h)),
  )

/**
 * The hairline on either side of the nameplate, lifted onto the caps' own
 * middle rather than the line box's: 0.126em of the nameplate, which is 5.5px
 * at `type-nameplate-sm` and 14px at `type-nameplate` — one correction, written
 * out at both ends of the ramp because `em` here would resolve against the 16px
 * these rules inherit rather than against the name beside them.
 */
const flankRule = (h: HtmlBuilder<Message>): Child =>
  rule(`${FLANK} -translate-y-1.5 desktop:-translate-y-3.5`, h)

/**
 * The flag: the line above the name that says which paper this is. Read in the
 * order a broadsheet reads it — place at the left, the address dead centre,
 * the year at the right — and set at the ends in the quieter ink because the
 * address is the one thing on the line a reader might type.
 *
 * The three are facts about a paper rather than about an issue, which is the
 * whole reason the masthead carries them: `indonesia`, `photo.elianiva.com`,
 * `since 2021` are true whether the archive holds four photographs or four
 * hundred.
 */
const flag: ReadonlyArray<{
  readonly place: string
  readonly className: string
  readonly text: string
}> = [
  { place: 'justify-self-start', className: 'text-role-text-disabled', text: 'indonesia' },
  { place: 'justify-self-center', className: 'text-role-text-primary', text: 'photo.elianiva.com' },
  { place: 'justify-self-end', className: 'text-role-text-disabled', text: 'since 2021' },
]

const flagRow = (h: HtmlBuilder<Message>): Child =>
  h.div(
    [h.Class(`${TRACKS} items-baseline gap-x-(--spacing-md) py-(--spacing-sm)`)],
    flag.map((item) =>
      h.span([h.Class(`type-kicker ${item.place} ${item.className}`)], [item.text]),
    ),
  )

/**
 * The nameplate: the paper's name, in the centre track, between two hairlines.
 *
 * It is a link to the Front because a nameplate has always been the way back to
 * the front page, and because on a Tag page it is the only link on the page that
 * leaves the Tag. It is *not* marked `aria-current` on the Front — that mark
 * belongs to the Folio's `all`, and a nameplate that declares itself current on
 * three documents at once is not telling a reader where they are.
 *
 * The size is the design's own nameplate ramp: `type-nameplate-sm` under the
 * `desktop` break, `type-nameplate` above it. Both are Newsreader at weight 500,
 * which is the heaviest weight the site loads — a nameplate set in a weight the
 * rest of the page cannot reach is the one place a masthead is allowed to be
 * louder than the photographs.
 */
const nameplate = (h: HtmlBuilder<Message>): Child =>
  h.div(
    [
      h.Class(
        // The padding is asymmetric on the desktop master, and the reason is a
        // number: the caps of Newsreader occupy 0.744em above the baseline and
        // nothing at all below it, while the line box `type-nameplate` sets is
        // the whole em — which is 0.268em of dead descender space the caps never
        // reach. Equal padding is therefore not equal air: at 112px it leaves
        // 26.7px more room under the name than over it, which is a third of the
        // space and reads as the masthead leaning on the folio. 48 above against
        // 32 below is the correction for that, and it lands the visible gap on
        // the name at 56px over and 59px under. At 44px the dead space is 10.5px
        // and the same correction is inside a rounding error, so the small
        // master is padded evenly.
        `${TRACKS} items-center gap-x-(--spacing-lg) gap-y-(--spacing-md) py-(--spacing-xl) desktop:pt-(--spacing-3xl) desktop:pb-(--spacing-2xl)`,
      ),
    ],
    [
      // The flanking rules are lifted onto the caps' own middle — see `flankRule`.
      flankRule(h),
      h.a(
        [
          h.Href(routeHref({ route: 'front' })),
          h.Class(
            'type-nameplate-sm desktop:type-nameplate uppercase text-role-text-primary transition-opacity duration-(--motion-duration-fast) hover:opacity-70 focus-visible:ring-role-focus/50 outline-none focus-visible:ring-[3px]',
          ),
        ],
        [
          // The tracking rides on an inner span rather than on the link, and
          // that is not tidiness — it is the only way to set a nameplate in
          // this system. `type-nameplate` is one composite from the design
          // system and it declares its own `letter-spacing`; a second utility
          // class on the *same* element is a tie in the cascade, and
          // `tokens.css` is imported after Tailwind's own layer, so the
          // composite wins it every time. On an inner span the two are not
          // competing at all: an inherited value loses to any declaration on the
          // element itself, whatever order the two were written in.
          h.span([h.Class('tracking-[0.05em]')], ['Elianiva']),
        ],
      ),
      flankRule(h),
    ],
  )

/**
 * The Folio: `all`, then one link per Tag a visitor can go to, then `about`.
 *
 * The two ends are the site's own documents and are named here, where they
 * render — their hrefs are the route table's, so the link and the document it
 * points at cannot be spelled two ways. The middle is not authored at all: a
 * Tag is created, renamed and deleted in the Admin, and a section list written
 * in this file would name sections the archive does not have and miss the ones
 * it does, so the middle is the `folio` a public read returned — one entry per
 * Tag with a published photograph, in the read's order.
 */
const folioLinks = (
  folio: ReadonlyArray<FolioEntry>,
): ReadonlyArray<{ readonly label: string; readonly href: string }> => [
  { label: 'all', href: routeHref({ route: 'front' }) },
  ...folio.map((entry) => ({ label: entry.label, href: tagPath(entry.slug) })),
  { label: 'about', href: routeHref({ route: 'about' }) },
]

const folio = (
  current: string,
  entries: ReadonlyArray<FolioEntry>,
  h: HtmlBuilder<Message>,
): Child =>
  h.div(
    [h.Class('flex justify-center py-(--spacing-sm) desktop:py-(--spacing-md)')],
    [
      h.nav(
        [
          h.AriaLabel('Sections'),
          h.Class(
            'flex flex-wrap items-center justify-center gap-x-(--spacing-lg) gap-y-(--spacing-xs) uppercase desktop:gap-x-(--spacing-2xl)',
          ),
        ],
        // The link the reader is on is the one the rule marks, so the mark is
        // the document's own href rather than a position in this list.
        folioLinks(entries).map((link) =>
          NavLink.navLink(
            {
              href: link.href,
              label: link.label,
              state: link.href === current ? 'active' : 'default',
              // The Folio is centred and wraps, so every link carries the same
              // horizontal padding: a hit area a finger can find, and no shift
              // in the row's centring when one link becomes the current one.
              className: 'px-(--spacing-xs)',
            },
            h,
          ),
        ),
      ),
    ],
  )

export const masthead = (
  current: string,
  entries: ReadonlyArray<FolioEntry>,
  h: HtmlBuilder<Message>,
): Child =>
  h.header(
    [h.Class('flex flex-col')],
    [
      h.div(
        // The page's own top margin, above the paper's edge. Every other band
        // on the document is separated from the one above it by its own
        // padding; the masthead is the first, so it is the one that has to
        // clear the top of the viewport itself.
        [h.Class(`${BAND} flex flex-col pt-(--spacing-md)`)],
        [
          // The paper's top edge: the heavy rule, bare stock, the hairline the
          // flag stands on.
          ruleStack([HEAVY, HAIR], h),
          flagRow(h),
          nameplate(h),
          rule(HAIR, h),
          folio(current, entries, h),
          // The fold: the hairline the folio sits on, bare stock, and the one
          // red rule on the site.
          ruleStack([HAIR, FOLD], h),
        ],
      ),
    ],
  )
