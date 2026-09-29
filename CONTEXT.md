# photo.elianiva.com

A curated photography showcase — the author's selected works. Image delivery is CDN-backed (R2 plus Cloudflare image resizing), metadata and files are managed together in a single custom admin on `photo.elianiva.com/admin` (Cloudflare Access OTP-gated).

## Language

**Admin**:
The single-user management surface at `/admin` — browse, upload, edit, and delete Photos and Tags. Not a multi-user CMS; there is exactly one operator (the owner), gated by Cloudflare Access. The design's name for it, _The Desk_, is a visual brand, not a term.
_Avoid_: Dashboard, CMS, Studio, Backend, The Desk

**Photo**:
A curated work — a single image file (stored once in R2) plus its metadata. The unit the site showcases. Photos live in a flat list (no hierarchy); grouping is via Tags. Essential queryable fields are real columns (`title`, `takenAt`, dimensions, `r2Key`); the rest lives in a JSON `metadata` blob for cheap extensibility.
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

**Collection** _(deferred)_:
Previously: a curated group of Photos (e.g., "Kyoto 2024"). Replaced by flat list + Tags for v1. Kept as a deferred term; reintroduce only if you need ordered, titled groupings with a cover.
_Avoid_: Album, Gallery, Series, Set

**Cover Photo** _(deferred)_:
Previously: the representative Photo of a Collection. Deferred with Collection.
_Avoid_: Hero image, featured image
