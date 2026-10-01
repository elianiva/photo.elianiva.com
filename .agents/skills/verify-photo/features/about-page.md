# About page

`/about` is the second public document: the broadsheet's masthead, a kicker, a headline, a deck, the photographer's prose, the photographs the page leads with, the Kit — body, lens, since, output — and the colophon. It is server-rendered by the website Worker off its own D1 binding, so the photographs and the page's copy are both in the HTML a reader receives.

## Sub-features

- `about-route` — `GET /about` is answered by the Worker, not by the client template, and hydrates without a reload.
- `about-copy` — the kicker, headline, deck and prose are authored in the view, so they are the same words whatever the archive holds.
- `about-composition` — the desktop master runs the prose as two columns and draws one plate; the mobile master runs it as one paragraph and draws two.
- `about-plates` — the plates are published photographs, newest first, served from R2 by their own key, with the Photo Number as the placard and the Exif line below.
- `about-kit` — the Kit is four label/value rows: `BODY`, `LENS`, `SINCE`, `OUTPUT`.
- `about-nav` — the Folio marks `ABOUT` as the current section, lists the site's Tags between it and `ALL`, and `ALL` returns to the Front.
- `about-chrome` — the masthead and the colophon are the ones the Front prints, including the mobile colophon that drops `EQUIPMENT`.

## How to get to it (user POV)

- From the Front: choose `ABOUT` in the folio's section links.
- Directly: open `http://localhost:5173/about`.
- Back: choose `ALL` in the folio, or `BACK TO TOP ↑` in the colophon.

## Driving it with agent-browser

Preconditions:

- App is healthy at `http://localhost:5173` and at least one Photo is published, or the page is verified in its no-plate state and the plate assertions are reported as unmet.
- `.agents/skills/verify-photo/scripts/doctor.sh` passes.

- **Open the page.** Run `npx agent-browser open "http://localhost:5173/about"`. The title reads `photo.elianiva.com — About`, the heading is `One camera, one lens, and a lot of walking`, and the Kit prints its four rows.
- **The current section is ABOUT.** Run `npx agent-browser eval "JSON.stringify([...document.querySelectorAll('a[data-slot=nav-link]')].map(x => [x.textContent, x.getAttribute('aria-current')]))"`. The `ABOUT` row is the one carrying `page`; on `/` it is `ALL`.
- **Navigate both ways.** Run `npx agent-browser click "a[href='/about']"` from the Front and assert the URL is `/about`; run `npx agent-browser click "a[href='/#']"` and assert the URL is `/#` and the title is the Front's.
- **A plate is a plate.** Run `npx agent-browser click --role button --name "View <title>"` on a plate. The lightbox opens on the original; `Escape` closes it. The same affordance the Front's plates have.
- **Plate bytes come from the API Worker.** In the lightbox, run `npx agent-browser get attr src "img[role=img], .fixed img"` — or read the plate's `src` — and assert it points at `http://localhost:13371/api/image/<r2Key>` and loads.
- **The mobile master.** Run `npx agent-browser set viewport 390 844` and reload. The prose is one paragraph, the nameplate is the short one, the second plate is drawn, and the colophon drops `EQUIPMENT`. At this width the desktop plate is `display: none` and its image is `loading="lazy"`, so the browser never fetches a Photo's original for a layout that is not on screen.
- **A site with nothing published.** On a site with no published Photo the page is the copy and the Kit with no plate and no broken image; the Front's own `NOTHING PUBLISHED YET` state is the honest parallel.
- **Proof.** `npx agent-browser snapshot > .agents/skills/verify-photo/artifacts/about-page/about-desktop.aria.txt`, `npx agent-browser screenshot "" .agents/skills/verify-photo/artifacts/about-page/about-desktop.png --full`, and the same two for `about-mobile`.

## Gotchas

- The Folio's middle is the site's Tags, not fixed words: its links are `/tag/<slug>` and they change when a Tag is renamed in the Admin. `STREET`, `LANDSCAPE` and `SERIES` are no longer in it, and a `/tag/<slug>` naming no Tag answers `404` rather than another document (ADR 0006). Assert the nav by reading the links that are there, not by expecting a fixed set.
- A trailing slash is the same document — `/about/` answers 200 — so a mistyped slash is not a missing page.
- `/api/health` returning `503 {"ok":false}` means the remote D1 binding is not answering (a Cloudflare API `TooManyRequests` does this). The page then renders its no-plate state on both documents; that is the read-failure path, not an About-page fault.
- The page is authored copy: its words do not change when photographs are uploaded, so a difference in the prose between runs is a real change, not stale data.
