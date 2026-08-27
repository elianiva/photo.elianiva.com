# Admin upload

Admin upload lets the single owner drop original image files, assign Tags and an optional takenAt, have the server extract dimensions and EXIF, store bytes once in R2 at `originals/<id>-<slug>.<ext>` and metadata in D1, and see the new Photo in the admin grid without a second round-trip.

## Sub-features

- `upload-open` opens the upload dialog from the admin header.
- `upload-queue` enqueues files with per-item status pending/uploading/done/failed and fileStore bytes keyed by `${name}:${size}`.
- `upload-send` POSTs each queued file as multipart to `/api/upload` with blurhash, tagIds, takenAt, and metadata overrides.
- `upload-cancel` aborts the in-flight fetch via `abortStore` and leaves remaining items pending.
- `upload-retry` retries a single failed item or all failed items.

## How to get to it (user POV)

- Open `https://photo.localhost/admin` (`portless get photo` + `/admin`) and choose `Upload photos` in the header.
- Drop files onto the FileDrop area or use the file picker. Set Tags via the upload combo (`create:<label>` appears when typed text matches no existing label) and optionally a takenAt.
- Choose `Start uploads` to send the queue. While uploading, the header shows `Uploading done/batchTotal` even after the dialog closes.

## Driving it with agent-browser

Preconditions:

- App is healthy at `https://photo.localhost/admin` (`portless get photo` + `/admin`).
- No Photo with slug `verify-upload` exists.
- `.pi/skills/verify-photo/scripts/doctor.sh` passes.
- A small JPEG is available at `/tmp/verify-sample.jpg` (create via `scripts/seed.ts` tiny JPEG bytes or any 10KB jpeg).

- **Open dialog.** Choose the header upload action. Run `BASE=$(portless get photo 2>/dev/null || echo https://photo.localhost) npx agent-browser open "$BASE/admin"` and `npx agent-browser click --role button --name "Upload photos"`. A dialog with FileDrop appears; `Start uploads` is disabled while queue is empty.
- **Enqueue files.** Drop a file. Run `npx agent-browser` file-drop action or use the system picker on the FileDrop role. The queue shows one row named after the file with `pending` status and an object-URL preview (from `previewStore`). Enqueue up to 50 files, each <= 20MB — beyond that the FileDrop validation rejects and the row shows `failed`.
- **Pick tags on upload.** Assign tags before sending. Open the upload combo, type an existing label and select it, then verify the chip row shows the label. Run `npx agent-browser fill --role combobox --name "Tags" --value "Kyoto"` and `npx agent-browser click --role option --name "Kyoto"`.
- **Send queue.** Start the run. Run `npx agent-browser click --role button --name "Start uploads"`. First item flips to `uploading`; on success it flips to `done` and the new photo appears in the admin grid without a reload. The header shows `Uploading done/batchTotal` while the queue drains.
- **Cancel run.** During a multi-file run, abort the in-flight request. Run `npx agent-browser click --role button --name "Cancel uploads"` (sends `CancelUploads` message). In-flight fetch aborts, chain halts, remaining items stay `pending`.
- **Retry.** After a failure, retry one item or all failed. Run `npx agent-browser click --role button --name "Retry"` on a failed row or `Retry all failed` — failed row flips back to `pending` then `uploading`.
- **Verify upload landed.** After `done`, close or keep the dialog and assert the admin grid now shows a tile with the uploaded title. Open the new photo's lightbox — the `<img>` loads from `/api/image/<r2Key>` and the title/caption you set are visible.
- **Proof.** Snapshot the admin grid and the new photo's detail/lightbox: `npx agent-browser snapshot > .pi/skills/verify-photo/artifacts/admin-upload/grid.aria.txt` and `npx agent-browser screenshot .pi/skills/verify-photo/artifacts/admin-upload/grid.png`.

## Gotchas

- File bytes live only in `fileStore` keyed by `${name}:${size}` — the Model is serializable. A page reload mid-queue loses bytes; expect `FailedUploadItem: uploaded bytes are gone` if you navigated away before Start.
- `previewStore` object URLs are client-side only. Assert the row shows a preview image element, not a specific URL value which is ephemeral.
- R2 key is `originals/<id>-<slug>.<ext>` with deterministic de-conflict suffix on slug collision — do not assert r2Key equals `originals/<slug>.jpg`.
- Title is required and slug is derived from title via `slugify` (max 80 chars, falls back to `untitled`). The UI disables Start when title is empty.
