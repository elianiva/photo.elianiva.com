# photo.elianiva.com

Curated photography showcase — `photo.elianiva.com`.

- **Frontend**: Foldkit (SSR, `packages/web`) + Tailwind CSS v4
- **Backend**: Effect (`packages/api`) — Photo and Tag services over R2 + D1, served by the API Worker via Effect RPC, mounted on the site's own hostname at `/api/*`
- **Shared**: Effect Schema RPC contract (`packages/shared`) — the RPC groups and the domain schemas they encode
- **Infra**: Alchemy (`alchemy.run.ts`) → Cloudflare `Website.Vite` (custom domain `photo.elianiva.com`) + `Worker` (route `photo.elianiva.com/api/*`) + one Cloudflare Access application covering `/admin` and everything under it, `/api/admin/rpc` and `/api/upload`
- **Monorepo**: pnpm + Turborepo

## Develop

```sh
pnpm install
pnpm dev          # alchemy dev — site on http://localhost:4000, API Worker on http://localhost:13371
pnpm build
pnpm typecheck
pnpm lint
```

The two dev servers have fixed ports (`dev.port` in `alchemy.run.ts`) and fail to start when either is taken, so run one instance at a time per machine. Keep `ACCESS_ALLOWED_EMAILS` and `ACCESS_TEAM_DOMAIN` in a local `.env` (see `.env.example`); both are required on every non-dev stage, and `ACCESS_ALLOWED_EMAILS` on `dev` too, although the admin gate stands down on `dev` before either is consulted — `alchemy.run.ts` forces the _binding_ to `''` on that stage, so carrying the real team domain locally does not gate local development.

`PHOTO_REMOTE_RESOURCES` is the one optional variable, and it defaults to `true`. R2 and D1 are pinned to the real cloud with `Alchemy.remote()`, so `pnpm dev` reads and writes the same photos as production. Set it to `false` and the pin comes off: `pnpm dev` follows `alchemy dev`'s own default instead, which is Alchemy's local emulation for both — a `dev:`-prefixed bucket and database keyed into `.alchemy/local/`, with `./migrations` still applied to the local database. That is the way to work against a throwaway dataset, since nothing in a local dev server can then drop production's originals or metadata.

## Deploy

```sh
pnpm infra:deploy  # alchemy deploy --stage prod
```

`ACCESS_TEAM_DOMAIN` is the Zero Trust organization's `auth_domain` (the host that serves `/cdn-cgi/access/*` and the team JWKS). The Access application names the account's identity provider through `Cloudflare.Access.getIdentityProvider({ type: 'cloudflare' })` — the managed one, which is the email one-time PIN — as a plan-time `Output`, not a resource whose uuid is read with `Output.asEffect()`. The latter asks for a service the engine only provides while applying, and the stack then dies before it plans (`Service not found: RuntimeContext`), which is how every deploy after #79 failed and left production with no Access application at all.

## Routes

One hostname, two Workers behind it. The website Worker owns the custom domain;
the API Worker owns the `/api/*` route on it, which is the more specific match
and therefore wins for its own paths. In development the API Worker is on its
own port and the pair _is_ cross-origin, which is the only reason CORS exists at
all. One Access application covers `/admin` and everything under it, `/api/admin/rpc` and `/api/upload`;
that is one login, one application token and one first-party cookie.

| Path                     | Worker  | Purpose                                                             | Gated                  |
| ------------------------ | ------- | ------------------------------------------------------------------- | ---------------------- |
| `POST /api/upload`       | api     | multipart upload → R2 + D1                                          | Access + in-Worker JWT |
| `POST /api/admin/rpc`    | api     | all reads and writes the Admin needs                                | Access + in-Worker JWT |
| `POST /api/rpc`          | api     | public reads (`ListPhotos`, `GetPhoto`, `ListTags`, `GetFrontPage`) | open                   |
| `GET /api/image/<r2Key>` | api     | binary R2 proxy, serving the original's bytes                       | open                   |
| `GET /api/health`        | api     | D1 probe                                                            | open                   |
| `/admin*`                | website | the Admin SPA                                                       | Access                 |
| `/`                      | website | the public Home page, server-rendered from D1                       | open                   |
| `/about`                 | website | the About page, server-rendered from D1 (the public route table)    | open                   |
| `/tag/<slug>`            | website | a Tag's page, server-rendered from D1; the Nav's own entries        | open                   |
| `/sitemap.xml`           | website | the crawler route                                                   | open                   |
| everything else          | website | static assets                                                       | open                   |

## Storage

Images live in R2 (`photo-elianiva-originals`) and metadata in D1 (`photo-elianiva`). The Admin at `/admin` is a single-operator surface behind Cloudflare Access.

**One hostname, one login.** The API is a Worker of its own but answers on the _site's_ hostname behind a route (`photo.elianiva.com/api/*`), so the Admin and everything it calls are same-origin. That is what makes the Access login work: Access issues an application token per application, and a cross-origin call to a second hostname could neither send the cookie (a browser sends none on a preflight) nor complete the interactive login. In development the two are on separate ports and CORS is answered for the localhost pair alone — including the `b3` and `traceparent` headers Effect's HTTP client stamps on every request, because a preflight that does not answer with the headers it was asked about fails, and a failed preflight reads in the Admin exactly like an unproven session.

**The public Home page is server-rendered by the website Worker** off its own bindings, off the same read the public RPC serves (ADR 0004).

**The way back into the Admin is a navigation.** Access runs at the edge, before the Worker, so the request that starts a login is a document request for the protected path itself — which is what the session-expired screen's `Sign in again` link is. It is deliberately not a `/cdn-cgi/access/login` link: that path belongs to the team domain (`<team>.cloudflareaccess.com`) and 404s on any origin without an Access edge in front of it, which is every stage but production.

**Delivery is the original's bytes.** Every image is served from R2 through the Worker's own `/api/image/<key>` proxy. The zone is on the Free plan, where Cloudflare Image Resizing is plan-gated (`image_resizing` reports `editable: false`), so `/cdn-cgi/image` answers 404 for every request and no URL builder for it ships. Stored Renditions (CONTEXT.md) are the designed answer; see `docs/adr/0002-storage-and-image-delivery.md`.

See `CONTEXT.md` for the domain language and `docs/adr/` for the decisions.
