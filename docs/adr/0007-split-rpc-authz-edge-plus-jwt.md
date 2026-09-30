# Split public/admin RPC routes with edge gating + JWT verification

## Status

Accepted

> **Correction (2026-08, #13; superseded 2026-09).** The three _layers_ below
> stand and are still the whole story: edge, route split, in-Worker JWT. What did
> not survive is the shape of layer 1. Three Access applications across two
> hostnames turned out to make the Admin unusable, and the reason is recorded in
> "Why one application on one hostname" below. There is now **one** application
> with three path destinations on `photo.elianiva.com`, covering `/admin`,
> `/api/admin/rpc` and `/api/upload`, and the API Worker answers on a route of
> that same hostname. The current table is in `docs/plan.md`.

## Context

Cloudflare Access gated only `photo.elianiva.com/admin*`. The mutation
endpoints under the API's write route were therefore publicly writable by
anyone on the internet — found during the Admin design review. With the move to
RPC (ADR 0006) there is a single route per audience instead of many paths, so
authorization has to be decided per route, not per path pattern buried in a
router.

Requirements: photo/tag reads must stay public (the gallery renders from
them); every write must require the owner. Options:

- **Single RPC route, check auth inside handlers** — one surface to protect,
  but correctness depends on every handler remembering to demand the principal;
  a forgotten check is a public write.
- **Split routes behind separate Access applications** — the edge fails closed:
  requests to the admin route without a valid Access session never reach the
  Worker. Two groups (`PhotoPublicRpcs`, `PhotoAdminRpcs`) make the audience
  part of the type-level design.
- **In-worker JWT verification** — Cloudflare Access sets
  `Cf-Access-Jwt-Assertion` (RS256, signed with the team's JWKS); verifying
  signature + expiry in the Worker means protection survives any future
  Access application misconfiguration (e.g. a wildcard domain policy change).

## Decision

Three layers, cheapest first:

1. **Edge**: two Access applications — the existing `/admin*` app for pages,
   a second covering `photo-api.elianiva.com/admin/rpc` and
   `photo-api.elianiva.com/upload` so admin RPC and multipart upload are
   OTP-gated before the Worker runs.
2. **Route split**: public reads served from `/rpc` (no gate), all writes
   from `/admin/rpc` (edge-gated).
3. **Defense-in-depth**: the Worker verifies the `Cf-Access-Jwt-Assertion`
   JWT against the team JWKS (`ACCESS_TEAM_DOMAIN` binding) on every admin
   route request — signature and expiry checked with WebCrypto, JWKS cached
   in global scope. When `ACCESS_TEAM_DOMAIN` is blank the gate stands down,
   but **only on the `dev` stage**, which is the one stage Alchemy creates no
   Access applications for; on any other stage a blank team domain is a
   misconfigured deploy and fails closed with 500 rather than serving the
   Admin ungated. When the team domain is set, a missing or invalid token
   fails closed with 401 on every stage including `dev`.

## Why one application on one hostname

This section records what the deployed split actually did, because the failure
was not subtle and the three Access applications were individually correct.

Cloudflare Access evaluates a request **at the edge, before the Worker runs**,
and issues an **application token per application**. Splitting the Admin across
three applications on two hostnames meant:

1. **The Admin was ungated.** No Access application covered
   `photo.elianiva.com/admin` at all. `curl https://photo.elianiva.com/admin`
   returned 200, and because Access never ran there was no
   `Cf-Access-Jwt-Assertion` either — so the in-Worker JWT check, which is
   layer 3 of this ADR, could never pass for the page's own API calls. The
   defense-in-depth layer was not a second line; it was the only line, and it was
   closed.
2. **Every browser read died at the preflight.** The Admin posted JSON to
   `photo-api.elianiva.com/admin/rpc` from `photo.elianiva.com`. A browser sends
   **no cookies on a preflight**, by design, so Cloudflare answered the `OPTIONS`
   with a bare `403` and no CORS headers, before the Worker was reached. Every
   RPC call and every upload failed; the CORS layer in the Worker never got a
   turn.
3. **The login could not have been completed even without the preflight.** The
   real request 302-redirected to an interactive Access login, which `fetch`
   cannot follow. And the site's Access application granted nothing on the API
   hostname, so the operator's login on one granted no token on the other.

Three fixes were available and each treated the symptom: enable
`options_preflightBypass`, add `cors_headers`, or make the two hostnames one
Access application with eager cookies. All three assume the premise that the
Admin's API may live on a different origin from the Admin. Two also require
fields `Cloudflare.Access.Application` does not model, so they would have had to
be patched outside the IaC.

**The fix is the premise.** One hostname, one Access application, one cookie:

- the API Worker is mounted at `photo.elianiva.com/api/*` as a **route**, not a
  custom domain. A route is the more specific match and wins over the website
  Worker's custom domain for its own paths. (Verified against the live zone
  before the change: a route on `photo.elianiva.com/api/*` reached the API
  Worker while the custom domain served everything else.)
- the three gated paths are three **destinations on one application**, so there
  is one application token and one login.
- nothing in production is cross-origin, so there is no preflight to fail and no
  cookie to withhold. CORS survives only for the two localhost ports, which is
  the one stage where the two really are separate origins.

Two Workers stay two Workers, because `alchemy dev` binds the real D1 and R2 to
a Worker resource while foldkit's dev server has no bindings at all. In
production they share an origin; in development they share nothing but a
contract.

## Consequences

- Public write requires defeating both the edge and the Worker check.
- One more Access application to manage; its AUD tag is not pinned — signature
  - expiry is accepted as sufficient defense-in-depth behind edge gating
    (pinning `aud` per application can be added later without interface changes).
- Local development runs unauthenticated by design; staging/prod stages set
  `ACCESS_TEAM_DOMAIN` and get fail-closed behavior. The stage reaches the
  Worker as a `STAGE` binding, because only the Worker can see it at request
  time and the gate's answer depends on it.
