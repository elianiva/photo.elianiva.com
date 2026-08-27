# Public gallery browse

Public gallery lets any visitor browse the flat, curated Photo list, filter by a single Tag, page forward with keyset cursor, and open a Photo in the lightbox without fetching image bytes until the lightbox requests the original.

## Sub-features

- `gallery-load` renders the initial 60 Photos newest-first (takenAt DESC, id DESC).
- `gallery-filter-tag` filters the list by one Tag slug via ListPhotos tagSlug.
- `gallery-load-more` pages forward when nextCursor is non-null.
- `gallery-lightbox` opens a Photo full-size and closes via Escape or explicit close.

## How to get to it (user POV)

- Open `http://127.0.0.1:13370/` in a browser as a visitor.
- Choose a Tag chip that names a Tag label (e.g. `Kyoto`).
- Choose `Load more` when the gallery shows a next page exists.
- Choose any Photo tile to open its lightbox, then dismiss it.

## Driving it with agent-browser

Preconditions:

- App is healthy at `http://127.0.0.1:13370`.
- At least one Photo exists (seed with `pnpm db:seed` dry-run SQL or upload one via admin).
- `.pi/skills/verify-photo/scripts/doctor.sh` reports GET / with Foldkit root and ListPhotos with items.
- No filter active at start (activeTagSlug undefined).

- **Load gallery.** Open the visitor surface. Run `npx agent-browser open http://127.0.0.1:13370/` and `npx agent-browser snapshot --aria`. The heading and TagManager chips appear and at least one Photo tile renders with its title text.
- **RPC shape.** Fetch the first page directly. Run `.pi/skills/verify-photo/scripts/rpc.sh ListPhotos '{"limit":60}'`. Response JSON contains `items` array and `nextCursor` (string or null). Each item matches `PhotoWithTags` (id, slug, title, r2Key, width, height, metadata, blurhash, tags).
- **Tag filter.** Filter by a single slug. Run `.pi/skills/verify-photo/scripts/rpc.sh ListPhotos '{"tagSlug":"kyoto","limit":60}'`. Items are subset of the unfiltered page. Run `npx agent-browser click --role button --name "Kyoto"` when UI chips are present and snapshot again — chip shows pressed state and result line reads `N photos · filtered by "Kyoto"`.
- **Load more.** When `nextCursor` is non-null, page forward. Run `.pi/skills/verify-photo/scripts/rpc.sh ListPhotos '{"limit":60,"cursor":"<nextCursor>"}'`. Returned items do not overlap the first page ids and obey the same ordering. UI: `npx agent-browser click --role button --name "Load more"` appends tiles, no duplicate ids in snapshot.
- **Open lightbox.** Choose any tile by its title. Run `npx agent-browser click --role link --name "<photo title>"` or `npx agent-browser click --role button --name "<photo title>"` depending on tile markup. URL stays at `/` but `selectedId` is non-null and the lightbox overlay appears with `src` pointing at `/api/image/<r2Key>` (original) plus decoded blurhash placeholder if `blurhash !== null`.
- **Dismiss lightbox.** Close via keyboard. Run `npx agent-browser press --key "Escape"`. Lightbox overlay disappears and snapshot no longer contains the overlay role.
- **Proof.** Capture populated gallery and filtered state. Run `npx agent-browser snapshot --aria --path .pi/skills/verify-photo/artifacts/gallery-browse/page.aria.txt` and `npx agent-browser screenshot --path .pi/skills/verify-photo/artifacts/gallery-browse/page.png` plus save the RPC JSON responses to `artifacts/gallery-browse/list.json` and `artifacts/gallery-browse/filtered.json`.

## Gotchas

- Tag filtering is single-tag only. `tagSlug` containing a comma is rejected as `InvalidInput` — do not pass `kyoto,film`.
- limit is clamped 1..100 via `clampLimit`; missing or NaN defaults to 60. Do not expect server to echo a different limit.
- Cursor is opaque base64 of `{"takenAt": string|null, "id": string}`. Do not craft it by hand — use the `nextCursor` returned by the previous page.
- Lightbox keyboard subscription only runs while `selectedId !== null` (`admin/subscriptions.ts` and `gallery/subscriptions.ts`). Pressing Escape with no lightbox does nothing.
- Blurhash placeholder is client-decoded; views fall back to plain background when `blurhash === null` (pre-blurhash Photos). Assert `blurhash` presence only for post-feature uploads.
