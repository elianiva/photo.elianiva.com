# Admin open in the Editor, view toggle, grid density and delete

Admin library is one read with two views — a table and a square-tile grid — chosen by a toggle that lives in the URL (`/admin?view=grid`), with the grid's column count (2–6) persisted to `localStorage["photo-admin:library:cols"]`. A tile (and its `Edit`) opens the **Editor route** `/admin/photos/<id>` — the retired lightbox/edit-Sheet path is gone — and `Delete` (tile overlay or row `⋯`) moves the Photo to the Trash through the shared confirm Dialog.

## Sub-features

- `grid-view` switches the Library to square tiles; the URL becomes `/admin?view=grid`, and a reload restores it.
- `list-view` switches back to the table; the view is named by omission, so the URL is `/admin`.
- `grid-cols` picks 2–6 columns in grid view and persists them to `localStorage["photo-admin:library:cols"]`.
- `open-editor` opens `/admin/photos/<id>` from a tile or the table row's pencil.
- `delete-photo` moves a Photo to the Trash through the confirm Dialog.

## How to get to it (user POV)

- Open `http://localhost:5173/admin`, then click `Grid view` at the top right of the Library.
- In grid view, click a tile (or its `Edit`) to land on the Editor route for that Photo.
- In grid view, click a tile's `Delete`, or the table row's `⋯` → `Move to Trash`, and confirm.

## Driving it with agent-browser

Preconditions:

- App is healthy at `http://localhost:5173/admin`.
- At least one Photo exists. Create one via upload or seed named `verify-edit` if needed.
- `.agents/skills/verify-photo/scripts/doctor.sh` passes.

- **Switch to the grid.** Run `BASE="${BASE:-http://localhost:5173}" npx agent-browser open "$BASE/admin"` and `npx agent-browser click --role button --name "Grid view"`. The URL becomes `$BASE/admin?view=grid`, the `Grid view` button gains `aria-pressed="true"` and the `List view` button `aria-pressed="false"`, `[data-slot="library-grid"]` appears, and `[data-slot="library-table"]` disappears.
- **Reload keeps the view.** Run `npx agent-browser open "$BASE/admin?view=grid"`. The grid renders again — the view is URL state, not a transient.
- **Columns persist.** Run `npx agent-browser click --role button --name "4 columns"`. The button gains `aria-pressed="true"`, `[data-slot="library-grid"]` re-renders with a 4-column `grid-template-columns`, and `localStorage["photo-admin:library:cols"] === "4"` (the old `photo-admin:cols` key is gone). Reload and the count persists.
- **Open the Editor.** Run `npx agent-browser click --role button --name "Open <photo title>"` (or the table row's `Edit <photo title>`). The URL becomes `$BASE/admin/photos/<id>`, the Editor document renders (`data-slot="mat"`, no sidebar), and no dialog or overlay opens.
- **Back to the view you left.** In the Editor, run `npx agent-browser click --role link --name "Library"`. You land back on `/admin?view=grid` — the route the Editor was opened from.
- **Delete.** Run `npx agent-browser click --role button --name "Delete"` on a tile (or `More actions for <title>` → `Move to Trash`), then confirm with `Yes, move to Trash`. The Photo leaves the view. Reload the Library and assert the title is gone.
- **Proof.** Capture the grid, the toggled URL, and the Editor route. Run `npx agent-browser snapshot > .agents/skills/verify-photo/artifacts/admin-library-grid/grid.aria.txt` and `npx agent-browser screenshot .agents/skills/verify-photo/artifacts/admin-library-grid/grid.png`, then the same for the Editor route.

## Gotchas

- A tile click and its `Edit` are the same destination (the Editor route); there is no lightbox and no edit Sheet in the Admin any more. If you see one, you are on a stale build.
- The view toggle uses `replaceUrl`, so the back button does not walk through every mode you clicked through. Do not assert a history step for it.
- The URL is the authority for the view: `/admin` is the list, `/admin?view=grid` is the grid. `ToggledTagFilter` and the search box do not change the view.
- `Tiles render with blurhash placeholders` — the placeholder is an inline `background-image` on the tile, set only for Photos whose `blurhash` is non-null; a null-blurhash Photo falls back to `color.surface.container`.
- Metadata editing (title, slug, tags) is not on this path yet; the Editor route is where it will land.
