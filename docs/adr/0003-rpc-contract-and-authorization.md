# The API: Effect RPC over HTTP, one hostname, gated at the edge and verified in the Worker

Accepted.

## The contract is RPC, not REST

All client↔server traffic is `effect/rpc` over HTTP POST. The groups
live in `packages/shared` beside the schemas; the handler services live in
`packages/api`; the server registers one POST route per group via
`RpcServer.layerHttp({ protocol: 'http' })` on an Effect `HttpRouter` rendered
with `HttpRouter.toWebHandler`, so it runs natively in Workers on web-standard
`Request`/`Response`. Browsers consume it with `RpcClient.make` +
`RpcClient.layerProtocolHttp` over `FetchHttpClient`.

The hand-written REST router — method + path regexes, ad-hoc per-arm schema
validation, bare `fetch` at each call site — is deleted, not deprecated. Every
new capability had meant a new URL, a new router arm, a new request/response
schema pair and a new fetch site: four places to keep in step by hand.

The only non-RPC endpoints are `POST /api/upload` (file bytes do not belong in
a JSON RPC message) and `GET /api/image/<key>` (a binary R2 proxy). Every path
is a constant in `packages/web/src/lib/api.ts`, which the Worker matches against
and the browser builds URLs from, so a route cannot exist on one side only.

| Path                   | Audience                                                            | Gate                   |
| ---------------------- | ------------------------------------------------------------------- | ---------------------- |
| `POST /api/rpc`        | public reads (`ListPhotos`, `GetPhoto`, `ListTags`, `GetFrontPage`) | none, by design        |
| `POST /api/admin/rpc`  | every Admin read and write, Drafts and Trash included               | Access + in-Worker JWT |
| `POST /api/upload`     | multipart JPEG → R2 + D1                                            | Access + in-Worker JWT |
| `GET /api/image/<key>` | the original's bytes                                                | none                   |
| `GET /api/health`      | a real D1 round trip                                                | none                   |

Raw curl debugging is replaced by the shape of the JSON envelope; debugging goes
through the foldkit devtools or a scripted `RpcClient`. If uploads ever need to
bypass the Worker, direct-to-R2 presigned PUT plus an RPC registration call is
the escape hatch.

## One application, one hostname

Cloudflare Access gates at the edge, **before the Worker runs**, and issues an
**application token per application**. The Admin was first split across three
applications on two hostnames — the site and an API subdomain. Each application
was individually correct and the result was an unusable Admin:

1. No application covered `photo.elianiva.com/admin`, so the page was ungated
   _and_ carried no `Cf-Access-Jwt-Assertion` for the checks below.
2. Every Admin call was cross-origin, and a browser sends **no cookies on a
   preflight**. Cloudflare answered the `OPTIONS` with a bare 403 and no CORS
   headers, before the Worker was reached, so every RPC call and every upload
   failed. The Worker's own CORS layer never got a turn.
3. The real request 302-redirected to an interactive Access login, which
   `fetch` cannot follow — and the site's application granted nothing on the
   API hostname, so the operator's login on one granted no token on the other.

Three fixes were available and each treated the symptom:
`options_preflightBypass`, `cors_headers`, or making the two hostnames one
application with eager cookies. All three assume the premise that the Admin's
API may live on a different origin from the Admin, and two need fields
`Cloudflare.Access.Application` does not model, so they would have been patched
outside the IaC.

**The fix is the premise.** The API Worker is mounted at
`photo.elianiva.com/api/*` as a _route_ rather than given a custom domain, and
the Admin's three gated paths are five **destinations on one application**:
`/admin` and `/admin/*`, and `/api/admin/rpc` and `/api/admin/rpc/*` (a path
destination covers neither its parent nor its children on its own — and
Effect's HTTP RPC client appends a slash to the URL it is given, so the app
asks for `/api/admin/rpc/` where the route is declared `/api/admin/rpc`),
plus `/api/upload`. That is one application token, one
login, one first-party cookie, and nothing cross-origin in production — so
there is no preflight to fail and no cookie to withhold. CORS survives only for
the two localhost dev ports.

## Three layers, cheapest first

1. **Edge** — one Access application over the five destinations above. A
   request to them without a valid Access session never reaches a Worker.
2. **Route split** — public reads served from `/api/rpc` with no gate; every
   write from `/api/admin/rpc`. The audience is part of the type-level design,
   and the admin group is mounted on a path the public route never matches, so
   the session it carries is unreachable from there.
3. **Defense in depth** — the API Worker verifies `Cf-Access-Jwt-Assertion`
   (RS256, signed with the team JWKS) on every admin route, with WebCrypto and
   a JWKS cached in global scope. Protection therefore survives a future Access
   misconfiguration such as a wildcard domain policy change. The AUD tag is not
   pinned; signature-and-expiry behind edge gating is the accepted defence.

The gate is stage-dependent, and the stage arrives as a `STAGE` binding because
only the Worker can see it at request time. On `dev` — the one stage Alchemy
creates no Access applications for — a blank `ACCESS_TEAM_DOMAIN` stands the
gate down. On **any** other stage a blank team domain is a misconfigured deploy
and fails closed with 500 rather than serving the Admin ungated; when the team
domain is set, a missing or invalid token is 401 everywhere including `dev`.

## Consequences

- Public write requires defeating both the edge and the Worker check.
- The verified `Cf-Access-Jwt-Assertion` claims are provided into the admin
  handlers as an `AdminSession` per request, so a handler that reads the session
  reads the one the gate checked. There is no signed-out state: `GetSession`
  carrying neither field means the dev stand-down, and `user.email` is never
  recomputed from the request.
- The upload is edge-gated but not identified — nothing it writes carries the
  operator's email, so the verified address is read and dropped.
