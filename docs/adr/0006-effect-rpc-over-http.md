# Effect RPC over HTTP replaces REST endpoints

## Status

Accepted

## Context

The Admin and the public gallery both talked to the Worker through hand-rolled
REST routes (`GET/POST/PATCH/DELETE /api/photos`, `/api/tags`, …): a manual
router in `worker.ts` matching on method + path regexes, JSON bodies validated
ad-hoc with Effect Schema at each arm, and clients hitting bare `fetch` calls.
Every new capability meant a new URL, a new router arm, a new request/response
schema pair, and a new fetch site — four places to keep in sync by hand.

Alternatives:

- **Keep REST** — familiar and debuggable with curl, but the contract lives in
  stringly-typed routing and every call site repeats encode/decode plumbing.
- **saku-style WebSocket wire** (JSONL over a persistent socket, hand-rolled)
  — great for streaming sessions, but nothing in this app streams; it adds
  connection state, reconnect logic, and friction with Cloudflare Access.
- **Effect RPC (`effect/unstable/rpc`) over HTTP POST** — one typed RPC group
  per audience, defined once in `@photo/shared` beside the schemas; the server
  registers a single POST route via `RpcServer.layerHttp({ protocol: 'http' })`
  on an Effect `HttpRouter` rendered with `HttpRouter.toWebHandler` (web-standard
  `Request`/`Response`, so it runs natively in Workers); browsers consume it via
  `RpcClient.make` + `RpcClient.layerProtocolHttp` over `FetchHttpClient`.

## Decision

All client↔server traffic uses `effect/unstable/rpc` over HTTP transport.
RPC groups live in `packages/shared`; handler services live in
`packages/api`. The REST router is deleted, not deprecated — the only
non-RPC endpoints are `/api/upload` (multipart file bytes do not belong in a
JSON RPC message) and `/api/image/*` (binary R2 proxy). Both galleries —
public and Admin — are `RpcClient`s of the same groups.

## Consequences

- The API contract is one typed artifact: rename an RPC and typecheck fails at
  every call site; no URL/regex/method bookkeeping.
- Raw curl debugging is replaced by the shape of the JSON envelope; debugging
  goes through the foldkit devtools or a scripted `RpcClient`.
- File uploads stay multipart by design (ADR 0007 covers their gating); if
  uploads ever need to bypass the Worker entirely, direct-to-R2 presigned PUT
  plus an RPC registration call is the escape hatch.
