# photo.elianiva.com

Curated photography showcase — `photo.elianiva.com`.

- **Frontend**: Foldkit (SSR, `packages/web`) + Tailwind CSS v4
- **Backend**: Effect (`packages/api`) — Photo and Tag services over R2 + D1, served by the `photo-api` Worker via Effect RPC
- **Shared**: Effect Schema RPC contract (`packages/shared`) — the RPC groups and the domain schemas they encode
- **Infra**: Alchemy (`alchemy.run.ts`) → Cloudflare `Website.Vite` (`photo.elianiva.com`) + `Worker` (`photo-api.elianiva.com`)
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

Images live in R2 (`photo-elianiva-originals`) and metadata in D1 (`photo-elianiva`). The Admin at `/admin` is a single-operator surface behind Cloudflare Access. Delivery is R2 through the zone's `/cdn-cgi/image` resizing today and stored Renditions after the redesign. See `CONTEXT.md` for domain language, `docs/plan.md` for the route map, and `docs/adr/` for the decisions.
