# library-empty — what this run actually drove

Ticket: [#28](https://github.com/elianiva/photo.elianiva.com/issues/28). Recipe: `../../features/admin-library-empty.md`.

The documented baseline is `pnpm dev` over the Alchemy dev stack, which needs Cloudflare credentials. Alchemy's stored Cloudflare grant on this machine is `needs-reauth` (`npx alchemy profile show`), so the remote D1/R2 could not answer. Rather than skip the browser, the same block was driven over the **real** app, the **real** Worker and the **real** migrations, with the two remote bindings replaced:

- `packages/web/src/api-worker.ts` served from Node (`scripts/zz-fake-api.ts`, deleted after the run) with `@photo/api/src/testing/d1-fake.ts` (SQLite, `migrations/*.sql` applied → zero Photographs) and `r2-fake.ts` in place of `DB` / `PHOTOS`, `STAGE=dev`, `ACCESS_TEAM_DOMAIN=''`.
- The built client bundle, hydrated from a server render of the app (`packages/web/src/admin/zz-verify-render.test.ts`, deleted after the run) whose model came from folding the real `SucceededGetSession` / `SucceededGetCounts` / `SucceededGetStorage` / `SucceededFetchTags` / `SucceededFetchPhotos` payloads through the real `update`.
- The client's `https://photo-api.localhost` origin rewritten to that Worker by a page init script, and the transport answering CORS for the page's own origin. The run is against the tree at `a0d36c6`, before the dev API moved to a port (`#70`).

Everything above the transport is the shipped code: the same view, the same update, the same Worker, the same migrations. The one thing not exercised is the edge (Cloudflare Access) and the remote data.

## Files

- `empty-state.png` — the Library at 1440×900 with zero Photographs.
- `empty-state.aria.txt` — its accessibility tree.
- `measured-geometry.json` — every number the block renders, read out of the live DOM: 240px tall, 8px gap, 24px padding, `1px dashed rgb(143,138,128)`, 32px mark in `rgb(124,118,107)`, title Newsreader 24px/`-0.24px`, description Newsreader 14px `rgb(94,89,80)`, both pickers 36px tall with a `file` input (`webkitdirectory` on the second), the footnote IBM Plex Mono 10px/`0.2px` in `rgb(124,118,107)`, and 24px between the block and the footnote.
- `drive-transcript.json` — an empty state, then `Import from a folder` with two files (dialog opens, two `Queued` rows), then `Choose files` with one (dialog opens, one `Queued` row), then a cancelled picker (nothing opens, nothing queues).
- `picked-files-dialog.png` — the Upload dialog over that queue.
- `a11y.json` — axe over the empty state: 36 passes, 2 violations, neither in this block's markup. Both are pre-existing and systemic: `$typography.exif` in `color.text.disabled` at 3.95:1 (the sidebar's `Ctrl K` and Tags heading, the Pager's counts, and this block's footnote) and sidebar content outside a landmark.
- `zero-photographs.html` / `filtered-empty.html` — the two states rendered side by side from the same view, for reading the copy without a browser.
