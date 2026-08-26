# photo.elianiva.com

A curated photography showcase — the author's selected works. Image delivery is CDN-backed (R2 + Images), metadata and files are managed together in a single custom admin on `photo.elianiva.com/admin` (Cloudflare Access OTP-gated).

## Language

**Admin**:
The single-user management surface at `/admin` — browse, upload, edit, and delete Photos and Tags. Not a multi-user CMS; there is exactly one operator (the owner), gated by Cloudflare Access.
_Avoid_: Dashboard, CMS, Studio, Backend

**Photo**:
A curated work — a single image file (stored once in R2) plus its metadata. The unit the site showcases. Photos live in a flat list (no hierarchy); grouping is via Tags. Essential queryable fields are real columns (`title`, `takenAt`, dimensions, `r2Key`); the rest lives in a JSON `metadata` blob for cheap extensibility.
_Avoid_: Image (use only for raw bytes/technical context), picture, shot

**Tag**:
A label for grouping/filtering Photos (e.g., `kyoto`, `film`, `portrait`). Free-form, many-to-many with Photo. Has `slug` (URL-safe, unique) and `label` (display). Managed from day one; no controlled vocabulary.
_Avoid_: Collection (deferred), Category, Album

**Image**:
Raw file bytes / technical artifact. Not a domain term — use Photo for the showcased work.
_Avoid_: Photo (when you mean the file alone)

**Blurhash**:
A tiny string encoding a Photo's average color layout, encoded client-side at upload (only the browser can decode pixels) and stored on the Photo. The public gallery decodes it into a placeholder tile — no image bytes are fetched until the visitor opens the lightbox, which shows the original HD file on plain white.
_Avoid_: Placeholder image, thumbnail (the gallery no longer loads thumbnails)

**Collection** _(deferred)_:
Previously: a curated group of Photos (e.g., "Kyoto 2024"). Replaced by flat list + Tags for v1. Kept as a deferred term; reintroduce only if you need ordered, titled groupings with a cover.
_Avoid_: Album, Gallery, Series, Set

**Cover Photo** _(deferred)_:
Previously: the representative Photo of a Collection. Deferred with Collection.
_Avoid_: Hero image, featured image
