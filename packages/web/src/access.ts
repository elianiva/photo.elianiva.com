/**
 * Cloudflare Access JWT verification (ADR 0003, defense-in-depth layer).
 *
 * The edge (Cloudflare Access applications) is the primary gate; this module
 * independently verifies the `Cf-Access-Jwt-Assertion` token inside the
 * Worker so protection survives any Access misconfiguration. Signature
 * (RS256 against the team JWKS) and expiry are checked; `aud` pinning can be
 * added later without interface changes.
 *
 * A blank team domain is a stage-dependent signal, not a misconfiguration. The
 * `dev` stage creates no Access applications, so blank means unauthenticated by
 * design and this gate stands down; every other stage fails closed. A team
 * domain that is set is always verified, on every stage.
 *
 * The gate answers a `Result`, not a failure: a rejected request is an answer
 * the Worker turns into a status, not a program that died. `verifyAdminAccess`
 * names the rejection's `reason` in full (eight distinct ones) and the status
 * it answers with, so the Worker logs why and the operator is told only that
 * access was denied — which is what an unauthenticated caller should learn.
 */

import { Cache, Data, DateTime, Duration, Effect, Option, Result, Schema as S } from 'effect'
import { HttpClientResponse } from 'effect/unstable/http'
// The namespace import is what gives the *service* its type: the barrel's
// `HttpClient` is a `const` that merges with an interface of the same name, so
// a named import reads as the namespace and cannot be used in type position.
import * as HttpClient from 'effect/unstable/http/HttpClient'

/** The env bindings the admin gate reads. */
export interface AccessEnv {
  /** Alchemy stage name. `dev` is the only stage with no Access edge. */
  readonly STAGE: string
  readonly ACCESS_TEAM_DOMAIN?: string
  readonly ACCESS_ALLOWED_EMAILS?: string
}

/** Why the gate said no, and the status it answers with. `reason` is for the
 *  Worker's log; `message` is deliberately absent, because everything a
 *  rejected caller is told is in the status. */
export class AccessRejection extends Data.TaggedError('AccessRejection')<{
  readonly reason: string
  readonly status: 401 | 403 | 500
}> {}

/** The claims `verifyAdminAccess` verified, handed to the admin handlers as
 *  the `AdminSession`. Both are null only on the `dev` stand-down and on a
 *  claim that carries neither. */
export interface AdminClaims {
  readonly email: string | null
  readonly teamDomain: string | null
}

/** The answer to a request for the Admin: the claims, or the rejection. */
export type AdminGate = Result.Result<AdminClaims, AccessRejection>

/** The rejection as the response that answers the request. One place, so the
 *  three statuses the gate can produce are spelled once. */
export const rejectionResponse = (rejection: AccessRejection): Response =>
  new Response(JSON.stringify({ message: 'access denied' }), {
    status: rejection.status,
    headers: { 'content-type': 'application/json' },
  })

// ---------------------------------------------------------------------------
// the assertion's two decodable segments
// ---------------------------------------------------------------------------

/** The JWK fields verification reads. `n` and `e` are optional because a JWK of
 *  another type legitimately carries neither, and a key the verifier cannot
 *  assemble is a rejection rather than a malformed document. */
const Jwk = S.Struct({
  kid: S.String,
  kty: S.String,
  n: S.optional(S.String),
  e: S.optional(S.String),
  alg: S.optional(S.String),
})
type Jwk = typeof Jwk.Type

/** The JWKS document Access serves at `/cdn-cgi/access/certs`. `keys` is
 *  optional: an empty document is a team with no keys, which is the same
 *  answer as a key nobody can match. */
const JwksDocument = S.Struct({ keys: S.optional(S.Array(Jwk)) })

/** The JWT header. `alg` is checked for RS256 and `kid` selects the key, so
 *  both are optional here and required by the checks that follow — a header
 *  carrying neither is `unexpected alg`, not a parse failure. */
const AccessHeader = S.Struct({
  alg: S.optional(S.String),
  kid: S.optional(S.String),
})

/** The claims the gate reads. `exp` and `iss` are checked when present; a
 *  payload carrying neither still verifies, and the issuer falls back to the
 *  configured team domain (CONTEXT.md `Session`). */
const AccessPayload = S.Struct({
  exp: S.optional(S.Number),
  iat: S.optional(S.Number),
  email: S.optional(S.String),
  iss: S.optional(S.String),
})

/** `JSON.parse` as a total function, for the two base64url segments. */
const parseJson = Option.liftThrowable((raw: string): unknown => JSON.parse(raw))

/** One base64url JWT segment, decoded to its bytes. `None` for a segment
 *  `atob` refuses, which is what a token that is not a JWT looks like. */
const decodeBase64Url = Option.liftThrowable((segment: string): ArrayBuffer => {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const buffer = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i += 1) {
    view[i] = raw.charCodeAt(i)
  }
  return buffer
})

/** A JWT segment, decoded as `schema`. Parse, UTF-8, JSON and the declared
 *  shape are one total function, so a token that fails any of them is a single
 *  `None` rather than four `try` blocks. */
const decodeSegment = <A>(schema: S.ConstraintDecoder<A>, segment: string): Option.Option<A> =>
  Option.flatMap(decodeBase64Url(segment), (bytes) =>
    S.decodeUnknownOption(schema)(
      Option.getOrElse(parseJson(new TextDecoder().decode(new Uint8Array(bytes))), () => null),
    ),
  )

// ---------------------------------------------------------------------------
// the JWKS, cached per team
// ---------------------------------------------------------------------------

const JWKS_TTL = Duration.hours(1)

const reject = (reason: string, status: 401 | 403 | 500 = 401): AccessRejection =>
  new AccessRejection({ reason, status })

const fetchJwks = (
  teamDomain: string,
): Effect.Effect<ReadonlyArray<Jwk>, AccessRejection, HttpClient.HttpClient> =>
  HttpClient.get(`${teamDomain}/cdn-cgi/access/certs`).pipe(
    // `filterStatusOk` and `schemaBodyJson` are not dual — each takes the
    // response itself rather than an `Effect` of one — so they are applied
    // data-first. `schemaBodyJson` decodes the body against the document's
    // declared shape, which is why a team serving something else is a
    // rejection rather than a runtime surprise.
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(JwksDocument)),
    Effect.map((document) => document.keys ?? []),
    // An unreachable JWKS is this gate's own dependency failing, not a caller
    // being wrong: the reason carries the status so the log says which, and the
    // caller is told no either way.
    Effect.mapError((cause) => reject(`JWKS unavailable: ${String(cause)}`)),
  )

/** One entry per Access team. The site has one; the capacity is a bound on a
 *  map that would otherwise grow with every distinct `teamDomain` a request
 *  names, and the entries are hour-old JWKS documents. */
const jwksCache: Cache.Cache<
  string,
  ReadonlyArray<Jwk>,
  AccessRejection,
  HttpClient.HttpClient
> = Effect.runSync(
  Cache.make({
    capacity: 8,
    timeToLive: JWKS_TTL,
    // The lookup needs the HTTP client; the cache value itself does not, so
    // the cache is built once per isolate at module scope and every request
    // that misses a key brings its own `HttpClient`.
    requireServicesAt: 'lookup',
    lookup: (teamDomain: string) => fetchJwks(teamDomain),
  }),
)

/** Verify an Access JWT. Answers the claim's subject email and the issuer that
 *  vouched for the signature, or the rejection that says why not.
 *
 *  Every rejection travels the `Result`, including the two that come from a
 *  platform call that threw: the Effect channel is left for defects, so a caller
 *  cannot end up with a half-handled failure by forgetting one arm. */
export const verifyAccessToken = (
  token: string,
  teamDomain: string,
): Effect.Effect<
  Result.Result<
    { readonly email: string | undefined; readonly teamDomain: string },
    AccessRejection
  >,
  never,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const parts = token.split('.')
    const [rawHeader, rawPayload, rawSignature] = parts
    if (
      parts.length !== 3 ||
      rawHeader === undefined ||
      rawPayload === undefined ||
      rawSignature === undefined
    ) {
      return Result.fail(reject('malformed token'))
    }

    const header = Option.getOrElse(decodeSegment(AccessHeader, rawHeader), () => null)
    if (header === null) return Result.fail(reject('undecodable token'))
    if (header.alg !== 'RS256') return Result.fail(reject(`unexpected alg ${String(header.alg)}`))

    const payload = Option.getOrElse(decodeSegment(AccessPayload, rawPayload), () => null)
    if (payload === null) return Result.fail(reject('undecodable token'))

    const now = yield* DateTime.now.pipe(Effect.map(DateTime.toEpochMillis))
    if (payload.exp === undefined || payload.exp * 1000 < now) {
      return Result.fail(reject('expired token'))
    }
    if (payload.iss !== undefined && payload.iss !== teamDomain) {
      return Result.fail(reject('wrong issuer'))
    }

    const keys = yield* Effect.result(Cache.get(jwksCache, teamDomain))
    if (Result.isFailure(keys)) return Result.fail(keys.failure)
    const jwk = keys.success.find((candidate) => candidate.kid === header.kid)
    if (jwk === undefined || jwk.n === undefined || jwk.e === undefined) {
      return Result.fail(reject('unknown key id'))
    }

    // The three fields a usable JWK must carry, bound to names before they are
    // read inside the closure below. `jwk` is an Effect `Struct.Type`, and
    // TypeScript does not carry a property narrowing on such a type into a
    // closure, so `jwk.n` inside the `try` reads back as `string | undefined`
    // and no `importKey` overload matches.
    const jwkKty: string = jwk.kty
    const jwkModulus: string = jwk.n
    const jwkExponent: string = jwk.e

    // The RSA verify is Web Crypto, and Effect 4's `Crypto` service exposes
    // digests and randomness rather than signature verification, so these two
    // calls stay the platform's. They are the only `tryPromise` left here, and
    // each is lifted into the `Result` so a platform throw is a rejection with
    // a reason rather than a second, differently-shaped error channel.
    // The `Uint8Array` view rather than its `.buffer`: a `TextEncoder` result
    // may be a window onto a shared pool, in which case `.buffer` is the whole
    // pool instead of these two segments. Web Crypto takes a `BufferSource`,
    // so the view is both the correct and the intended argument.
    const key = yield* Effect.result(
      Effect.tryPromise({
        try: () =>
          crypto.subtle.importKey(
            'jwk',
            { kty: jwkKty, n: jwkModulus, e: jwkExponent, alg: 'RS256', ext: true },
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['verify'],
          ),
        catch: (cause) => reject(`unusable key: ${String(cause)}`),
      }),
    )
    if (Result.isFailure(key)) return Result.fail(key.failure)
    const signature = Option.getOrElse(decodeBase64Url(rawSignature), () => null)
    if (signature === null) return Result.fail(reject('undecodable signature'))
    const signingInput = new TextEncoder().encode(`${rawHeader}.${rawPayload}`)
    const valid = yield* Effect.result(
      Effect.tryPromise({
        // The `Uint8Array` view rather than its `.buffer`: a `TextEncoder` result
        // may be a window onto a shared pool, in which case `.buffer` is the whole
        // pool instead of these two segments. Web Crypto takes a `BufferSource`,
        // so the view is both the correct and the intended argument.
        try: () => crypto.subtle.verify('RSASSA-PKCS1-v1_5', key.success, signature, signingInput),
        catch: (cause) => reject(`signature check failed: ${String(cause)}`),
      }),
    )
    if (Result.isFailure(valid)) return Result.fail(valid.failure)
    if (!valid.success) return Result.fail(reject('bad signature'))
    // The issuer the claim names, which the check above already matched to the
    // team domain; the configured value is the fallback for a claim carrying
    // none, so the session is never a half-read claim.
    return Result.succeed({ email: payload.email, teamDomain: payload.iss ?? teamDomain })
  })

/**
 * The admin gate every Access-protected route runs. Answers the verified
 * claims the handlers use, or the rejection that becomes their status.
 *
 * A blank `ACCESS_TEAM_DOMAIN` only means "no Access here" on `dev`, where
 * Alchemy skips the Access applications (ADR 0003). On any other stage a blank
 * team domain is a misconfigured deploy and fails closed with 500, because
 * silently serving the Admin ungated is the one failure this gate must not
 * have.
 */
export const verifyAdminAccess = (
  request: Request,
  env: AccessEnv,
): Effect.Effect<AdminGate, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const teamDomain = (env.ACCESS_TEAM_DOMAIN ?? '').trim()
    if (teamDomain === '') {
      return env.STAGE === 'dev'
        ? Result.succeed<AdminClaims>({ email: null, teamDomain: null })
        : Result.fail(reject('server misconfigured: no ACCESS_TEAM_DOMAIN', 500))
    }
    const token = request.headers.get('Cf-Access-Jwt-Assertion')
    if (token === null) return Result.fail(reject('missing access token'))

    const verified = yield* verifyAccessToken(token, teamDomain)
    if (Result.isFailure(verified)) return Result.fail(verified.failure)

    const allowlist = (env.ACCESS_ALLOWED_EMAILS ?? '')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter((v) => v.length > 0)
    if (allowlist.length > 0) {
      const email = verified.success.email?.toLowerCase() ?? ''
      if (!allowlist.includes(email)) {
        return Result.fail(reject(`address not allowlisted: ${email || '(none)'}`, 403))
      }
    }
    // The claim's own email and issuer, handed on as verified: the handlers read
    // the session, they never recompute who the caller is.
    return Result.succeed({
      email: verified.success.email ?? null,
      teamDomain: verified.success.teamDomain,
    })
  })
