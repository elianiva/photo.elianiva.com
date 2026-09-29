# photo.elianiva.com

A curated photography showcase — the author's selected works. Image delivery is CDN-backed (R2 plus Cloudflare image resizing), metadata and files are managed together in a single custom admin on `photo.elianiva.com/admin` (Cloudflare Access OTP-gated).

## Language

**Admin**:
The single-user management surface at `/admin` — browse, upload, edit, and delete Photos and Tags. Not a multi-user CMS; there is exactly one operator (the owner), gated by Cloudflare Access. The design's name for it, _The Desk_, is a visual brand, not a term.
_Avoid_: Dashboard, CMS, Studio, Backend, The Desk

**Photo**:
A curated work — a single image file (stored once in R2) plus its metadata. The unit the site showcases. Photos live in a flat list (no hierarchy); grouping is via Tags. Essential queryable fields are real columns (`title`, `takenAt`, dimensions, `r2Key`); the rest lives in a JSON `metadata` blob for cheap extensibility. The one carve-out from that rule is the four EXIF facts the public Exif line prints — `aperture`, `shutter`, `iso`, `focalLength` — which are columns because a formatted number has a type the boundary can check and a range it can validate; the blob keeps free-form strings like the caption, the place, and the camera body. Every one of the four is nullable, and a missing fact is omitted from the Exif line rather than invented.
_Avoid_: Image (use only for raw bytes/technical context), picture, shot

**Photo Number**:
A Photo's site-wide serial. One monotonic counter, assigned once at upload, unique across the site, and never reused — not by a deleted Photo, and not by a trashed one. A Photo keeps its number through soft delete and restore. What the number is _titled_ in public copy is not settled.
_Avoid_: ID (that is the ULID), ordinal, row number, index, page number

**Status**:
Where a Photo sits in the publish lifecycle: `draft`, `published`, or `failed`. Only `published` Photos are readable on the public site. `failed` marks a Photo whose processing did not finish. `scheduled` is not a fourth value — it is a display-only label over `draft` for a Photo with a future publish time, and nothing promotes it yet, so a Scheduled Photo is still a Draft.
_Avoid_: Visibility, stage, state, Published (that is one value of Status, not the term)

**Ratio**:
A Photo's frame proportion, always one of six supported values: `3:2`, `2:3`, `4:3`, `3:4`, `16:9`, `9:16`. The author sets it in the Editor's crop, and an incoming file is snapped to the nearest supported value at upload. The source file's own proportions stop mattering once a crop is authored.
_Avoid_: Aspect ratio, orientation, dimensions (those are the measured `width` and `height`)

**Crop**:
The window a Photo is presented through, authored in the Editor. `cropX` and `cropY` pan the source inside the Ratio, `cropScale` zooms it, and `level` is the straighten angle in degrees. The defaults — pan at origin, scale 1, no level — mean an un-cropped Photo is the source as shot. A crop is authored data, so it is stored as columns and the Rendition is regenerated from it, never beside it.
_Avoid_: Resize, Zoom (that is the Stage's own control), Aspect ratio (that is the Ratio)

**Mat**:
The border the Editor draws around a Photo, outside its crop, before a Rendition is produced. The design heads its panel `BORDER`, labels its rows `Mat Colour` and `Mat Style`, and names the wrapper on the Stage `Mat` — one thing under two words. The schema and the code say `borderEnabled`, `borderStyle`, `borderColour`, `borderWidth`, following the heading the operator actually sees; `mat` appears only in the `color.mat.*` token names. Its colour is `white`, `paper` or `ink` and its style is `even`, `gallery` or `square`, taken from the design's swatches and segments.
_Avoid_: Frame (that is display copy), Padding, Margin, Mounter

**Rendition**:
A derived image file produced from a Photo's original. There are exactly two: `PREVIEW` (the long edge the Export panel sets, used by the library, the grid, and the public pages) and `FULL` (the presentation-sized export). A Rendition is regenerated whenever the crop, mat, level, or export settings change. The original in R2 is not a Rendition, and Renditions are never hand-placed in R2 outside the regeneration path.
_Avoid_: Derivative, thumbnail, variant, export (the export is the action; the file it produces is a Rendition)

**Tag**:
A label for grouping/filtering Photos (e.g., `kyoto`, `film`, `portrait`). Free-form, many-to-many with Photo. Has `slug` (URL-safe, unique), `label` (the name) and an optional `caption` (the one-line sentence the public Series page prints under it, e.g. `Ferries, rain, and the long light on Istiklal.`). A Tag with no caption has `null` there, never an empty string. Managed from day one; no controlled vocabulary.
_Avoid_: Collection (deferred), Category, Album

**Image**:
Raw file bytes / technical artifact. Not a domain term — use Photo for the showcased work.
_Avoid_: Photo (when you mean the file alone)

**Blurhash**:
A tiny string encoding a Photo's average color layout, encoded client-side at upload (only the browser can decode pixels) and stored on the Photo. The public gallery decodes it into a placeholder tile — no image bytes are fetched until the visitor opens the lightbox, which shows the original HD file on plain white.
_Avoid_: Placeholder image, thumbnail (the gallery no longer loads thumbnails)

**Frame**:
Not a domain term. The design says `412 FRAMES`, and the public Archive counts them in frames — `Nineteen frames this summer, four hundred and twelve in all.` That is display copy. Code, schema, and RPC all say Photo.
_Avoid_: Frame (as a type, column, or RPC field), Print, Plate

**Archive**:
The public chronological index of every published Photo at `/archive`, grouped by year and month and listed in the Folio nav. It is a read of the Photo list, not a stored entity — there is no archive table.
_Avoid_: Storage (that is the Admin's block), Library (that is the Admin's), Collection, Set

**Storage**:
The Admin Settings block reporting how full the bucket is and how long the Trash keeps. It shows the frame count, the byte total against the quota, the CSV index, and the RETAIN setting. A measurement and a retention policy, not a place and not an archive of content.
_Avoid_: Archive (that is the public page), Library, Backup, Sync

**Settings**:
The Admin's single-row singleton, read by the Editor's export defaults, the public Masthead, the Folio nav and the Colophon. One row, `id` pinned to 1. Its `updatedAt` is what the Settings header's `SAVED 2 MINUTES AGO` reports.
_Avoid_: Config, Preferences, Options, Site settings (the row and the page are the same thing)

**Site Section**:
One entry in the public Folio nav, authored as an ordered list in Settings. A Section is `{ label, kind, target }`: `kind` is `all` (the Front itself, and the only kind with no `target`), `tag` or `series` (a Tag's slug — a Series page _is_ a Tag page, see ADR 0008), or `page` (a page name). Stored as a JSON array on the Settings row; there is no sections table. The design draws `SECTIONS` as one `ALL · STREET · LANDSCAPE · SERIES · ABOUT` string, which cannot be routed, so the Settings UI is an ordered repeater instead — a deliberate, recorded deviation.
_Avoid_: Nav item, menu, link, category

**Route**:
What a URL in the Admin's address space means — `Library`, `Drafts`, `Settings`, `Photo`, or `NotFound` — declared once in `admin/route.ts`. The route is the whole of a URL's meaning in the Admin, so anything a URL decides (which page is drawn, which branch of the broadsheet it is drawn in) is read off the route and never off a second copy of the path.
_Avoid_: path prefix, pathname matching outside the route table, screen

**Collection** _(deferred)_:
Previously: a curated group of Photos (e.g., "Kyoto 2024"). Replaced by flat list + Tags for v1. Kept as a deferred term; reintroduce only if you need ordered, titled groupings with a cover.
_Avoid_: Album, Gallery, Series, Set

**Cover Photo** _(deferred)_:
Previously: the representative Photo of a Collection. Deferred with Collection.
_Avoid_: Hero image, featured image

## Design language

**Broadsheet**:
The visual system the whole site is drawn in, vendored as
`packages/web/design/broadsheet.gen.yaml` and emitted as tokens by
`packages/web/scripts/generate-design-tokens.mjs`. Paper, ink, hairline rules,
a kicker/exif/deck type hierarchy, and no rounded corners on the Desk's
controls. It ships as tokens, never as values in a component.
_Avoid_: shadcn defaults, pill buttons, card shadows

**Role token**:
A colour in the broadsheet, named by what it does rather than what it looks
like — `color.surface`, `color.hairline`, `color.text.secondary`. Reached in
CSS as a `role-*` custom property (`bg-role-surface`), and in TypeScript where
a stylesheet cannot reach, through the generated `lib/design-tokens.ts`. Every
colour on the site is a role token; a hex literal in Desk code is a defect and
`design-tokens.test.ts` fails the build on one.
_Avoid_: palette colour (`neutral-500`), shadcn name (`--muted-foreground`) in Desk code

**Contract name**:
A shadcn semantic name (`--background`, `--muted-foreground`, `--ring`) bound
to a broadsheet role. It exists so the vendored foldcn registry keeps its
vocabulary; Desk code says the role, not the contract name.
_Avoid_: extending the contract with a name broadsheet does not have

**Theme scope**:
The element a broadsheet branch is named on: `data-theme="light" | "dark"`,
with `.dark` on the document root the same generated block spelled as a class.
The branch is a function of the Admin's **Route** and of nothing else, so the
view names it on the app root and the HTML shell names it on `<html>` — the
only element there is before the app has run. The Library (`/admin`) is light;
the Editor (`/admin/photos/:id`) is dark in the same document.
_Avoid_: a path prefix for the Editor, toggling the theme after mount, a second
hand-written dark palette
