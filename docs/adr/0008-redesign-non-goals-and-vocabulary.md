# Redesign non-goals: frames deliberately not built, and the vocabulary they collided on

## Status

Accepted

## Context

The redesign lives in the Brilliant project `photo.elianiva.com`, canvas
`site-v2` — 39 top-level frames. The canvas is a design surface, not a
specification, and it contains a fair amount that the site will never build:
frames for a login form when Cloudflare Access is the auth boundary, a revision
history for a single-operator site with no revisions, and a Series entity for a
model whose grouping is Tags.

Left unrecorded, those frames are the most expensive thing in the design. The
next agent to open the canvas sees a `Desk — Login` frame with a passkey button
and reasonably concludes it is a missing feature rather than a deliberate
non-goal. This ADR is the record that says otherwise, and it is the companion to
`CONTEXT.md`, which now carries the vocabulary the frames collided on.

The canvas also used one word for two unrelated things. `Archive — Desktop`
(`1b23a3dbfc26d60c`) is a public page; the Settings block `4961410296c710f0` in
`Desk — Settings` (`8b3ebe985801026f`) is a byte meter and a retention policy.
The Admin sidebar already has a `Trash` page, so an Admin surface named
`Archive` would be a near-synonym for something that already exists.

## Decision

### Vocabulary

**Frame** is display copy and is never a type, a column, or an RPC field. Code
says Photo. The design says `412 FRAMES`; that is a label, not a schema.

The `Archive` collision is split:

- **Archive** is the public chronological index of published Photos at
  `/archive`. It is a read of the Photo list, not a stored entity.
- **Storage** is the Admin Settings block: frame count, bytes against quota,
  CSV index, and the RETAIN setting for the Trash purge. The design already
  calls the sidebar's meter `Storage` (`f9d7fbd1cc8e9944`), so the split
  follows the design's own lead.
- The Settings section the design labels `ARCHIVE` is the **Storage** section.
  #37 renders its kicker `STORAGE`.

### Non-goals

| Frame                                                                          | Id                                                                                                     | Not built because                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Desk — Login`                                                                 | `dc26911525f88582`                                                                                     | Auth is Cloudflare Access, not an app form (ADR 0007).                                                                                                                                                                                                                                                                                                           |
| `Desk — Login · states`                                                        | `feb23a34c04e1a7c`                                                                                     | Same. The frame's three columns — `DEFAULT` (email + password), `WRONG PASSWORD` (plus a magic-link ghost button), `LOCKED` (`TOO MANY ATTEMPTS · TRY AGAIN IN 15 MINUTES`, disabled sign-in, passkey ghost button) — specify an email/password login, a magic-link path, passkeys, and account lockout. There is exactly one operator and Access owns all four. |
| `Desk — Editor · History`                                                      | `b7fa564139a1e3bc`                                                                                     | No audit log, no `photo_history` table, and therefore no 90-day purge — the frame's footer `KEPT FOR 90 DAYS · 6 ENTRIES` describes a retention rule for a table that will not exist.                                                                                                                                                                            |
| `Desk — Series`                                                                | `7f16c8794ca8e00b`                                                                                     | No Series entity. Grouping is Tags.                                                                                                                                                                                                                                                                                                                              |
| `Lightbox — Desktop` / `Lightbox — Mobile`                                     | `27821e1abb5aa9d4` / `82991e981ed194a3`                                                                | Later chains. This chain is admin desktop plus the public Front.                                                                                                                                                                                                                                                                                                 |
| `Photo — Desktop` / `Photo — Mobile`                                           | `9a4c10e3399c7af3` / `08d2d4553da7ae6c`                                                                | Later chains.                                                                                                                                                                                                                                                                                                                                                    |
| `Zoom — Desktop` / `Zoom — Mobile`                                             | `3545605e80259537` / `97f228badc9dccdc`                                                                | Later chains.                                                                                                                                                                                                                                                                                                                                                    |
| `About — Desktop` / `About — Mobile`                                           | `b6d1dcfc0e6dad2a` / `ffc9476fb7c57fbf`                                                                | Later chains.                                                                                                                                                                                                                                                                                                                                                    |
| `Search — Desktop` / `Search — Mobile`                                         | `38dcb73b9fa6dee3` / `18721083a4fbc8c2`                                                                | Later chains.                                                                                                                                                                                                                                                                                                                                                    |
| `404 — Desktop` / `404 — Mobile`                                               | `faa7c63900307915` / `1c537000448369ac`                                                                | Later chains.                                                                                                                                                                                                                                                                                                                                                    |
| `Social preview — 1200`                                                        | `b72424d104daedcd`                                                                                     | Later chain.                                                                                                                                                                                                                                                                                                                                                     |
| `Series — Desktop` / `Series — Mobile`                                         | `07577b396e2f00bf` / `73ca2068f3588260`                                                                | Later chains. Built as tag pages, not a Series index.                                                                                                                                                                                                                                                                                                            |
| `Series detail — Desktop` / `Series detail — Mobile`                           | `c419f7cc479a9dd3` / `7b5110d9cc51496a`                                                                | Later chains. Built as a tag page.                                                                                                                                                                                                                                                                                                                               |
| `Desk — Mobile · Library` / `· Editor` / `· Upload` / `· Login` / `· Settings` | `7cfe407cb0cc6138` / `039e080efb3efef8` / `9f2aabeb97f9e5ae` / `d4026205feefed4d` / `feb54b4108b6b59c` | Later chain. This chain is admin desktop. The Login one is doubly out: mobile admin is later, and no login form exists at all.                                                                                                                                                                                                                                   |

Two consequences of the Series non-goal that are easy to misread:

- The `SERIES` nav group in the Desk sidebar (`e6a38e33273b03bf` and its
  siblings, present on every Desk frame) is not dropped. #24 already replaces
  the `SERIES` kicker with a `TAGS` kicker and puts one `Sidebar Item` per tag
  in that slot. What does not ship is a _Series_ group — there is no entity
  behind the kicker the design drew.
- `Desk — Series`'s `COVER` panel — `The first frame of the series becomes the
cover.` and a `Change cover` button — needs a `series` table. No cover column
  is added to Tag or Photo to hold it. When the public Series pages are built,
  a Series page is a Tag page ordered by `takenAt` whose cover is the earliest
  published Photo.

### RETAIN FOREVER

With History gone, the 90-day purge is gone with it. Settings' `RETAIN FOREVER`
therefore governs **only** the Trash purge. It is not a history retention
policy, and nothing else in the product may be described as one.

### No Images binding, and no zone resizer either

`alchemy.run.ts` declared an `IMAGES` binding on the website Worker and
`WebsiteEnv` typed it as `unknown`, and nothing read either. The declaration is
removed rather than adopted.

The delivery path this replaced was zone image resizing by URL rewrite
(`/cdn-cgi/image/width=…/image/<r2Key>`, built in `packages/web/src/lib/image.ts`
and served by `handleImageProxy` in `packages/web/src/api-worker.ts`), and it
never worked: **Image Resizing is plan-gated, and this zone is on the Free plan,
where `image_resizing` reports `editable: false`.** Every `/cdn-cgi/image`
request answers 404 whatever it is asked for, on either host. So `thumbUrl`,
`srcSet` and the Front's plate URL were all building 404s.

Those builders are removed rather than left to fail. Every image — the Front's
plates, the Library's grid, the Editor's stage — is now the Photo's original,
served from R2 through the same proxy, cropped to its Ratio by the plate's own
`aspect-ratio` box. The trade is honest: a grid of forty plates asks for forty
originals. The designed answer is stored Renditions, and the resize path is
either a plan upgrade or #35 — not something the code can assume.

## Consequences

- A reader of the repo can tell, without opening the design, which frames are
  deliberately absent and what would have to become true to build them.
- #24 does not render a Series group, and #30 ships `EDIT` and `DETAILS` tabs
  only, as those issues already state.
- #37 renders the fourth Settings section as `STORAGE` and does not add a
  history-retention control. #37's section list calls that section `ARCHIVE`
  today; per this ADR it is the **Storage** section. #37 already renders the
  sidebar meter's kicker as `STORAGE`, so the two now agree.
- The public page keeps `ARCHIVE` in its kicker and its Folio nav entry.
- `CONTEXT.md` gains Photo Number, Status, Ratio, Rendition, Frame, Archive, and
  Storage, and keeps _Admin_ as the term with the _Dashboard / CMS / Studio /
  Backend / The Desk_ line.
- Deleting the `IMAGES` binding removes it from the deployed Worker on the next
  `alchemy deploy`. No code reads it, so nothing changes at runtime.
