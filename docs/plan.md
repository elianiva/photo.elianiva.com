# Plan — photo.elianiva.com: simple admin instead of Sanity

> **Status (2026-08): DONE, with evolutions.** The single-user admin shipped as a
> Foldkit frontend over Effect RPC over HTTP instead of REST endpoints, and Tags
> replaced Collections as the grouping model. The API is a Worker of its
> own but no longer a hostname of its own: it answers on the site's hostname
> behind a route, because Access issues an application token per application and a
> cross-origin call to a second hostname could neither send the cookie nor
> complete the interactive login (ADR 0003). Uploads go through `/api/upload`
> (multipart → R2 + D1); everything else rides the two RPC groups (`/api/rpc`
> public, `/api/admin/rpc` Access-gated), with `/api/image/*` serving originals.
> The public Front is server-rendered by the website Worker off its own
> bindings, which is the same read the public RPC serves (ADR 0004).
>
> The decisions this plan points at are consolidated in `docs/adr/`; see its
> `README.md` for the index.
>
> **Route map as shipped** — one hostname, two Workers behind it. The website
> Worker owns the custom domain; the API Worker owns the `/api/*` route on it,
> which is the more specific match and therefore wins for its own paths. In
> development the API Worker is on its own port and the pair _is_ cross-origin,
> which is the only reason CORS exists at all.
>
> | Path                     | Worker  | Purpose                                                             | Gated                  |
> | ------------------------ | ------- | ------------------------------------------------------------------- | ---------------------- |
> | `POST /api/upload`       | api     | multipart upload → R2 + D1                                          | Access + in-Worker JWT |
> | `POST /api/admin/rpc`    | api     | all reads and writes the Admin needs                                | Access + in-Worker JWT |
> | `POST /api/rpc`          | api     | public reads (`ListPhotos`, `GetPhoto`, `ListTags`, `GetFrontPage`) | open                   |
> | `GET /api/image/<r2Key>` | api     | binary R2 proxy, serving the original's bytes                       | open                   |
> | `GET /api/health`        | api     | D1 probe                                                            | open                   |
> | `/admin*`                | website | the Admin SPA                                                       | Access                 |
> | `/`                      | website | the public Front, server-rendered from D1                           | open                   |
> | `/sitemap.xml`           | website | the crawler route                                                   | open                   |
> | everything else          | website | static assets                                                       | open                   |
>
> All three Host names are `photo.elianiva.com`. One Cloudflare Access
> application covers `/admin`, `/api/admin/rpc` and `/api/upload`; that is one
> login, one application token and one first-party cookie.

## 0) Decision

Build a **single-user admin** inside the same monorepo instead of adopting Sanity/Directus. Rationale (see ADR 0002): free ceiling, zero new vendor, 1-day scaffold already owns the domain schemas (`@photo/shared`), and the admin is just CRUD over R2 + D1.

## 1) Architecture

```
[Browser]  ── photo.elianiva.com ──────────────────────────────────────────
  │
  ├─ /admin*          —Cloudflare Access gate→  website Worker
  │                                          ├─ the Admin SPA
  │                                          └─ / (SSR from D1), /sitemap.xml
  │
  └─ /api/*           —Cloudflare Access gate→  API Worker  (route, not a hostname)
                                             ├─ POST /api/upload       (multipart → R2 + D1)
                                             ├─ POST /api/admin/rpc    (Admin reads + writes, Access + JWT)
                                             ├─ POST /api/rpc          (public reads)
                                             ├─ GET  /api/image/<key>  (binary R2 proxy)
                                             └─ GET  /api/health       (D1 probe)

R2 Bucket  "photo-originals"   (adopt: false, new)
D1 Database "photo"            (adopt: false, new — Photo + Tag tables)
Image resizing                 (NONE — the zone is on the Free plan, where
                                `image_resizing` is not editable, so every
                                `/cdn-cgi/image` request 404s. Every image is
                                the original's bytes through the R2 proxy;
                                stored Renditions replace that — ADR 0006)
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

No `IMAGES` binding, and no resizing at all: Image Resizing is plan-gated and
this zone is on the Free plan, so the `/cdn-cgi/image` rewrite answers 404 for
every request. Images are served as the originals they are, and stored
Renditions (ADR 0006) are what replaces that.

Static domain (fixed ZoneError: previous `Alchemy.Stack.useSync(stage === 'prod' ? ... : undefined)` evaluated to `undefined` outside stack context — Vite Website class options run at import time. Use `domain: ['photo.elianiva.com']` like `elianiva.com`).

## 2) Domain model (extends CONTEXT.md)

Original draft, kept for context. ADR 0002 replaced Collections with a flat Photo list plus Tags, so `Collection`, `collectionId`, and the `collections` table below do not exist. The shipped model is in `CONTEXT.md` and `packages/shared/src/photo.ts`.

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

Replaced by ADR 0003. The contract is the two RPC groups, not a URL per verb:

- `PhotoPublicRpcs` on `POST /rpc` — `ListPhotos` (`tagSlug`, `q`, `limit`, `cursor`) → `{ items, nextCursor }`, `GetPhoto` → `PhotoWithTags`, `ListTags` → `Tag[]`
- `PhotoAdminRpcs` on `POST /admin/rpc` — `UpdatePhoto`, `DeletePhoto`, `CreateTag`, `DeleteTag`
- `POST /upload` (multipart: file + json fields → validate, `extractImageMeta` for width/height, R2 Put, D1 insert). Stays multipart because file bytes do not belong in a JSON RPC message.
- `GET /image/<r2Key>` — binary R2 proxy.

Clients are `RpcClient`s of the same groups, not hand-written `fetch` calls.

SSR `worker.ts` switches from `flagsForRequest()` mock to an `Effect` read from `DB` (via `PhotoDb` binding passed as Effect Layer).

Image delivery: every plate and every Admin thumbnail is the Photo's original, served from R2 through the Worker's `/api/image/<r2Key>` proxy. No zone resizer (plan-gated off) and no build-time Sharp; the plate's own `aspect-ratio` box crops it to the Ratio for display.

## 4) Admin UI (`packages/web` new route `/admin`)

Foldkit route + admin guard. As shipped, `/admin` is a **single** SPA route —
`worker.ts` serves the Admin bundle for `/admin` and anything under `/admin/`,
and the views (library, upload, editor Sheet) are in-app state, not routes.
`/admin/collections/:id` and `/admin/upload` from the original draft were never
built. The redesign adopts `foldkit/route` and splits `/admin` into real routes
(`/admin`, `/admin/photos/:id`, `/admin/settings`, …); see ADR 0006 for which
design frames are deliberately not built.

Auth (v1): **Cloudflare Access** (`Cloudflare.Access` in alchemy) — zero app code, `Access` policy `allow: [your email]` on `photo.elianiva.com/admin*`. Alternative if you dislike Access: `ADMIN_SECRET` env + cookie session.

No pagination needed at <500 photos; add `?limit=60&cursor=` later.

## 5) Phases

**Phase 0 — done** (this PR):

- Monorepo scaffold, SSR hello world, `shared` schemas, alchemy domain fix, deploy green.

**Phase 1 — infra + data (half day):**

- Add R2 + D1 to `alchemy.run.ts`, run migration, seed 2 collections via script, update `shared` Photo to include `r2Key/width/height`.

**Phase 2 — read path (half day):**

- SSR `worker.ts` reads the Front from D1 through `PublicPhotoService` and renders the broadsheet front page; plates carry each Photo's R2 key. The Worker is the page host in development and in production, so the read is off its own bindings in both (ADR 0004).

**Phase 3 — admin CRUD (1 day):**

- `/admin`, forms, `POST /upload` multipart → R2 + D1, auth gate.

**Phase 4 — polish / bulk (follow-up):**

- 50-file dropzone with retry, drag sort, focal picker, cursor pagination.

## 6) Out of scope (intentional)

Draft/publish, versioning, multi-user RBAC, full-text search, analytics — would double the build. Re-evaluate if you need to share editing.

## 7) Verification

- `pnpm typecheck && pnpm build` green (already)
- `pnpm infra:deploy --stage prod` green (fixed ZoneError, live at https://photo.elianiva.com)
- Phase 1+: `curl -X POST https://photo.elianiva.com/api/rpc` with a `ListPhotos` envelope, or a scripted `RpcClient` (ADR 0003 replaced raw curl with the typed client) + manual upload of 5 JPEGs + check the plate images load from `/api/image/*`.

## 8) Risks

- D1 latency ~5–10ms fine for SSR, but gallery list without KV cache is ~20ms — add KV later if needed.
- Image delivery is the original's bytes on a Free-plan zone with no resizer, so a grid of forty plates fetches forty originals (ADR 0002). Stored Renditions are the fix; a zone plan upgrade is the alternative.
- Access costs nothing for 50 seats; if you prefer cookie auth, budget half day for session impl.
