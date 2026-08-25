# Admin: flat Photo list, tags, JSON metadata, R2+D1, OTP, Images binding

Single-user admin at `photo.elianiva.com/admin` gated by Cloudflare Access (`onetimepin` IdP, `allow: [owner email]`, auto-gated via `Cloudflare.Access.Application` on `photo.elianiva.com/admin*`). We chose OTP only (no Google OAuth app) to avoid IdP setup; 50 seats free.

Data is a flat Photo list (no Collection hierarchy for v1; Collection deferred). Grouping is via Tags — a real many-to-many table from day one (`tags` with `slug`+`label`, `photo_tags` join) rather than a JSON array, so tag-scoped queries and rename are cheap without migrating later.

Photos store essential queryable fields as columns (`id` ULID, `slug` auto from title editable unique, `title`, `r2Key`, `width`, `height`, `takenAt`) and everything else in a JSON `metadata` column (caption, location, camera, lensOrSensor, etc.) — cheap, stupid-easy to extend without migrations; only promoted to a column when it becomes filterable/sortable.

Storage is a new R2 bucket `photo-elianiva-originals` (not reused from `elianiva.com`) + new D1 `photo` (no import; fresh start). Single original per Photo at `originals/{ulid}-{slug}.{ext}`; width/height extracted at upload. Delivery via Cloudflare Images binding transforming R2 originals on the fly (`w=400,800,1600&format=auto`) — first 5k unique transforms/mo free, then $0.50/1k. At ~200 photos × 3 sizes = 600 uniques/mo this is free; avoids storing `smol` variants. R2 free tier (10 GB, 1M writes, 10M reads, zero egress) covers the rest.

Considered: Sanity/Directus (rejected in ADR 0004; self-hosted admin is cheaper and owns the schema), Google SSO button (rejected for v1 — add later by adding a `google` IdentityProvider), `smol` two-file convention (rejected — extra files, no auto format negotiation), tags as JSON array (rejected — needs `photo_tags` table for real filtering), reusing `elianiva-photography` bucket (rejected — clean separation).

Consequences: `CONTEXT.md` demotes Collection/Cover Photo to deferred; `packages/shared` Photo schema now mirrors the D1 shape (Photo + Tag + metadata JSON); `/admin` needs a Worker `main` to enforce Access on `/admin*` while public gallery stays open.
