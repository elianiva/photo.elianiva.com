# Admin edit and delete photo

Admin edit and delete lets the owner open any Photo in an edit Sheet, change titled fields and JSON metadata plus tag membership, save and see the grid re-ordered by takenAt DESC, and delete a Photo with confirmation while best-effort deleting its R2 original.

## Sub-features

- `edit-open` opens the edit Sheet for a specific Photo with draft prefilled.
- `edit-draft` edits title, slug, takenAt, and metadata fields caption/location/camera/lens.
- `edit-tags` changes membership via the draft Multi combo plus RemoveDraftTag chip dismiss.
- `edit-save` persists via UpdatePhoto RPC and re-fetches the first page so ordering stays truthful.
- `delete-photo` removes a Photo via DeletePhoto RPC with a confirm dialog.
- `edit-grid-cols` toggles admin grid density 2..6 and persists to localStorage `photo-admin:cols`.

## How to get to it (user POV)

- Open `http://127.0.0.1:13370/admin`, choose any Photo tile or its edit affordance.
- In the Sheet, edit text fields, pick or create Tags via the Multi combo, remove chips with the dismiss button, set a takenAt date string, then choose Save.
- Choose the delete affordance on a Photo and confirm in the AlertDialog.
- Choose a column count 2..6 in the header toggle.

## Driving it with agent-browser

Preconditions:

- App is healthy at `http://127.0.0.1:13370/admin`.
- At least one Photo exists. Create one via upload or seed named `verify-edit` if needed.
- `.pi/skills/verify-photo/scripts/doctor.sh` passes.
- Sheet is closed at start (editingId undefined).

- **Open edit.** Choose the Photo to edit. Run `npx agent-browser open http://127.0.0.1:13370/admin` and `npx agent-browser click --role button --name "Edit <photo title>"` or click the tile then `OpenEdit` affordance. A Sheet appears with heading `Edit photo`, fields prefilled with title/slug/takenAt/caption/location/camera/lens, draftTagIds reflecting current tags, and the draft Multi combo showing those chips.
- **Edit fields.** Change one draft field. Run `npx agent-browser fill --role textbox --name "Title" --value "Verify Edit New Title"` and `npx agent-browser fill --role textbox --name "Slug" --value "verify-edit-new"` and `npx agent-browser fill --role textbox --name "Taken at" --value "2024-02-01T10:00:00.000Z"`. Each fill dispatches `SetDraftField` with the matching field enum.
- **Metadata fields.** Update JSON metadata via the four textboxes for caption/location/camera/lens. Run `npx agent-browser fill --role textbox --name "Caption" --value "verify caption"` — on save these four non-empty strings are packaged as `metadata` object; an empty string omits the key.
- **Tag membership.** Pick a Tag via the combo and remove a Tag via chip dismiss. Run `npx agent-browser fill --role combobox --name "Tags" --value "Kyoto"` and `npx agent-browser click --role option --name "Kyoto"` to add, then `npx agent-browser click --role button --name "Remove Kyoto"` to remove. The `create:VerifyNew` pseudo-item appears when typed text matches no existing label and dispatches `CreateTagRequested{source:"draft"}`.
- **Save.** Persist the draft. Run `npx agent-browser click --role button --name "Save changes"` (dispatches `SaveEdits`). The button shows saving spinner while `saving===true`. On success the Sheet closes and the grid re-fetches the first page (N=60) ordered by takenAt DESC — the edited Photo may have moved.
- **Verify save.** Re-read the Photo via RPC. Run `.pi/skills/verify-photo/scripts/rpc.sh GetPhoto '{"id":"<photoId>"}'` and assert title/slug/takenAt/metadata/tags match the draft. Also run `.pi/skills/verify-photo/scripts/rpc.sh ListPhotos '{"limit":60}'` and confirm id still present with updated fields.
- **RPC direct drive.** Drive the same mutation without the UI. Run `.pi/skills/verify-photo/scripts/rpc.sh UpdatePhoto '{"id":"<id>","title":"Verify Edit New Title","slug":"verify-edit-new","takenAt":"2024-02-01T10:00:00.000Z","metadata":{"caption":"verify caption"},"tagIds":["<tagId>"]}'`. Expect success with PhotoWithTags. An empty update `{"id":"<id>"}` returns `InvalidInput: empty update`. A conflicting slug returns `SlugConflict`.
- **Delete.** Delete with confirmation. Run `npx agent-browser click --role button --name "Delete <photo title>"` then `npx agent-browser click --role button --name "Confirm"` in the confirm Dialog. The Photo disappears from the grid; remaining Photos reflow. RPC direct: `.pi/skills/verify-photo/scripts/rpc.sh DeletePhoto '{"id":"<id>"}'` returns true; subsequent `GetPhoto` for that id returns `PhotoNotFound`.
- **Grid density.** Toggle columns. Run `npx agent-browser click --role button --name "4 columns"` — button gains `aria-pressed="true"`, grid re-renders with 4 columns, `localStorage["photo-admin:cols"]==="4"` and a `PersistCols` command fires silently. Reload the page and count persists.
- **Proof.** Capture Sheet open and post-save states. Run `npx agent-browser snapshot --aria --path .pi/skills/verify-photo/artifacts/admin-edit-delete/sheet.aria.txt` and `screenshot` plus save UpdatePhoto JSON to `artifacts/admin-edit-delete/update.json` and ListPhotos JSON to `artifacts/admin-edit-delete/list.json`.

## Gotchas

- UpdatePhoto requires at least one of title/slug/takenAt/metadata/tagIds — empty patch is `InvalidInput: empty update`.
- Slug is normalized via `slugify` (lowercase, `[^a-z0-9]+` → `-`, trim to 80, fallback `untitled`). Assert the normalized slug, not the raw input.
- takenAt `""` is sent as `null` to D1 and decoded as `takenAt: undefined` on `PhotoWithTags`. Do not expect empty string round-trip.
- Deleting a Photo best-effort deletes its R2 object (`gateway.photos.delete`) but swallows the error via `orElseSucceed` — a 200 DeletePhoto does not guarantee R2 absence.
- Sheet and upload Dialog use distinct stores (`Sheet.Model` vs `Dialog.Model` + `FileDrop.Model`). Opening one does not close the other — snapshot both independently.
