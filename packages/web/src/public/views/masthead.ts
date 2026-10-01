/**
 * Masthead: the broadsheet's front. The site name sits in a strip over the
 * nameplate; the ears carry the origin, the tagline and the archive line; the
 * folio below the rule stack is the only navigation on the page.
 *
 * Every word here is written where it renders: a masthead is the publication's
 * voice, so it changes when the voice changes rather than when a photograph is
 * uploaded. The strip used to carry a volume numeral, an issue number and the
 * date of the newest photograph — computed strings that made the header count
 * things the site does not publish, and that any of them could contradict after
 * one edit. What is left is the name. The Folio is the one part of the Masthead
 * that is read rather than written, because it is the site's Tags.
 *
 * The mobile Masthead master (size=mobile) drops the ears and the site name
 * from the strip, centres the short nameplate over the tagline, and keeps only
 * the section links and search in the folio — so the 112px nameplate never has
 * to fit a narrow measure. The ears' fixed 260px boxes and the 112px nameplate
 * are what put the flip at `desktop`: below it the desktop composition cannot
 * fit.
 *
 * The Masthead is shared chrome: the Front, the About page and a Tag page
 * print the same nameplate over the same folio, and only the link the reader is
 * on changes. `current` is the Folio's own `href` for that document — `routeHref`
 * in `../route` — so which link is marked is read off the route table rather than
 * off a position in this list.
 */

import { Search } from "lucide";
import type { HtmlBuilder } from "foldkit/html";

import * as NavLink from "@/components/ui/nav-link";

import { icon } from "@/lib/icons";

import type { FolioEntry } from "../content";
import type { Message } from "../model";
import { routeHref, tagPath } from "../route";
import { mastheadRules } from "./rules";
import { BAND, type Child } from "./shared";

/**
 * The Folio: `ALL`, then one link per Tag a visitor can go to, then `ABOUT`.
 *
 * The two ends are the site's own documents and are named here, where they
 * render — their hrefs are the route table's, so the link and the document it
 * points at cannot be spelled two ways. The middle is not authored at all: a
 * Tag is created, renamed and deleted in the Admin, and a section list written
 * in this file would name sections the archive does not have and miss the ones
 * it does, so the middle is the `folio` a public read returned — one entry per
 * Tag with a published photograph, in the read's order.
 *
 * A site's Folio is therefore whatever its Tags say it is, and a site with no
 * Tag on a published photograph prints `ALL` and `ABOUT` with nothing between
 * them, which is a real state rather than a broken nav.
 */
const folioLinks = (
  folio: ReadonlyArray<FolioEntry>,
): ReadonlyArray<{ readonly label: string; readonly href: string }> => [
  { label: "ALL", href: routeHref({ route: "front" }) },
  ...folio.map((entry) => ({ label: entry.label, href: tagPath(entry.slug) })),
  { label: "ABOUT", href: routeHref({ route: "about" }) },
];

/** The two boxes flanking the desktop nameplate: same box, mirrored alignment. */
const EAR =
  "hidden w-[260px] shrink-0 flex-col gap-(--spacing-xs) px-(--spacing-md) py-(--spacing-sm) desktop:flex";

const earsStrip = (h: HtmlBuilder<Message>): Child =>
  h.div(
    [
      h.Class(
        "flex items-center justify-center gap-(--spacing-lg) border-b border-role-hairline py-(--spacing-md)",
      ),
    ],
    [h.span([h.Class("type-caption italic text-role-text-secondary")], ["photo.elianiva.com"])],
  );

const nameplateRow = (h: HtmlBuilder<Message>): Child =>
  h.div(
    [
      h.Class(
        "flex flex-col items-center gap-(--spacing-xs) py-(--spacing-lg) desktop:flex-row desktop:items-center desktop:justify-between desktop:gap-(--spacing-xl) desktop:py-(--spacing-xl)",
      ),
    ],
    [
      h.div(
        [h.Class(`${EAR} text-left`)],
        [
          h.span([h.Class("type-kicker text-role-text-secondary uppercase")], ["from indonesia"]),
          h.span(
            [h.Class("type-caption italic text-role-text-primary")],
            ["Street, mostly. Landscape, sometimes."],
          ),
        ],
      ),
      h.span(
        [h.Class("type-nameplate-xs text-role-text-primary desktop:type-nameplate")],
        ["Elianiva"],
      ),
      h.div(
        [h.Class(`${EAR} text-right`)],
        [
          h.span([h.Class("type-kicker text-role-text-secondary")], ["PHOTOGRAPHY ARCHIVE"]),
          h.span([h.Class("type-caption italic text-role-text-primary")], ["Indonesia"]),
        ],
      ),
      // The ears' tagline moves under the mobile nameplate; the site name it
      // sat beside is the nameplate itself.
      h.span(
        [h.Class("type-caption italic text-role-text-secondary desktop:hidden")],
        ["Street, mostly. Landscape, sometimes."],
      ),
    ],
  );

const folio = (
  current: string,
  entries: ReadonlyArray<FolioEntry>,
  h: HtmlBuilder<Message>,
): Child =>
  h.div(
    [
      h.Class(
        "flex items-center justify-between gap-(--spacing-lg) border-b border-role-rule py-(--spacing-md) desktop:gap-(--spacing-xl)",
      ),
    ],
    [
      h.nav(
        [
          h.AriaLabel("Sections"),
          h.Class("flex items-center gap-(--spacing-lg) desktop:gap-(--spacing-xl) uppercase"),
        ],
        // The link the reader is on is the one the rule marks, so the mark is
        // the document's own href rather than a position in this list.
        folioLinks(entries).map((link) =>
          NavLink.navLink(
            {
              href: link.href,
              label: link.label,
              state: link.href === current ? "active" : "default",
            },
            h,
          ),
        ),
      ),
      h.div(
        [h.Class("flex items-center gap-(--spacing-lg) desktop:gap-(--spacing-xl)")],
        [
          // The mobile folio carries the section links and search only, so the
          // feed rides the desktop composition.
          h.nav(
            [h.AriaLabel("Utility"), h.Class("hidden items-center desktop:flex")],
            [NavLink.navLink({ href: "/rss.xml", label: "RSS", state: "default" }, h)],
          ),
          h.a(
            [h.Href("/search"), h.AriaLabel("Search")],
            [icon(h, Search, "size-3.5 text-role-text-primary")],
          ),
        ],
      ),
    ],
  );

export const masthead = (
  current: string,
  entries: ReadonlyArray<FolioEntry>,
  h: HtmlBuilder<Message>,
): Child =>
  h.header(
    [h.Class("flex flex-col")],
    [
      h.div(
        [h.Class(`${BAND} flex flex-col`)],
        [earsStrip(h), nameplateRow(h), mastheadRules(h), folio(current, entries, h)],
      ),
    ],
  );
