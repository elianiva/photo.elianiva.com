# Storage: R2 originals, D1, a flat Photo list, no CMS, no resizer

Accepted.

## No CMS

Image bytes and metadata are managed together by an admin in this repo, over R2
and D1. Sanity, Directus, Cloudinary and R2 + Images were all evaluated on
Aug 2026 pricing against the constraint "single place + UI + scriptable + free":
Sanity Free's 5 GB asset ceiling fills fast with RAWs, Cloudinary's 25 credits
couple storage, bandwidth and transforms into one number, and R2 + Images is
the cheapest at scale but has no CMS UI and needs a head built on top. Directus
self-hosted over an R2 S3 driver was the runner-up and lost only on needing its
own host. One vendor fewer, no free-tier cliff, and the admin is CRUD over R2
and D1 once the domain schemas are already here.

## The model

- **A flat Photo list.** No Collection hierarchy for v1; `Collection` and
  `Cover Photo` are deferred terms in `CONTEXT.md`, not half-built tables.
- **Grouping is Tags** — `tags` (`slug`, `label`, `caption`) and a
  `photo_tags` join carrying `ON DELETE CASCADE`, many-to-many from day one so
  tag-scoped queries and renames are cheap. A JSON array on the Photo was
  rejected: it cannot back real filtering without a migration.
- **Columns for what is queried.** `id` (ULID), `slug` (unique, editable),
  `title`, `r2Key`, `width`, `height`, `takenAt`, `status`, `deletedAt`,
  `photoNumber`, `blurhash`, the crop/level/border columns and the four EXIF
  facts the public Exif line prints. Everything else — caption, location,
  camera, lens — is one JSON `metadata` column, promoted out of it only when it
  becomes filterable or sortable. The EXIF four are columns for a sharper
  reason: a formatted number has a type the boundary can check and a range it
  can validate, which a free-form blob does not.
- **One original per Photo**, at `originals/{id}-{slug}.jpg`, plus its two WebP renditions (below). JPEG only — the
  declared MIME, the bytes' own SOI marker and the stored key are three checks
  on one format list. Width and height are extracted at upload.
- **Fresh resources.** Bucket `photo-elianiva-originals`, D1
  `photo-elianiva`, `migrations/*.sql`. Nothing adopted from `elianiva.com`:
  a photography bucket is not this site's.
- **Auth is Cloudflare Access** (OTP IdP, an allowlist of one email). No app
  login form exists anywhere in the product (ADR 0006).

## Image delivery: three files, made in the browser

Every Photo is three files in R2:

| file      | what                                    | used for                          |
| --------- | --------------------------------------- | --------------------------------- |
| `small`   | WebP, 1600 px long edge, quality 90     | Library, grids, public frontpage  |
| `preview` | WebP, the original's pixels, quality 90 | what a click opens (the lightbox) |
| `full`    | the original JPEG, untouched            | the Editor's Download             |

All three are served from R2 through the Worker's `/api/image/<key>` proxy.

**There is still no zone resizer.** Cloudflare zone image resizing
(`/cdn-cgi/image/…`) is plan-gated and this zone is on the Free plan, so every
request to it answers 404; nothing may reintroduce `thumbUrl`, `srcSet` or that
path. What replaces it is not a server transform but **client-side
processing**: the Admin decodes the JPEG in a Web Worker (jsquash: Lanczos3
resize, WebP/JPEG/PNG encode), produces `small` and `preview`, and uploads all
three in one multipart request. The Worker never decodes pixels; it validates
the declared type and the bytes' own magic (JPEG SOI, WebP `RIFF…WEBP`) and
stores. The same pipeline powers Download: the browser fetches the original and
re-encodes it at any width, frame and border the operator picks. The server's
work per photo is one write of three objects and, later, one read.

The two WebP keys are derived from the Photo's id (`renditionKey` in
`@photo/shared`) rather than stored, so no column can disagree with an object.
The pipeline is an Effect service (`ImagePipeline`): a bounded pool of
short-lived Workers, typed errors, interruption that terminates the Worker, and
a per-item preparation fiber so the upload queue works ahead of itself.

## Consequences

- Nothing but `/api/upload` writes to R2, and an object is never overwritten
  in place.
- `handleImageProxy` accepts only `originals/` and `renditions/` keys, and serves them
  `immutable` for a year, which is honest about a key that never changes.
- Adding a filterable metadata field is an `ALTER TABLE` when it earns one, and
  a JSON key when it does not.
