---
name: verify-photo
description: Drive photo.elianiva.com the way a visitor and the owner do — public gallery and /admin over Effect RPC, multipart upload, and R2 proxy. Use for verifying UI, RPC, or image delivery changes in this repo.
---

# Verify photo.elianiva.com

Scripted way to launch this repo, drive it as a visitor and as the single admin, and capture proof. No mocks of the gallery or the RPC contract. External boundaries already isolated in prod: Cloudflare Access on `/admin*` and `/api/admin*` plus in-worker JWT verification (ADR 0007). Verified locally with `ACCESS_TEAM_DOMAIN` unset so the admin surface runs unauthenticated by design.

## Launch

Primary verification instance is the local Vite dev server on `http://127.0.0.1:13370`. Data always hits the shared remote D1/R2 (Alchemy `remote()`), so only one instance at a time.

```bash
pnpm install
# Terminal A — dev server (vite + Foldkit SSR shell + Worker bindings)
pnpm dev
# Wait for ready — vite prints ready and port answers
curl -sSf http://127.0.0.1:13370/ | head -n 5
curl -sSf http://127.0.0.1:13370/api/rpc -X POST -H 'content-type: application/json' \
  -d '{"_tag":"ListPhotos","limit":1}' | head -c 200
```

Ready when both succeed:
- `GET /` returns 200 with `<!doctype html>` containing `<div id="root">`
- `POST /api/rpc` with `ListPhotos` returns 200 JSON with `items` array (even if empty)

Teardown is killing the single `pnpm dev` process you started. Never `pkill -f vite` by name breadth — kill the PID you recorded.

```bash
kill $DEV_PID
# or if launched via portless helper: jobs -p | xargs kill
```

Build-only verification (no server needed):

```bash
pnpm typecheck
pnpm test
pnpm build
```

All three run via turbo (`build` depends on `^build`). `pnpm build` emits `packages/web/dist/` with client chunks `foldkit` and `effect` split via `manualChunks`.

Ports and env:
- Fixed port `13370` (`packages/web` vite `strictPort: true`, `portless.json` `appPort`). No second instance on same port.
- Local dev needs no `ACCESS_TEAM_DOMAIN` and no `ACCESS_ALLOWED_EMAILS` — blank means unauthenticated. Non-dev stages fail closed without both secrets.
- No `.env` required for local verification. R2 `photo-elianiva-originals` and D1 `photo-elianiva` are remote by default.

If port 13370 is already bound or D1 unreachable, stop. Fix the base before writing the skill patch.

## Doctor

One read-only check. Run before first drive, after any failed drive, and on every fresh dev session. Do not drive when doctor is red.

```bash
.pi/skills/verify-photo/scripts/doctor.sh
# or manually:
curl -sSf http://127.0.0.1:13370/ | grep -q 'id="root"'
curl -sSf -X POST http://127.0.0.1:13370/api/rpc \
  -H 'content-type: application/json' \
  -d '{"_tag":"ListPhotos","limit":1}' | grep -q '"items"'
# typecheck sanity (no server needed)
pnpm typecheck --filter @photo/shared --filter @photo/api --filter @photo/web 2>&1 | tail -n 5
```

Doctor passes when:
- `GET /` is 200 and contains the Foldkit root
- `POST /api/rpc` ListPhotos returns 200 with `items` + `nextCursor` shape
- `pnpm typecheck` is green on the changed scope (full turbo typecheck for release gates)

Doctor failure caused by skill drift (wrong port, renamed RPC tag) is drift. Fix the skill and retry once before calling the run blocked. A healthy process with a wedged UI state still needs a reset: hard-reload the page or restart the dev server, do not continue driving the stale state.

## Drive

Harness: `agent-browser` for every UI path, `curl` for RPC and binary probes. Prefer stable handles over coordinates.

UI handles that actually exist in this repo:
- Gallery photos by title text or `photoWithTags.id` derived `aria-label`
- Admin header: link `photo.elianiva.com`, button `Upload photos`, toggle buttons with `aria-label "2 columns"` through `"6 columns"` and `aria-pressed`
- Tag filter: `TagManager` chips labeled by `tag.label`, token `activeSlug` selects one tag
- Edit sheet: fields `title`, `slug`, `takenAt`, `caption`, `location`, `camera`, `lens` via draft combo `Multi` (Foldkit `defineMessageUnion`)
- Upload dialog: `FileDrop` + `Multi` combo for tag ids + `takenAt` input, queue rows by `QueueItem.id` (`${name}:${size}`)
- Lightbox: `selectedId` controls mount; keyboard `Escape`, `ArrowLeft`, `ArrowRight` via `admin/subscriptions.ts` while `selectedId !== null`

Generic recipes:

**Visitor gallery (public):**
```bash
npx agent-browser open http://127.0.0.1:13370/
npx agent-browser snapshot --aria
npx agent-browser click --role link --name "<photo title>"
npx agent-browser press --key "Escape"
```

**Admin surface (local dev, unauthenticated):**
```bash
npx agent-browser open http://127.0.0.1:13370/admin
npx agent-browser click --role button --name "Upload photos"
# tag chip toggle is via TagManager submodel — click chip by label
npx agent-browser click --role button --name "Kyoto"
```

**RPC (public reads, no auth on 13370):**
```bash
# ListPhotos — limit + cursor are Effect Schema validated (clampLimit 1..100, default 60)
curl -s -X POST http://127.0.0.1:13370/api/rpc \
  -H 'content-type: application/json' \
  -d '{"_tag":"ListPhotos","limit":60}' | jq .
curl -s -X POST http://127.0.0.1:13370/api/rpc \
  -H 'content-type: application/json' \
  -d '{"_tag":"ListPhotos","tagSlug":"kyoto","limit":60}' | jq .
# GetPhoto
curl -s -X POST http://127.0.0.1:13370/api/rpc \
  -H 'content-type: application/json' \
  -d '{"_tag":"GetPhoto","id":"<photoId>"}' | jq .

# Admin RPC (locally open, prod gated by Cf-Access-Jwt-Assertion)
curl -s -X POST http://127.0.0.1:13370/api/admin/rpc \
  -H 'content-type: application/json' \
  -d '{"_tag":"CreateTag","slug":"verify-tag","label":"Verify Tag"}' | jq .

# Multipart upload — bytes do not ride in RPC (ADR 0006)
curl -s -X POST http://127.0.0.1:13370/api/upload \
  -F 'file=@/tmp/sample.jpg;type=image/jpeg' \
  -F 'title=Verify Photo' \
  -F 'tagIds=[]' \
  -F 'blurhash=LKO2?U%2Tw=w]~RBVZRi};kq' | jq .

# R2 original proxy
curl -sSf -I http://127.0.0.1:13370/api/image/originals%2Fverify.jpg
```

Every feature file in `features/` pairs each user action with one literal command and the observable result. Treat quoted names and flags as literal.

## Evidence

Capture the action and the resulting state, not just the final screen. Verify side effects alongside what is visible. Mocks only where prod already isolates (Access).

Locations (proof survives cleanup):
- ` .pi/skills/verify-photo/artifacts/<feature-id>/ ` — ARIA snapshots (`*.aria.txt`), screenshots (`*.png`), RPC JSON (`*.json`), curl transcripts
- Each artifact names the feature ID and entry point used

Standards:
- UI proof: ARIA snapshot plus screenshot with app identity visible (`photo.elianiva.com` header). `npx agent-browser snapshot --aria --path .pi/skills/verify-photo/artifacts/<id>/page.aria.txt` and `npx agent-browser screenshot --path .pi/skills/verify-photo/artifacts/<id>/page.png`
- RPC proof: request body plus response body plus status. Save both.
- Mutation proof: drive the write, then read back via a second view (`ListPhotos` or `GetPhoto` after `UpdatePhoto`/`CreateTag`/upload). Status message alone is insufficient.
- Image proof: fetch `/api/image/<r2Key>` and assert `content-type` and `cache-control: public, max-age=31536000, immutable` plus body non-empty.
- Never assert a skipped entry point as verified through a different path. Report unreachable with the attempted command and the missing precondition.

## Cleanup

Kill only what you started. Keep proof.

```bash
# kill the dev server you launched
kill $DEV_PID
# remove only verification-owned data (prefix verify- / verify_tag_)
# via admin RPC or direct D1 — never truncate tables
curl -s -X POST http://127.0.0.1:13370/api/admin/rpc \
  -H 'content-type: application/json' \
  -d '{"_tag":"DeletePhoto","id":"<verify-photo-id>"}' | jq .
curl -s -X POST http://127.0.0.1:13370/api/admin/rpc \
  -H 'content-type: application/json' \
  -d '{"_tag":"DeleteTag","id":"<verify-tag-id>"}' | jq .
# remove temp files but retain artifacts/
rm -f /tmp/verify-sample.jpg
```

Helpers clean residue after every failed iteration too. Do not remove `artifacts/`. Final teardown runs after the last drive of the run including any re-proofs of harness fixes.

## Helpers

Every helper is executable and its invocation is shown in this body.

- `scripts/doctor.sh` — ` .pi/skills/verify-photo/scripts/doctor.sh ` — read-only health check (port, RPC shape, typecheck hint)
- `scripts/rpc.sh` — ` .pi/skills/verify-photo/scripts/rpc.sh ListPhotos '{"limit":60}' ` — curl wrapper for JSON RPC (public vs admin group inferred from tag)
- `scripts/rpc.mjs` — ` node .pi/skills/verify-photo/scripts/rpc.mjs ListPhotos '{"limit":1}' ` — Effect-typed RPC caller alternative that reuses `FetchHttpClient` (useful when envelope shape drifts)
- `scripts/capture.sh` — ` .pi/skills/verify-photo/scripts/capture.sh gallery-browse ` — ARIA + screenshot capture via agent-browser into `artifacts/<id>/`

See `features/README.md` for the indexed feature map. Keep it honest — a proof that drives one convenient entry point is incomplete when the map lists others.
