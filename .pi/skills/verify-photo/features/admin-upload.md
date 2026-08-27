# Admin upload

Admin upload lets the single owner drop original image files, assign Tags and an optional takenAt, have the server extract dimensions and EXIF, store bytes once in R2 at `originals/<id>-<slug>.<ext>` and metadata in D1, and see the new Photo in the admin grid without a second round-trip.

## Sub-features

- `upload-open` opens the upload dialog from the admin header.
- `upload-queue` enqueues files with per-item status pending/uploading/done/failed and fileStore bytes keyed by `${name}:${size}`.
- `upload-send` POSTs each queued file as multipart to `/api/upload` with blurhash, tagIds, takenAt, and metadata overrides.
- `upload-cancel` aborts the in-flight fetch via `abortStore` and leaves remaining items pending.
- `upload-retry` retries a single failed item or all failed items.

## How to get to it (user POV)

- Open `http://127.0.0.1:13370/admin` and choose `Upload photos` in the header.
- Drop files onto the FileDrop area or use the file picker. Set Tags via the upload combo (`create:<label>` appears when typed text matches no existing label) and optionally a takenAt.
- Choose `Start uploads` to send the queue. While uploading, the header shows `Uploading done/batchTotal` even after the dialog closes.

## Driving it with agent-browser

Preconditions:

- App is healthy at `http://127.0.0.1:13370/admin`.
- No Photo with slug `verify-upload` exists.
- `.pi/skills/verify-photo/scripts/doctor.sh` passes.
- A small JPEG is available at `/tmp/verify-sample.jpg` (create via `scripts/seed.ts` tiny JPEG bytes or any 10KB jpeg).

- **Open dialog.** Choose the header upload action. Run `npx agent-browser open http://127.0.0.1:13370/admin` and `npx agent-browser click --role button --name "Upload photos"`. A dialog with FileDrop appears; `Start uploads` is disabled while queue is empty.
- **Enqueue files.** Drop a file. Run `npx agent-browser` file-drop action or use the system picker on the FileDrop role. The queue shows one row named after the file with `pending` status and an object-URL preview (from `previewStore`). Enqueue up to 50 files, each <= 20MB — beyond that the FileDrop validation rejects and the row shows `failed`.
- **Pick tags on upload.** Assign tags that will ride the multipart request. Open the upload combo, type an existing label and select it, then verify the chip row shows the label. Run `npx agent-browser fill --role combobox --name "Tags" --value "Kyoto"` and `npx agent-browser click --role option --name "Kyoto"`. Tags ride as JSON array string `tagIds` in the form.
- **Blurhash path.** The client computes blurhash via `encodeBlurhash(file)` (`packages/web/src/lib/blurhash.ts`) where only the browser can decode pixels — the Worker never sees pixels. Verify the request includes `blurhash` when computed, or omits it when `encodeBlurhash` returns undefined (valid — server accepts missing blurhash for legacy path).
- **Send queue.** Start the run. Run `npx agent-browser click --role button --name "Start uploads"`. First item flips to `uploading`, controller registered in `abortStore` keyed by `${name}:${size}`. On 201, item flips to `done`, bytes remain in `fileStore` until cleared, preview URL disposed.
- **API direct drive.** Drive the same path without the UI. Run `curl -s -X POST http://127.0.0.1:13370/api/upload -F 'file=@/tmp/verify-sample.jpg;type=image/jpeg' -F 'title=Verify Upload' -F 'tagIds=[]' -F 'blurhash=LKO2?U%2Tw=w]~RBVZRi};kq'`. Expect 201 with `{id, slug, r2Key}`. Re-read via `.pi/skills/verify-photo/scripts/rpc.sh GetPhoto '{"id":"<id>"}'` — title, r2Key, dimensions, and blurhash round-trip.
- **Cancel run.** During a multi-file run, abort the in-flight request. Run `npx agent-browser click --role button --name "Cancel uploads"` (sends `CancelUploads` message). In-flight fetch aborts, chain halts, remaining items stay `pending`.
- **Retry.** After a failure, retry one item or all failed. Run `npx agent-browser click --role button --name "Retry"` on a failed row or `Retry all failed` — failed row flips back to `pending` then `uploading`.
- **Proof.** After a successful upload, ListPhotos via RPC and snapshot the admin grid: `npx agent-browser snapshot --aria --path .pi/skills/verify-photo/artifacts/admin-upload/grid.aria.txt` and `npx agent-browser screenshot --path .pi/skills/verify-photo/artifacts/admin-upload/grid.png` plus save the `POST /api/upload` response to `artifacts/admin-upload/upload.json` and GET `/api/image/<r2Key>` headers to `artifacts/admin-upload/image-headers.txt`.

## Gotchas

- File bytes live only in `fileStore` keyed by `${name}:${size}` — the Model is serializable. A page reload mid-queue loses bytes; expect `FailedUploadItem: uploaded bytes are gone` if you navigated away before Start.
- `previewStore` object URLs are client-side only. Assert the row shows a preview image element, not a specific URL value which is ephemeral.
- R2 key is `originals/<id>-<slug>.<ext>` with deterministic de-conflict suffix on slug collision — do not assert r2Key equals `originals/<slug>.jpg`.
- Upload is the only non-RPC endpoint for bytes. All other admin mutations ride `/api/admin/rpc` and are gated by Access in prod. Locally they are open — do not expect a 401 in dev.
- Title is required and slug is derived from title via `slugify` (max 80 chars, falls back to `untitled`). Sending empty title returns 400 `file and title are required`.
