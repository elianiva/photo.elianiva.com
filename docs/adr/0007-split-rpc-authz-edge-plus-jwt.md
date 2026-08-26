# Split public/admin RPC routes with edge gating + JWT verification

## Status

Accepted

## Context

Cloudflare Access gated only `photo.elianiva.com/admin*`. The mutation
endpoints under `/api/*` were therefore publicly writable by anyone on the
internet — found during the Admin design review. With the move to RPC
(ADR 0006) there is a single route per audience instead of many paths, so
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
   a second covering `photo.elianiva.com/api/admin*` and
   `photo.elianiva.com/api/upload*` so admin RPC and multipart upload are
   OTP-gated before the Worker runs.
2. **Route split**: public reads served from `/api/rpc` (no gate), all writes
   from `/api/admin/rpc` (edge-gated).
3. **Defense-in-depth**: the Worker verifies the `Cf-Access-Jwt-Assertion`
   JWT against the team JWKS (`ACCESS_TEAM_DOMAIN` binding) on every admin
   route request — signature and expiry checked with WebCrypto, JWKS cached
   in global scope. When `ACCESS_TEAM_DOMAIN` is unset (local dev, where no
   Access exists) verification is skipped; when set, an invalid or missing
   token fails closed with 401.

## Consequences

- Public write requires defeating both the edge and the Worker check.
- One more Access application to manage; its AUD tag is not pinned — signature
  - expiry is accepted as sufficient defense-in-depth behind edge gating
    (pinning `aud` per application can be added later without interface changes).
- Local development runs unauthenticated by design; staging/prod stages set
  `ACCESS_TEAM_DOMAIN` and get fail-closed behavior.
