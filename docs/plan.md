# Plan — photo.elianiva.com: simple admin instead of Sanity

> **Status (2026-08): DONE, with evolutions.** The single-user admin shipped as a
> Foldkit SPA over Effect RPC over HTTP (see `docs/adr/0006-effect-rpc-over-http.md`
> and `docs/adr/0007-split-rpc-authz-edge-plus-jwt.md`) instead of REST endpoints,
> and Tags replaced Collections as the grouping model. The API also moved to its
> own Worker on its own hostname, `photo-api.elianiva.com`, so the site and the
> API deploy and scale separately. Uploads go through `/upload` (multipart →
> R2 + D1); everything else rides the two RPC groups (`/rpc` public, `/admin/rpc`
> Access-gated), with `/image/*` serving originals. The phases below are kept
> for context; details that changed are marked by the ADRs.
>
> **Route map as shipped** — the API runs on its own Worker and hostname, so
> the `/api/*` paths drafted below were never the ones that shipped. This table
> is the current truth, and it is what the rest of the document has been
> corrected to:
>
> | Path                 | Host                     | Purpose                                                             | Gated                  |
> | -------------------- | ------------------------ | ------------------------------------------------------------------- | ---------------------- |
> | `POST /upload`       | `photo-api.elianiva.com` | multipart upload → R2 + D1                                          | Access + in-Worker JWT |
> | `POST /admin/rpc`    | `photo-api.elianiva.com` | all writes (`UpdatePhoto`, `DeletePhoto`, `CreateTag`, `DeleteTag`) | Access + in-Worker JWT |
> | `POST /rpc`          | `photo-api.elianiva.com` | public reads (`ListPhotos`, `GetPhoto`, `ListTags`)                 | open                   |
> | `GET /image/<r2Key>` | `photo-api.elianiva.com` | binary R2 proxy, resizable via `/cdn-cgi/image`                     | open                   |
> | `GET /health`        | `photo-api.elianiva.com` | D1 probe                                                            | open                   |
> | `/admin*`            | `photo.elianiva.com`     | the Admin SPA                                                       | Access                 |
> | everything else      | `photo.elianiva.com`     | the public site                                                     | open                   |
>
> Scaffold is live at https://photo.elianiva.com (Alchemy `photo` Website.Vite, SSR with cache headers). This plan is for the next iteration: replace mock Photo/Collection with a self-hosted admin that manages files + metadata in one place.

## 0) Decision

Build a **single-user admin** inside the same monorepo instead of adopting Sanity/Directus. Rationale (see ADR 0004): free ceiling, zero new vendor, 1-day scaffold already owns the domain schemas (`@photo/shared`), and the admin is just CRUD over R2 + D1.

## 1) Architecture

```
[Browser /admin]  —Cloudflare Access gate→  Worker (photo-api.elianiva.com)
                                       ├─ POST /upload          (multipart → R2 + D1)
                                       ├─ POST /admin/rpc       (all writes, Access + JWT)
                                       ├─ POST /rpc             (public reads)
                                       └─ GET  /image/<r2Key>   (binary R2 proxy)

[Browser /]       —open→  Worker (photo.elianiva.com) — SSR pages, the Admin SPA

R2 Bucket  "photo-originals"   (adopt: false, new)
D1 Database "photo"            (adopt: false, new — Photo + Tag tables)
Image resizing                 (zone `/cdn-cgi/image` URL rewrite, no binding — ADR 0008)
KV Namespace (optional cache)  (if D1 latency ~5ms matters; defer)
```

Alchemy (updated `alchemy.run.ts`):

```ts
const PhotosBucket = Cloudflare.R2.Bucket("photo-originals", { name: "photo-elianiva-originals" })
const PhotoDb = Cloudflare.D1.Database("photo", { name: "photo-elianiva" })
class Website extends Cloudflare.Website.Vite('photo', {
  rootDir: 'packages/web',
  domain: ['photo.elianiva.com'],
  bindings: { PHOTOS: PhotosBucket, DB: PhotoDb }
```

No `IMAGES` binding. Resizing rides the zone's `/cdn-cgi/image` URL rewrite on
`photo-api.elianiva.com`, and the redesign replaces it with stored Renditions
(ADR 0008).

Static domain (fixed ZoneError: previous `Alchemy.Stack.useSync(stage === 'prod' ? ... : undefined)` evaluated to `undefined` outside stack context — Vite Website class options run at import time. Use `domain: ['photo.elianiva.com']` like `elianiva.com`).

## 2) Domain model (extends CONTEXT.md)

Original draft, kept for context. ADR 0005 replaced Collections with a flat Photo list plus Tags, so `Collection`, `collectionId`, and the `collections` table below do not exist. The shipped model is in `CONTEXT.md` and `packages/shared/src/photo.ts`.

- **Photo** (`@photo/shared/src/photo.ts` already): id (ULID), slug, title, caption?, collectionId, r2Key, width, height, takenAt?, location?, camera?, lens?, exif?
- **Collection**: id, slug, title, description?, coverPhotoId?, order (int)
- **R2 key**: `originals/{collectionSlug}/{photoId}-{slug}.jpg` (content-addressed by photoId, not filename)

D1 migrations (via `d1 migrations` or Alchemy `migrate`):

```sql
CREATE TABLE collections (id TEXT PRIMARY KEY, slug TEXT UNIQUE, title TEXT, description TEXT, coverPhotoId TEXT, ord INTEGER);
CREATE TABLE photos (id TEXT PRIMARY KEY, slug TEXT, title TEXT, caption TEXT, collectionId TEXT REFERENCES collections(id), r2Key TEXT, width INT, height INT, takenAt TEXT, location TEXT);
CREATE INDEX idx_photos_collection ON photos(collectionId);
```

## 3) API (Effect RPC in `packages/shared` + `packages/api`, consumed by `packages/web`)

Replaced by ADR 0006. The contract is the two RPC groups, not a URL per verb:

- `PhotoPublicRpcs` on `POST /rpc` — `ListPhotos` (`tagSlug`, `q`, `limit`, `cursor`) → `{ items, nextCursor }`, `GetPhoto` → `PhotoWithTags`, `ListTags` → `Tag[]`
- `PhotoAdminRpcs` on `POST /admin/rpc` — `UpdatePhoto`, `DeletePhoto`, `CreateTag`, `DeleteTag`
- `POST /upload` (multipart: file + json fields → validate, `extractImageMeta` for width/height, R2 Put, D1 insert). Stays multipart because file bytes do not belong in a JSON RPC message.
- `GET /image/<r2Key>` — binary R2 proxy.

Clients are `RpcClient`s of the same groups, not hand-written `fetch` calls.

SSR `entry.server.ts` switches from `flagsForRequest()` mock to `Effect` fetch from `DB` (via `PhotoDb` binding passed as Effect Layer).

Images delivery: public pages render `srcset` via the zone's `/cdn-cgi/image` URL pattern — e.g. `/cdn-cgi/image/width=800,format=auto,quality=75/image/<r2Key>`. No binding, and no build-time Sharp.

## 4) Admin UI (`packages/web` new route `/admin`)

Foldkit route + admin guard. As shipped, `/admin` is a **single** SPA route —
`worker.ts` serves the Admin bundle for `/admin` and anything under `/admin/`,
and the views (library, upload, editor Sheet) are in-app state, not routes.
`/admin/collections/:id` and `/admin/upload` from the original draft were never
built. The redesign adopts `foldkit/route` and splits `/admin` into real routes
(`/admin`, `/admin/photos/:id`, `/admin/settings`, …); see ADR 0008 for which
design frames are deliberately not built.

Auth (v1): **Cloudflare Access** (`Cloudflare.Access` in alchemy) — zero app code, `Access` policy `allow: [your email]` on `photo.elianiva.com/admin*`. Alternative if you dislike Access: `ADMIN_SECRET` env + cookie session.

No pagination needed at <500 photos; add `?limit=60&cursor=` later.

## 5) Phases

**Phase 0 — done** (this PR):

- Monorepo scaffold, SSR hello world, `shared` schemas, alchemy domain fix, deploy green.

**Phase 1 — infra + data (half day):**

- Add R2 + D1 to `alchemy.run.ts`, run migration, seed 2 collections via script, update `shared` Photo to include `r2Key/width/height`.

**Phase 2 — read path (half day):**

- SSR `entry.server.ts` fetches from D1 (via API layer), public `/` renders the broadsheet front page with `srcset` via `/cdn-cgi/image`.

**Phase 3 — admin CRUD (1 day):**

- `/admin`, forms, `POST /upload` multipart → R2 + D1, auth gate.

**Phase 4 — polish / bulk (follow-up):**

- 50-file dropzone with retry, drag sort, focal picker, cursor pagination.

## 6) Out of scope (intentional)

Draft/publish, versioning, multi-user RBAC, full-text search, analytics — would double the build. Re-evaluate if you need to share editing.

## 7) Verification

- `pnpm typecheck && pnpm build` green (already)
- `pnpm infra:deploy --stage prod` green (fixed ZoneError, live at https://photo.elianiva.com)
- Phase 1+: `curl -X POST https://photo-api.elianiva.com/rpc` with a `ListPhotos` envelope, or a scripted `RpcClient` (ADR 0006 replaced raw curl with the typed client) + manual upload of 5 JPEGs + check `srcset` renders.

## 8) Risks

- D1 latency ~5–10ms fine for SSR, but gallery list without KV cache is ~20ms — add KV later if needed.
- R2 + Images 5k transforms free — your first 5k unique `w=` variants are free, then $0.50/1k. At 200 photos × 3 sizes = 600 transforms/mo.
- Access costs nothing for 50 seats; if you prefer cookie auth, budget half day for session impl.
