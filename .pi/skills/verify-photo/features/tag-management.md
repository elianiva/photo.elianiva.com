# Tag management

Tag management lets the owner create free-form grouping labels, see each Tag alongside its photo count in the admin filter bar, filter the grid to one Tag at a time, and delete a Tag while seeing its chips disappear from cards without a full reload.

## Sub-features

- `tag-list` lists all Tags ordered by label.
- `tag-create-manager` creates a Tag from the TagManager bar.
- `tag-create-combo` creates a Tag inline from draft or upload Multi combos via `create:<label>` pseudo-entry.
- `tag-filter` filters the grid by one Tag slug and shows the result line with count.
- `tag-delete` removes a Tag and refreshes both tags and filtered photos.

## How to get to it (user POV)

- Open `http://127.0.0.1:13370/admin` — the filter bar shows every Tag as a chip with a count when unfiltered, or as a single active chip when filtered.
- Use the TagManager inline form to type a new label and create it.
- Open any Photo's edit Sheet or the upload Dialog; in their Tag Multi combo type a new label and choose the `create:<label>` row to create it in place.
- Choose a chip to filter the grid to that Tag. Clear the filter to see all Photos again.
- Choose the delete affordance on a Tag and confirm.

## Driving it with agent-browser

Preconditions:

- App is healthy at `http://127.0.0.1:13370/admin`.
- At least one Photo exists so counts are meaningful.
- `.pi/skills/verify-photo/scripts/doctor.sh` passes.
- No Tag with slug `verify-tag` exists at start.

- **List tags.** Fetch ordered Tags. Run `.pi/skills/verify-photo/scripts/rpc.sh ListTags '{}'`. Response is array of `{id, slug, label}` sorted by label. UI: `npx agent-browser snapshot --aria` contains one button per Tag label, each with its count in parentheses when unfiltered.
- **Counts unfiltered.** When `activeTagSlug === undefined`, each chip shows count of matching Photos. Assert `N` for Tag `t` equals `photos.filter(p => (p.tags ?? []).some(e => e.id === t.id)).length` from `ListPhotos {"limit":60}`.
- **Create via manager.** Create from the filter bar. Run `npx agent-browser fill --role textbox --name "New tag" --value "Verify Tag"` and `npx agent-browser click --role button --name "Create tag"` (sends `CreateTagRequested{source:"manager"}`). RPC direct: `.pi/skills/verify-photo/scripts/rpc.sh CreateTag '{"slug":"verify-tag","label":"Verify Tag"}'` returns `{id, slug:"verify-tag", label:"Verify Tag"}` and appears at the correct sorted position.
- **Create via combo.** Create inline from a Multi picker. Run `npx agent-browser open http://127.0.0.1:13370/admin`, open an edit Sheet (`OpenEdit`), fill its combo with a non-existent label e.g. `Verify Tag 2`, choose the option whose name is `create:Verify Tag 2`. The `CreateTagRequested{source:"draft"}` flow creates on `/api/admin/rpc` and immediately selects the new Tag — chip appears without a manual second pick. Same for upload Dialog with `source:"upload"`.
- **Create error cases.** Empty label returns `InvalidInput: label is required`. Duplicate slug (including case-normalized via `slugify`) returns `SlugConflict`. Both surface as `FailedRpc` toast, no chip added.
- **Filter by tag.** Filter the grid. Run `npx agent-browser click --role button --name "Verify Tag"` — chip gains selected style, `activeTagSlug` becomes `verify-tag`, grid shows only Photos whose tags contain that id, result line reads `N photos · filtered by "Verify Tag"`. RPC: `.pi/skills/verify-photo/scripts/rpc.sh ListPhotos '{"tagSlug":"verify-tag","limit":60}'` returns exactly the filtered items.
- **Clear filter.** Choose the same chip again or clear via TagManager. Filter resets to `activeTagSlug === undefined`, chips return to count view, result line drops the `filtered by` suffix.
- **Delete tag.** Delete the verify tag. Run `npx agent-browser click --role button --name "Delete Verify Tag"` then `npx agent-browser click --role button --name "Confirm"` — Photos that only had that tag lose the chip instantly; `.pi/skills/verify-photo/scripts/rpc.sh DeleteTag '{"id":"<tagId>"}'` returns true, and subsequent `ListTags` no longer contains it. `DeleteTag` is idempotent — second delete of same id still returns true.
- **Propagation.** After delete, cards must not show the deleted Tag label. Assert `ListPhotos` items have `tags` arrays with no entry matching the deleted id.
- **Proof.** Capture unfiltered and filtered states plus the manager form: `npx agent-browser snapshot --aria --path .pi/skills/verify-photo/artifacts/tag-management/unfiltered.aria.txt` and `filtered.aria.txt` with matching `screenshot` plus save `ListTags` JSON to `artifacts/tag-management/tags.json` and filtered `ListPhotos` JSON to `artifacts/tag-management/filtered.json`.

## Gotchas

- TagManager counts only describe the loaded result set (first 60). A larger gallery with pages beyond 60 will show undercount — not a bug of the feature, just the viewport of verification. Use RPC with larger limit to get the true count if you need it.
- Chips render label not slug. When verifying via RPC, compare by `id` not label — labels can collide in case while slugs are unique.
- A filtered view keeps the same chip list but hides counts and replaces them with active styling. Do not assert count text while filtered.
- Deleting the active tag keeps the grid in a state where `activeTagSlug` still names the now-missing Tag — the next ListPhotos fetch returns the unfiltered set. Re-verify by re-fetching after delete with the previous `activeTagSlug`.
- Creating a Tag requires both `slug` and `label` in the RPC payload — but `slug` is normalized via `slugify` (max 80, fallback `untitled`). The `label` retains original trimming and spacing as typed.
