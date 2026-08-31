# Tag management

Tag management lets the owner create free-form grouping labels, see each Tag alongside its photo count in the admin filter bar, filter the grid to one Tag at a time, and delete a Tag while seeing its chips disappear from cards without a full reload.

## Sub-features

- `tag-list` lists all Tags ordered by label.
- `tag-create-manager` creates a Tag from the TagManager bar.
- `tag-create-combo` creates a Tag inline from draft or upload Multi combos via `create:<label>` pseudo-entry.
- `tag-filter` filters the grid by one Tag slug and shows the result line with count.
- `tag-delete` removes a Tag and refreshes both tags and filtered photos.

## How to get to it (user POV)

- Open `http://localhost:5173/admin` at http://localhost:5173/admin — the filter bar shows every Tag as a chip with a count when unfiltered, or as a single active chip when filtered.
- Use the TagManager inline form to type a new label and create it.
- Open any Photo's edit Sheet or the upload Dialog; in their Tag Multi combo type a new label and choose the `create:<label>` row to create it in place.
- Choose a chip to filter the grid to that Tag. Clear the filter to see all Photos again.
- Choose the delete affordance on a Tag and confirm.

## Driving it with agent-browser

Preconditions:

- App is healthy at `http://localhost:5173/admin` at http://localhost:5173/admin.
- At least one Photo exists so counts are meaningful.
- `.cursor/skills/verify-photo/scripts/doctor.sh` passes.
- No Tag with slug `verify-tag` exists at start.

- **List tags.** Observe the filter bar. Run `npx agent-browser snapshot` — it contains one button per Tag label, each with its count in parentheses when unfiltered, ordered alphabetically by label.
- **Create via manager.** Create from the filter bar. Run `npx agent-browser fill --role textbox --name "New tag" --value "Verify Tag"` and `npx agent-browser click --role button --name "Create tag"`. The new chip `Verify Tag` appears at the correct sorted position and is immediately usable as a filter.
- **Create via combo.** Create inline from a Multi picker. Run `BASE="${BASE:-http://localhost:5173}" npx agent-browser open "$BASE/admin"`, open an edit Sheet (`OpenEdit`), fill its combo with a non-existent label e.g. `Verify Tag 2`, choose the option whose name is `create:Verify Tag 2`. The `CreateTagRequested{source:"draft"}` flow creates on `/api/admin/rpc` and immediately selects the new Tag — chip appears without a manual second pick. Same for upload Dialog with `source:"upload"`.
- **Create error cases.** Empty label shows a validation toast and no chip is added; duplicate label (same slug via `slugify`) shows a `SlugConflict` toast, no chip added.
- **Filter by tag.** Filter the grid. Run `npx agent-browser click --role button --name "Verify Tag"` — chip gains selected style, grid shows only Photos tagged `Verify Tag`, result line reads `N photos · filtered by "Verify Tag"`.
- **Clear filter.** Choose the same chip again. Filter resets, chips return to count view, result line drops the `filtered by` suffix.
- **Delete tag.** Delete the verify tag. Run `npx agent-browser click --role button --name "Delete Verify Tag"` then `npx agent-browser click --role button --name "Confirm"` — the chip disappears and Photos that only had that tag lose the chip instantly.
- **Propagation.** After delete, no card shows the deleted Tag label. Re-filter or snapshot the grid to confirm.
- **Proof.** Capture unfiltered and filtered states plus the manager form: `npx agent-browser snapshot > .cursor/skills/verify-photo/artifacts/tag-management/unfiltered.aria.txt` and `filtered.aria.txt` with matching `npx agent-browser screenshot` .png.

## Gotchas

- TagManager counts only describe the loaded result set (first 60). A larger gallery with pages beyond 60 will show undercount — not a bug, just the viewport of verification.
- A filtered view keeps the same chip list but hides counts and replaces them with active styling. Do not assert count text while filtered.
- Deleting the active tag clears the filter to the unfiltered set — snapshot again to confirm counts return.
- Slug is normalized via `slugify` (max 80, fallback `untitled`). The label retains original trimming and spacing as typed.
