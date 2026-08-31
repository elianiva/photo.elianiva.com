# Public gallery browse

Public gallery lets any visitor browse the flat, curated Photo list, filter by a single Tag, page forward with keyset cursor, and open a Photo in the lightbox without fetching image bytes until the lightbox requests the original.

## Sub-features

- `gallery-load` renders the initial 60 Photos newest-first (takenAt DESC, id DESC).
- `gallery-filter-tag` filters the list by one Tag slug via ListPhotos tagSlug.
- `gallery-load-more` pages forward when nextCursor is non-null.
- `gallery-lightbox` opens a Photo full-size and closes via Escape or explicit close.

## How to get to it (user POV)

- Open `http://localhost:5173/` at http://localhost:5173 in a browser as a visitor.
- Choose a Tag chip that names a Tag label (e.g. `Kyoto`).
- Choose `Load more` when the gallery shows a next page exists.
- Choose any Photo tile to open its lightbox, then dismiss it.

## Driving it with agent-browser

Preconditions:

- App is healthy at `http://localhost:5173` at http://localhost:5173.
- At least one Photo exists (upload one via admin if the gallery shows “Nothing here yet”).
- `.cursor/skills/verify-photo/scripts/doctor.sh` passes (GET / with Foldkit app shell).
- No filter active at start.

- **Load gallery.** Open the visitor surface. Run `BASE="${BASE:-http://localhost:5173}" npx agent-browser open "$BASE/"` and `npx agent-browser snapshot`. The heading and TagManager chips appear and at least one Photo tile renders with its title text.
- **Tag filter.** Filter by a single tag via the UI. Run `npx agent-browser click --role button --name "Kyoto"` when chips are present and snapshot again — chip shows pressed/selected state and the result line reads `N photos · filtered by "Kyoto"`. Click the same chip again to clear the filter.
- **Load more.** When the gallery shows `Load more`, page forward. Run `npx agent-browser click --role button --name "Load more"` — new tiles append, no duplicates in the snapshot, and the button disappears when no further page exists.
- **Open lightbox.** Choose any tile by its title. Run `npx agent-browser click --role link --name "<photo title>"` or `npx agent-browser click --role button --name "<photo title>"` depending on tile markup. URL stays at `/` but `selectedId` is non-null and the lightbox overlay appears with `src` pointing at `/api/image/<r2Key>` (original) plus decoded blurhash placeholder if `blurhash !== null`.
- **Dismiss lightbox.** Close via keyboard. Run `npx agent-browser press --key "Escape"`. Lightbox overlay disappears and snapshot no longer contains the overlay role.
- **Proof.** Capture the populated gallery, a filtered state, and the lightbox. Run `npx agent-browser snapshot > .cursor/skills/verify-photo/artifacts/gallery-browse/page.aria.txt` and `npx agent-browser screenshot .cursor/skills/verify-photo/artifacts/gallery-browse/page.png` for each state (also filtered + lightbox snapshots if you branch).

## Gotchas

- Tag filtering is single-tag only — the UI only lets one chip be active at a time.
- Lightbox keyboard subscription only runs while `selectedId !== null` (`admin/subscriptions.ts` and `gallery/subscriptions.ts`). Pressing Escape with no lightbox does nothing.
- Blurhash placeholder is client-decoded; views fall back to plain background when `blurhash === null` (pre-blurhash Photos). Assert `blurhash` presence only for post-feature uploads.
