# photo.elianiva.com

Curated photography showcase — `photo.elianiva.com`.

- **Frontend**: Foldkit (SSR, `packages/web`) + Tailwind CSS v4
- **Backend**: Effect (`packages/api`) — placeholder `HelloService`, wired via `packages/shared` schemas
- **Shared**: Effect Schema API contract (`packages/shared`)
- **Infra**: Alchemy (`alchemy.run.ts`) → Cloudflare `Website.Vite` (SSR, `photo.elianiva.com` on prod)
- **Monorepo**: pnpm + Turborepo

## Develop

```sh
pnpm install
pnpm dev          # alchemy dev — http://localhost:5173
pnpm dev:local    # optional: portless HTTPS at https://photo.localhost
pnpm build
pnpm typecheck
pnpm lint
```

## Deploy

```sh
pnpm infra:deploy  # alchemy deploy --stage prod
```

## CMS

Scaffold uses mock `Photo`/`Collection` in `@photo/shared`. Next iteration wires a real CMS — candidate: **R2 + Cloudflare Images** (5k transforms free, zero egress, scriptable S3) for image delivery, with a UI like **Sanity** (hosted, 5GB free) or **Directus** (self-host + R2) to co-manage metadata + files in one place. See `CONTEXT.md` for domain language.
