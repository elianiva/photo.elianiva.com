---
name: verify-photo
description: Drive photo.elianiva.com the way a visitor and the owner do — public gallery and /admin over portless, end-to-end in the browser. Use for verifying UI or image delivery changes in this repo.
---

# Verify photo.elianiva.com

Scripted way to launch this repo, drive it as a visitor and as the single admin in the browser, and capture proof. No mocks — the real gallery, upload, and edit flows against the shared remote D1/R2. External boundaries already isolated in prod: Cloudflare Access on `/admin*` and `/api/admin*` plus in-worker JWT verification (ADR 0007). Verified locally with `ACCESS_TEAM_DOMAIN` unset so the admin surface runs unauthenticated by design.

## Launch

Primary verification instance is the local Vite dev server at `https://photo.localhost` via [portless](https://github.com/vite-plus/portless) (`pnpm dev` → `portless` → `alchemy dev --stage dev`, backing port `13370` mapped to `photo.localhost`). Data always hits the shared remote D1/R2 (Alchemy `remote()`), so only one instance at a time.

```bash
pnpm install
# Terminal A — dev server (vite + Foldkit SSR shell + Worker bindings) via portless
pnpm dev
# Wait for ready — portless prints the URL and the proxy answers
portless get photo                    # -> https://photo.localhost
curl -k -sSf https://photo.localhost/ | head -n 5
# raw backing port 13370 still listens but verification drives the portless URL
```

Ready when:

- `GET /` on `https://photo.localhost` returns 200 with `<!doctype html>` containing the Foldkit app shell (`data-foldkit-app`)

Teardown is killing the single `pnpm dev` (portless) process you started. Never `pkill -f vite` by name breadth — kill the PID you recorded.

```bash
kill $DEV_PID
# portless cleans its route on exit; verify with:
portless list
```

Build-only verification (no server needed):

```bash
pnpm typecheck
pnpm test
pnpm build
```

All three run via turbo (`build` depends on `^build`). `pnpm build` emits `packages/web/dist/` with client chunks `foldkit` and `effect` split via `manualChunks`.

Ports and env:

- Portless URL `https://photo.localhost` (`portless.json` `name: photo`, backing `appPort: 13370`, Alchemy `dev: { port: 13370, strictPort: true }`). Access the app only via the portless URL; the raw `127.0.0.1:13370` is an internal fallback. No second instance on same backing port.
- Resolve the URL with `portless get photo` (`https://photo.localhost`). Override with `BASE=https://photo.localhost` for scripts.
- Local dev needs no `ACCESS_TEAM_DOMAIN` and no `ACCESS_ALLOWED_EMAILS` — blank means unauthenticated. Non-dev stages fail closed without both secrets.
- No `.env` required for local verification. R2 `photo-elianiva-originals` and D1 `photo-elianiva` are remote by default.

If `portless doctor` fails, `https://photo.localhost` is unreachable, or D1 unreachable, stop. Fix the base before writing the skill patch.

## Doctor

One read-only check. Run before first drive, after any failed drive, and on every fresh dev session. Do not drive when doctor is red.

```bash
.cursor/skills/verify-photo/scripts/doctor.sh
# or manually (portless URL; -k trusts the local CA if not yet trusted):
BASE=$(portless get photo 2>/dev/null || echo https://photo.localhost)
curl -k -sSf "$BASE/" | grep -q 'data-foldkit-app'
# typecheck sanity (no server needed)
pnpm typecheck --filter @photo/shared --filter @photo/api --filter @photo/web 2>&1 | tail -n 5
```

Doctor passes when:

- `GET /` on the portless URL is 200 and contains the Foldkit app shell
- `pnpm typecheck` is green on the changed scope (full turbo typecheck for release gates)

Doctor failure caused by skill drift (wrong URL) is drift. Fix the skill and retry once before calling the run blocked. A healthy process with a wedged UI state still needs a reset: hard-reload the page or restart the dev server, do not continue driving the stale state.

## Drive

Harness: `agent-browser` for every user path. No RPC probes — verify what the user sees. Prefer stable ARIA roles/names over coordinates.

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
BASE=$(portless get photo 2>/dev/null || echo https://photo.localhost)
npx agent-browser open "$BASE/"
npx agent-browser snapshot
npx agent-browser click --role link --name "<photo title>"
npx agent-browser press --key "Escape"
```

**Admin surface (local dev, unauthenticated):**

```bash
BASE=$(portless get photo 2>/dev/null || echo https://photo.localhost)
npx agent-browser open "$BASE/admin"
npx agent-browser click --role button --name "Upload photos"
# tag chip toggle is via TagManager submodel — click chip by label
npx agent-browser click --role button --name "Kyoto"
# upload: pick files via FileDrop, set tags via combo, then Start uploads
npx agent-browser click --role button --name "Start uploads"
```

Every feature file in `features/` pairs each user action with one literal command and the observable result. Treat quoted names and flags as literal.

## Evidence

Capture the action and the resulting state, not just the final screen. Verify side effects alongside what is visible. Mocks only where prod already isolates (Access).

Locations (proof survives cleanup):

- `.cursor/skills/verify-photo/artifacts/<feature-id>/` — ARIA snapshots (`*.aria.txt`), screenshots (`*.png`), curl transcripts where needed
- Each artifact names the feature ID and entry point used

Standards:

- UI proof: ARIA snapshot plus screenshot with app identity visible (`photo.elianiva.com` / `Elianiva` header). `npx agent-browser snapshot > .cursor/skills/verify-photo/artifacts/<id>/page.aria.txt` and `npx agent-browser screenshot .cursor/skills/verify-photo/artifacts/<id>/page.png`
- Mutation proof: drive the write in the UI, then read back via a second UI view (re-open the sheet, reload the grid, or open the lightbox) — a toast alone is insufficient.
- Image proof: open the photo's lightbox and assert the `<img src>` points at `/api/image/<r2Key>` and loads (alt text / network 200); headers `cache-control: public, max-age=31536000, immutable` are exercised implicitly via the proxy.
- Never assert a skipped entry point as verified through a different path. Report unreachable with the attempted command and the missing precondition.

## Cleanup

Kill only what you started. Keep proof.

```bash
# kill the dev server you launched (portless route auto-cleans)
kill $DEV_PID
portless list  # verify route gone
# remove only verification-owned data (prefix verify-)
# via the admin UI delete affordance, or direct DB if the UI is unavailable — never truncate tables
# e.g. open $BASE/admin, click Delete on the verify photo/tag and confirm
# remove temp files but retain artifacts/
rm -f /tmp/verify-sample.jpg
```

Helpers clean residue after every failed iteration too. Do not remove `artifacts/`. Final teardown runs after the last drive of the run including any re-proofs of harness fixes.

## Helpers

Every helper is executable and its invocation is shown in this body.

- `scripts/doctor.sh` — `.cursor/skills/verify-photo/scripts/doctor.sh` — read-only health check (portless URL + Foldkit shell + typecheck hint)
- `scripts/capture.sh` — `BASE=$(portless get photo) .cursor/skills/verify-photo/scripts/capture.sh gallery-browse` — ARIA + screenshot capture via agent-browser into `artifacts/<id>/`
- `scripts/rpc.sh` — optional low-level RPC helper (not required for e2e; defaults to `portless get photo` if you need it)

See `features/README.md` for the indexed feature map. Keep it honest — a proof that drives one convenient entry point is incomplete when the map lists others.
