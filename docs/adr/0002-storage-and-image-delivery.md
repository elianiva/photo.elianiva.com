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
- **One original per Photo**, at `originals/{id}-{slug}.jpg`. JPEG only — the
  declared MIME, the bytes' own SOI marker and the stored key are three checks
  on one format list. Width and height are extracted at upload.
- **Fresh resources.** Bucket `photo-elianiva-originals`, D1
  `photo-elianiva`, `migrations/*.sql`. Nothing adopted from `elianiva.com`:
  a photography bucket is not this site's.
- **Auth is Cloudflare Access** (OTP IdP, an allowlist of one email). No app
  login form exists anywhere in the product (ADR 0006).

## Image delivery: the original's bytes, or nothing

Every image — the home page's photos, the Library's grid, the Editor's stage — is
the Photo's original, served from R2 through the Worker's `/api/image/<key>`
proxy and cropped to its Ratio by the photo's own `aspect-ratio` box.

**There is no resizer.** Cloudflare zone image resizing
(`/cdn-cgi/image/width=…/image/<key>`) is plan-gated, and this zone is on the
Free plan, where `image_resizing` reports `editable: false` — every request to
it answers 404, on either host, for any width. The `IMAGES` binding that
`alchemy.run.ts` declared and `WebsiteEnv` typed as `unknown` was read by
nothing and has been removed rather than adopted. So have `thumbUrl`, `srcSet`
and every other URL builder for that path: a builder for a delivery path that
cannot work is worse than no builder, because the 404 surfaces as a missing
photograph rather than as a mistake.

The trade is honest and worth naming: a grid of forty photos asks for forty
originals. Stored **Renditions** (`CONTEXT.md`) are the designed answer;
regenerating them is a separate piece of work. A zone plan upgrade would bring
the resizer back, which is a plan decision and not a code one.

## Consequences

- Nothing but `/api/upload` writes to R2, and the original is never overwritten
  in place — a Rendition is a new object, never the same key.
- `handleImageProxy` accepts only `originals/` keys, and serves them
  `immutable` for a year, which is honest about a key that never changes.
- Adding a filterable metadata field is an `ALTER TABLE` when it earns one, and
  a JSON key when it does not.
