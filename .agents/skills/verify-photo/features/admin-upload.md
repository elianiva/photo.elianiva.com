# Admin upload

Admin upload lets the single owner drop original image files, assign Tags and an optional takenAt, have the server extract dimensions and EXIF, store bytes once in R2 at `originals/<id>-<slug>.<ext>` and metadata in D1, and see the new Photo in the Library without a second round-trip.

## Sub-features

- `upload-open` opens the upload dialog from the admin header.
- `upload-queue` enqueues files with per-item status pending/uploading/processing/done/failed and fileStore bytes keyed by `${name}:${size}`.
- `upload-send` POSTs each queued file as multipart to `/upload` with blurhash, tagIds, takenAt, `publishWhenReady` and `useExportDefaults`, one at a time, over `XMLHttpRequest` so `upload.onprogress` can fill the row's bar.
- `upload-cancel` tears the in-flight subscription down (aborting the request) and leaves remaining items pending.
- `upload-retry` retries a single failed item or all failed items.

## How to get to it (user POV)

- Open `http://localhost:5173/admin` and choose `Upload` in the header.
- Drop files onto the FileDrop area or use the file picker. Set Tags via the upload combo (`create:<label>` appears when typed text matches no existing label) and optionally a takenAt.
- Choose `Add N to drafts` to send the queue. While uploading, the header shows `Uploading done/batchTotal` even after the dialog closes.

## Driving it with agent-browser

Preconditions:

- App is healthy at `http://localhost:5173/admin` at http://localhost:5173/admin.
- No Photo with slug `verify-upload` exists.
- `.cursor/skills/verify-photo/scripts/doctor.sh` passes.
- A small JPEG is available at `/tmp/verify-sample.jpg` (create via `scripts/seed.ts` tiny JPEG bytes or any 10KB jpeg).

- **Open dialog.** Choose the header upload action. Run `BASE="${BASE:-http://localhost:5173}" npx agent-browser open "$BASE/admin"` and `npx agent-browser click --role button --name "Upload"`. A dialog with FileDrop appears; `Add 0 to drafts` is disabled while queue is empty.
- **Enqueue files.** Drop a file. Run `npx agent-browser` file-drop action or use the system picker on the FileDrop role. The queue shows one row named after the file with `pending` status and an object-URL preview (from `previewStore`). Enqueue up to 50 files, each <= 80MB — beyond that the FileDrop validation rejects and the row shows `failed`. Inputs are **JPEG only**: HEIC, TIFF, PNG and WebP are refused by the Worker (`isJpegUpload` / `hasJpegMagic`).
- **Pick tags on upload.** Assign tags before sending. Open the upload combo, type an existing label and select it, then verify the chip row shows the label. Run `npx agent-browser fill --role combobox --name "Tags" --value "Kyoto"` and `npx agent-browser click --role option --name "Kyoto"`.
- **Send queue.** Start the run. Run `npx agent-browser click --role button --name "Add 4 to drafts"`. The first item flips to `uploading` with a filled bar and a `13.2 of 21.3 MB · 3:2 · 6000 × 4000` readout; on success it flips to `done` and the new photo appears in the Library without a reload. The header shows `Uploading done/batchTotal` while the queue drains. A failure flips its row to `failed` (the server's reason, e.g. `Unsupported ratio 1:1`, in accent) and does not stop the remaining files.
- **Cancel run.** During a multi-file run, stop the run. Run `npx agent-browser click --role button --name "Cancel"` (sends `CancelUploads`). The in-flight subscription tears down, the request aborts, and remaining items stay `pending`.
- **Retry.** After a failure, retry one item or all failed. Run `npx agent-browser click --role button --name "Retry"` on a failed row or `Retry all (1)` — the failed row flips back to `pending` then `uploading`.
- **Verify upload landed.** After `done`, close or keep the dialog and assert the Library now shows the uploaded title (switch to `Grid view` to see its tile). Open the new Photo in the Editor — the Stage's `<img>` loads from the API Worker's `/api/image/<r2Key>` and the title you set is visible.
- **Proof.** Snapshot the Library and the new Photo's Editor route: `npx agent-browser snapshot > .cursor/skills/verify-photo/artifacts/admin-upload/grid.aria.txt` and `npx agent-browser screenshot .cursor/skills/verify-photo/artifacts/admin-upload/grid.png`.

## Gotchas

- File bytes live only in `fileStore` keyed by `${name}:${size}` — the Model is serializable. A page reload mid-queue loses bytes; expect `FailedUploadItem: uploaded bytes are gone` if you navigated away before Start.
- `previewStore` object URLs are client-side only. Assert the row shows a preview image element, not a specific URL value which is ephemeral.
- R2 key is `originals/<id>-<slug>.<ext>` with deterministic de-conflict suffix on slug collision — do not assert r2Key equals `originals/<slug>.jpg`.
- Title is required and slug is derived from title via `slugify` (max 80 chars, falls back to `untitled`). The UI disables Start when title is empty.
