# Tag management

Tag management lets the owner create free-form grouping labels, attach them to Photographs as they are uploaded or in bulk from the Library, and read each Tag back on a row. The Admin rail carries no Tag index and no tag filter: a Tag is picked where a Photograph is given it, and nowhere else.

## Sub-features

- `tag-list` reads every Tag ordered by label (`ListTags`), which is what both pickers offer.
- `tag-create-combo` creates a Tag inline from the upload Dialog's Multi combo via a `create:<label>` pseudo-entry.
- `tag-create-error` refuses an empty label and reports a duplicate slug as `SlugConflict`.
- `tag-attach-upload` sends the ticked Tags with the upload, so the new row carries them.
- `tag-attach-bulk` applies the ticked Tags to the Library's selected rows through the Bulk Bar's `Add tag`.

## How to get to it (user POV)

- Open `http://localhost:4000/admin` at http://localhost:4000/admin.
- Open the upload Dialog; in its Tag Multi combo type a new label and choose the `create:<label>` row to create it in place. It is then selected, so the batch goes out with it.
- Tick one or more rows in the Library and choose `Add tag` in the Bulk Bar to attach an existing Tag to them.
- Read a Tag back on a row's badges, on the Card grid, and on the public Tag page at `/tag/<slug>`.

## Driving it with agent-browser

Preconditions:

- App is healthy at `http://localhost:4000/admin` at http://localhost:4000/admin.
- At least one Photo exists so attaching a Tag has rows to attach it to.
- `.agents/skills/verify-photo/scripts/doctor.sh` passes.
- No Tag with slug `verify-tag` exists at start.

- **Create via the upload combo.** Run `BASE="${BASE:-http://localhost:4000}" npx agent-browser open "$BASE/admin"`, click `Upload` to open the dialog, fill its combo with a non-existent label e.g. `Verify Tag`, and choose the option whose name is `create:Verify Tag`. The `CreateTagRequested` flow creates on the API Worker's `/api/admin/rpc` and immediately selects the new Tag — the chip row shows it without a manual second pick.
- **Create error cases.** An empty label adds no Tag; a duplicate label (same slug via `slugify`) reports `SlugConflict` and adds no Tag.
- **Attach on upload.** Send the queue with `Add N to drafts`; the new row's badges name the Tags it was sent with.
- **Attach in bulk.** Tick two rows, then `npx agent-browser click --role button --name "Add tag"`, tick `Verify Tag` in the dialog and choose `Add tag` there. Both rows carry the Tag on the next read, with no reload.
- **The rail offers no Tag index.** `npx agent-browser snapshot` on `/admin` lists `Library`, `Scheduled` and `Settings` under `Admin sections` and no tag row, and `/admin?tag=verify-tag` draws the unfiltered Library, because `tag` is no longer part of the URL's vocabulary.
- **Proof.** Capture the rail and the `Add tag` dialog: `npx agent-browser snapshot > .agents/skills/verify-photo/artifacts/tag-management/rail.aria.txt` and `add-tag.aria.txt` with matching `npx agent-browser screenshot` .png.

## Gotchas

- A Tag cannot be renamed or deleted from the Admin today; the rail's `⋯` menu was its only home. A Tag is attached on upload or in bulk, and reads back on rows and on its public page.
- A Tag with no Photographs attached is not a Folio link and answers `404` at `/tag/<slug>` — the caption and the page wait for a published Photograph.
- Slug is normalized via `slugify` (max 80, fallback `untitled`). The label retains original trimming and spacing as typed.