# photo.elianiva.com

Curated photography showcase — `photo.elianiva.com`.

- **Frontend**: Foldkit (SSR, `packages/web`) + Tailwind CSS v4
- **Backend**: Effect (`packages/api`) — Photo and Tag services over R2 + D1, served by the API Worker via Effect RPC, mounted on the site's own hostname at `/api/*`
- **Shared**: Effect Schema RPC contract (`packages/shared`) — the RPC groups and the domain schemas they encode
- **Infra**: Alchemy (`alchemy.run.ts`) → Cloudflare `Website.Vite` (custom domain `photo.elianiva.com`) + `Worker` (route `photo.elianiva.com/api/*`) + one Cloudflare Access application covering `/admin`, `/api/admin/rpc` and `/api/upload`
- **Monorepo**: pnpm + Turborepo

## Develop

```sh
pnpm install
pnpm dev          # alchemy dev — site on http://localhost:5173, API Worker on http://localhost:13371
pnpm build
pnpm typecheck
pnpm lint
```

The two dev servers have fixed ports (`dev.port` in `alchemy.run.ts`) and fail to start when either is taken, so run one instance at a time per machine. Keep `ACCESS_ALLOWED_EMAILS` in a local `.env` (see `.env.example`); it is required on every stage, `dev` included, although the admin gate stands down on `dev` before the allowlist is consulted.

## Deploy

```sh
pnpm infra:deploy  # alchemy deploy --stage prod
```

## Storage

Images live in R2 (`photo-elianiva-originals`) and metadata in D1 (`photo-elianiva`). The Admin at `/admin` is a single-operator surface behind Cloudflare Access.

**One hostname, one login.** The API is a Worker of its own but answers on the _site's_ hostname behind a route (`photo.elianiva.com/api/*`), so the Admin and everything it calls are same-origin. That is what makes the Access login work: Access issues an application token per application, and a cross-origin call to a second hostname could neither send the cookie (a browser sends none on a preflight) nor complete the interactive login. In development the two are on separate ports and CORS is answered for the localhost pair alone.

**Delivery is the original's bytes.** Every image is served from R2 through the Worker's own `/api/image/<key>` proxy. The zone is on the Free plan, where Cloudflare Image Resizing is plan-gated (`image_resizing` reports `editable: false`), so `/cdn-cgi/image` answers 404 for every request and no URL builder for it ships. Stored Renditions (CONTEXT.md) are the designed answer; see `docs/adr/0008`.

See `CONTEXT.md` for domain language, `docs/plan.md` for the route map, and `docs/adr/` for the decisions.
