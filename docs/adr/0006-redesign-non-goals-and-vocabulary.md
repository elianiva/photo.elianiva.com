# Redesign: the frames deliberately not built, and the vocabulary they collided on

Accepted.

## Context

The redesign lives in the Brilliant project `photo.elianiva.com`, canvas
`site-v2`. The canvas is a design surface, not a specification, and it contains
a fair amount the site will never build. Left unrecorded, those frames are the
most expensive thing in the design: the next agent to open the canvas sees a
`Desk — Login` frame with a passkey button and reasonably concludes it is a
missing feature rather than a deliberate non-goal. This ADR is that record, and
it is the companion to `CONTEXT.md`, which carries the vocabulary.

## Vocabulary

**Frame** is display copy and is never a type, a column, or an RPC field. Code
says Photo. The design says `412 FRAMES`; that is a label, not a schema.

The `Archive` collision is split. `Archive — Desktop` (`1b23a3dbfc26d60c`) is a
public page; the Settings block `4961410296c710f0` in `Desk — Settings`
(`8b3ebe985801026f`) is a byte meter and a retention policy; and the Admin
already calls its soft-deleted Photographs the `Trash`, so an Admin surface
named `Archive` would be a near-synonym for something that already exists. The
`Trash` is that state and not a page the Admin lists, which does not change what
the word means.

- **Archive** is the public chronological index of published Photos at
  `/archive`, a read of the Photo list rather than a stored entity.
- **Storage** is the Admin Settings block: frame count, bytes against quota, CSV
  index, and the RETAIN setting for the Trash purge. The design already calls
  the sidebar's meter `Storage` (`f9d7fbd1cc8e9944`), so the split follows the
  design's own lead.
- The Settings section the design labels `ARCHIVE` is the **Storage** section.

## Not built as drawn

| Frame                     | Id                 | Why not                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Desk — Login`            | `dc26911525f88582` | Auth is Cloudflare Access, not an app form (ADR 0003).                                                                                                                                                                                                                                                                                                  |
| `Desk — Login · states`   | `feb23a34c04e1a7c` | Same. Its three columns — `DEFAULT` (email + password), `WRONG PASSWORD` (plus a magic-link ghost button), `LOCKED` (`TOO MANY ATTEMPTS · TRY AGAIN IN 15 MINUTES`, disabled sign-in, passkey ghost button) — specify an email/password login, a magic-link path, passkeys and account lockout. There is exactly one operator and Access owns all four. |
| `Desk — Editor · History` | `b7fa564139a1e3bc` | No audit log, no `photo_history` table, and therefore no 90-day purge. The frame's footer `KEPT FOR 90 DAYS · 6 ENTRIES` describes a retention rule for a table that will not exist.                                                                                                                                                                    |
| `Desk — Series`           | `7f16c8794ca8e00b` | No Series entity. Grouping is Tags.                                                                                                                                                                                                                                                                                                                     |
| `Desk — Mobile · Login`   | `d4026205feefed4d` | Doubly out: mobile admin is a later chain, and no login form exists at all.                                                                                                                                                                                                                                                                             |

Two consequences of the Series non-goal that are easy to misread:

- The `SERIES` nav group in the Desk sidebar (`e6a38e33273b03bf` and its
  siblings, on every Desk frame) is not dropped. The sidebar renders a `TAGS`
  kicker with one item per tag in that slot. What does not ship is a _Series_
  group — there is no entity behind the kicker the design drew.
- `Desk — Series`'s `COVER` panel — `The first frame of the series becomes the
cover.` and a `Change cover` button — needs a `series` table. No cover column
  is added to Tag or Photo to hold it. A Series page is a Tag page ordered by
  `takenAt` whose cover is the earliest published Photo, which is why a Tag's
  `slug` is not editable: a slug is a live URL.

`RETAIN FOREVER` in Settings therefore governs **only** the Trash purge. It is
not a history-retention policy, and nothing else in the product may be
described as one. Nothing purges on a timer, so the control is drawn disabled at
its one true value.

## Later chains

These frames are a different chain from the one being built — admin desktop plus
the public Front — and several will not be built as drawn, per the two sections
above: `Lightbox — Desktop` / `— Mobile` (`27821e1abb5aa9d4` /
`82991e981ed194a3`), `Photo` (`9a4c10e3399c7af3` / `08d2d4553da7ae6c`), `Zoom`
(`3545605e80259537` / `97f228badc9dccdc`), `Search` (`38dcb73b9fa6dee3` / `18721083a4fbc8c2`), `404`
(`faa7c63900307915` / `1c537000448369ac`), `Social preview — 1200`
(`b72424d104daedcd`), `Series` (`07577b396e2f00bf` / `73ca2068f3588260`),
`Series detail` (`c419f7cc479a9dd3` / `7b5110d9cc51496a`), and `Desk — Mobile`
(`7cfe407cb0cc6138` / `039e080efb3efef8` / `9f2aabeb97f9e5ae` /
`d4026205feefed4d` / `feb54b4108b6b59c`).

`About` (`b6d1dcfc0e6dad2a` / `ffc9476fb7c57fbf`) has left that list: the
public page at `/about` is built, as a route of the public site's one app beside
the Front. Its two masters are two compositions rather than one page at two
widths — two prose columns and one plate on the desktop, one re-flowed paragraph
and two plates on the mobile — and the plate the mobile master adds is drawn
`lazy` and hidden at `desktop`, because a plate no layout draws must not fetch a
Photo's original on a zone with no resizer (ADR 0002). The design's plate is a
stock asset numbered `No. 001`; the page shows the newest published photographs
instead, because a stock photograph is not a work this site publishes.

## Consequences

- A reader of the repo can tell, without opening the design, which frames are
  deliberately absent and what would have to become true to build them.
- The Editor ships `EDIT` and `DETAILS` tabs only, and no third tab is drawn
  even disabled, because History is not built.
- The fourth Settings section is the Storage section; there is no
  history-retention control in it.
- The public page keeps `ARCHIVE` in its kicker, and the Folio's other entries
  are the site's Tags rather than the design's `STREET` / `LANDSCAPE` / `SERIES`
  words.
- `/about` and `/tag/<slug>` are public routes in `public/route.ts`, so they are
  Worker-first paths and the sitemap names them (ADR 0004). The Folio is a read
  (`PublicPhotoService.folio`): one link per Tag with a published Photo, and each
  link is a Tag page that renders — which is how the design's `SERIES` reaches the
  site without a Series entity. `ARCHIVE` is still a nav word without a page, so
  it is not in the Folio until its chain lands, and a `/tag/<slug>` naming no Tag
  answers `404`.
- `CONTEXT.md` gains Photo Number, Status, Ratio, Rendition, Frame, Archive,
  Folio, Tag page and Storage, and keeps _Admin_ as the term with the
  _Dashboard / CMS / Studio / Backend / The Desk_ line.
- Image delivery is a separate decision and lives in ADR 0002: no `IMAGES`
  binding, no zone resizer, and no `thumbUrl`/`srcSet` anywhere.
