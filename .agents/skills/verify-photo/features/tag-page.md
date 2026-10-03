# Tag page

`/tag/<slug>` is a Tag's own public page: the Tag's label as the headline, its caption as the deck, the frame count on the rule under them, and that Tag's published photographs flowed into columns, earliest first. There is no Series entity — a Series page *is* a Tag page — and no curated order, so the earliest photograph is the cover. It is server-rendered by the website Worker off its own D1 binding, and the Folio that links to it is the same read, so the page exists for exactly the Tags the nav lists.

## Sub-features

- `tag-route` — `GET /tag/<slug>` is answered by the Worker, not by the client template, and hydrates without a reload. A slug no Tag carries answers `404` rather than another document.
- `tag-page-copy` — the headline is the Tag's label and the deck is its caption, both as the Admin holds them; a Tag with no caption prints no deck rather than an empty one.
- `tag-plates` — the plates are that Tag's published Photos, earliest first, served from R2 by their own key, with the Photo Number as the placard and the Exif line below.
- `tag-count` — the rule under the deck counts the photographs, in frames, the way an Edition Section's head does.
- `tag-nav` — the Folio's entry for this Tag is marked as the current section, and the Colophon prints the same Tag list again under `SECTIONS`.
- `tag-chrome` — the masthead and the colophon are the ones the Front and the About page print.

## How to get to it (user POV)

- From any public document: choose the Tag's name in the Folio's section links.
- Directly: open `http://localhost:4000/tag/<slug>`.

## Driving it with agent-browser

Preconditions:

- App is healthy at `http://localhost:4000` and at least one published Photo carries a Tag, so the Folio has at least one Tag entry.
- `.agents/skills/verify-photo/scripts/doctor.sh` passes.

- **Open the page from the nav.** Run `npx agent-browser open "http://localhost:4000/"` then `npx agent-browser eval "document.querySelector('nav[aria-label=Sections] a[href^=\"/tag/\"]').getAttribute('href')"`. Open that href; the title reads `photo.elianiva.com — <label>` and the heading is that label.
- **The Folio is the read.** Run `npx agent-browser eval "JSON.stringify([...document.querySelectorAll('nav[aria-label=Sections] a')].map(x => x.getAttribute('href')))"`. The list is `/#`, one `/tag/<slug>` per Tag that has a published Photo, then `/about` — and the same list is printed under `SECTIONS` in the colophon.
- **The current section is this Tag.** Run `npx agent-browser eval "JSON.stringify([...document.querySelectorAll('a[aria-current=page]')].map(x => x.getAttribute('href')))"`. It is this Tag's own href, not `/#`.
- **The plates are this Tag's photographs.** Run `npx agent-browser snapshot`. Every plate's title is a Photo carrying this Tag, and no plate belongs to a Tag-less photograph. The earliest one is first.
- **Plate bytes come from the API Worker.** Run `npx agent-browser get attr src "img[role=img]"` and assert the src points at `http://localhost:13371/api/image/<r2Key>` and loads. No `cdn-cgi/image`, no Unsplash.
- **The lightbox works here.** Run `npx agent-browser click --role button --name "View <title>"` on a plate; the lightbox opens on the original and `Escape` closes it.
- **A slug no Tag carries.** Open `http://localhost:4000/tag/nothing-here`. The status is `404` and the page is not the Front.
- **The mobile master.** Run `npx agent-browser set viewport 390 844` and reload. The headline is the short one, the plates flow into two columns, and the colophon drops `EQUIPMENT`.
- **Proof.** `npx agent-browser snapshot > .agents/skills/verify-photo/artifacts/tag-page/tag-desktop.aria.txt`, `npx agent-browser screenshot "" .agents/skills/verify-photo/artifacts/tag-page/tag-desktop.png --full`, and the same two for `tag-mobile`.

## Gotchas

- The slug is the URL, so renaming a Tag's `label` in the Admin changes the headline and the nav text but not its path; the slug is not editable, deliberately.
- A Tag whose only photographs are drafts or in the Trash is not in the Folio and its page answers `404` — the nav is a list of places that exist.
- A Tag with a caption renders a deck; a Tag without one renders the headline straight onto the rule. Do not assert an empty paragraph.
- A Tag page is read whole, so there is no Continued row to scroll to. If one appears, the page is rendering the Front's composition.
