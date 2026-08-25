# Plan — photo.elianiva.com: simple admin instead of Sanity

> Scaffold is live at https://photo.elianiva.com (Alchemy `photo` Website.Vite, SSR with cache headers). This plan is for the next iteration: replace mock Photo/Collection with a self-hosted admin that manages files + metadata in one place.

## 0) Decision

Build a **single-user admin** inside the same monorepo instead of adopting Sanity/Directus. Rationale (see ADR 0004): free ceiling, zero new vendor, 1-day scaffold already owns the domain schemas (`@photo/shared`), and the admin is just CRUD over R2 + D1.

## 1) Architecture

```
[Browser /admin]  —Cloudflare Access gate→  Worker (photo)
                                       ├─ GET  /api/collections, /api/photos
                                       ├─ POST /api/photos (multipart → R2 + D1)
                                       ├─ PATCH /api/photos/:id, DELETE, etc
                                       └─ SSR pages (public) read from D1

R2 Bucket  "photo-originals"   (adopt: false, new)
D1 Database "photo"            (adopt: false, new — Photo + Collection tables)
Images binding (CF Images)     (transforms: w=400,800,1600&fit=cover&format=auto)
KV Namespace (optional cache)  (if D1 latency ~5ms matters; defer)
```

Alchemy (updated `alchemy.run.ts`):

```ts
const PhotosBucket = Cloudflare.R2.Bucket("photo-originals", { name: "photo-elianiva-originals" })
const PhotoDb = Cloudflare.D1.Database("photo", { name: "photo-elianiva" })
class Website extends Cloudflare.Website.Vite('photo', {
  rootDir: 'packages/web',
  domain: ['photo.elianiva.com'],
  bindings: { PHOTOS: PhotosBucket, DB: PhotoDb, IMAGES: Cloudflare.Images // or IMAGES binding
})
```

Static domain (fixed ZoneError: previous `Alchemy.Stack.useSync(stage === 'prod' ? ... : undefined)` evaluated to `undefined` outside stack context — Vite Website class options run at import time. Use `domain: ['photo.elianiva.com']` like `elianiva.com`).

## 2) Domain model (extends CONTEXT.md)

- **Photo** (`@photo/shared/src/photo.ts` already): id (ULID), slug, title, caption?, collectionId, r2Key, width, height, takenAt?, location?, camera?, lens?, exif?
- **Collection**: id, slug, title, description?, coverPhotoId?, order (int)
- **R2 key**: `originals/{collectionSlug}/{photoId}-{slug}.jpg` (content-addressed by photoId, not filename)

D1 migrations (via `d1 migrations` or Alchemy `migrate`):

```sql
CREATE TABLE collections (id TEXT PRIMARY KEY, slug TEXT UNIQUE, title TEXT, description TEXT, coverPhotoId TEXT, ord INTEGER);
CREATE TABLE photos (id TEXT PRIMARY KEY, slug TEXT, title TEXT, caption TEXT, collectionId TEXT REFERENCES collections(id), r2Key TEXT, width INT, height INT, takenAt TEXT, location TEXT);
CREATE INDEX idx_photos_collection ON photos(collectionId);
```

## 3) API (Effect in `packages/api`, consumed by `packages/web` SSR + admin)

- `GET /api/collections` → `Collection[]`
- `GET /api/collections/:slug` + `GET /api/collections/:id/photos`
- `POST /api/collections` (admin)
- `GET /api/photos/:id`
- `POST /api/photos` (admin, multipart: file + json fields → validate with `Photo` schema, `exifr` for width/height, R2 Put, D1 insert)
- `PATCH /api/photos/:id` / `DELETE`
- `POST /api/photos/bulk` (scriptable, same as single, `Authorization: Bearer $ADMIN_TOKEN` for CLI)

SSR `entry.server.ts` switches from `flagsForRequest()` mock to `Effect` fetch from `DB` (via `PhotoDb` binding passed as Effect Layer).

Images delivery: public pages render `srcset` via Images binding URL pattern — e.g. `/cdn-cgi/image/width=800,format=auto,quality=75/photos/<r2Key>` or worker fetch that proxies R2 with `cf: { image: { width } }`. No build-time Sharp.

## 4) Admin UI (`packages/web` new route `/admin`)

Foldkit route + admin guard:

- `/admin` — collection list, photo grid
- `/admin/collections/:id` — edit title/desc/cover
- `/admin/photos/:id` — edit metadata, replace file
- `/admin/upload` — dropzone (single for v1, bulk v2), progress via `Effect` `Stream`

Auth (v1): **Cloudflare Access** (`Cloudflare.Access` in alchemy) — zero app code, `Access` policy `allow: [your email]` on `photo.elianiva.com/admin*`. Alternative if you dislike Access: `ADMIN_SECRET` env + cookie session.

No pagination needed at <500 photos; add `?limit=60&cursor=` later.

## 5) Phases

**Phase 0 — done** (this PR):

- Monorepo scaffold, SSR hello world, `shared` schemas, alchemy domain fix, deploy green.

**Phase 1 — infra + data (half day):**

- Add R2 + D1 to `alchemy.run.ts`, run migration, seed 2 collections via script, update `shared` Photo to include `r2Key/width/height`.

**Phase 2 — read path (half day):**

- SSR `entry.server.ts` fetches from D1 (via API layer), public `/` renders collection grid + `/c/:slug` renders photo grid with `srcset` via Images.

**Phase 3 — admin CRUD (1 day):**

- `/admin` routes, forms, `POST /api/photos` multipart → R2 + D1, auth gate.

**Phase 4 — polish / bulk (follow-up):**

- 50-file dropzone with retry, drag sort, focal picker, cursor pagination.

## 6) Out of scope (intentional)

Draft/publish, versioning, multi-user RBAC, full-text search, analytics — would double the build. Re-evaluate if you need to share editing.

## 7) Verification

- `pnpm typecheck && pnpm build` green (already)
- `pnpm infra:deploy --stage prod` green (fixed ZoneError, live at https://photo.elianiva.com)
- Phase 1+: `curl -H "Cf-Access-Jwt-Assertion: ..." https://photo.elianiva.com/api/collections` + manual upload of 5 JPEGs + check `srcset` renders.

## 8) Risks

- D1 latency ~5–10ms fine for SSR, but gallery list without KV cache is ~20ms — add KV later if needed.
- R2 + Images 5k transforms free — your first 5k unique `w=` variants are free, then $0.50/1k. At 200 photos × 3 sizes = 600 transforms/mo.
- Access costs nothing for 50 seats; if you prefer cookie auth, budget half day for session impl.
