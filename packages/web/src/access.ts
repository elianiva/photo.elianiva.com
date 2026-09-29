/**
 * Cloudflare Access JWT verification (ADR 0007, defense-in-depth layer).
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
 * The gate hands the claims it verified back with the answer, so `GetSession`
 * can report the identity this module already checked rather than computing a
 * second one.
 */

import { DateTime, Effect } from 'effect'
import type { AdminSession } from '@photo/api'

/** The env bindings the admin gate reads. */
export interface AccessEnv {
  /** Alchemy stage name. `dev` is the only stage with no Access edge. */
  readonly STAGE: string
  readonly ACCESS_TEAM_DOMAIN?: string
  readonly ACCESS_ALLOWED_EMAILS?: string
}

/** The gate's whole answer to a request: either the rejection it failed with,
 *  or the claims it verified on the way through. Never both. The session rides
 *  out because `GetSession` reports the claim this module already checked —
 *  verifying it a second time in the handler would be a second, unchecked
 *  answer to the same question (ADR 0007). */
export interface AdminAccess {
  readonly rejection: Response | null
  readonly session: AdminSession
}

/** Where the gate stands down there is no Access to describe, so the session
 *  says so rather than inventing an identity. */
const NO_SESSION: AdminSession = { email: null, teamDomain: '' }

const jsonError = (message: string, status: number): Response =>
  new Response(JSON.stringify({ message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })

interface Jwk {
  readonly kid: string
  readonly kty: string
  readonly n?: string
  readonly e?: string
  readonly alg?: string
}

const jwksCache = new Map<string, { keys: ReadonlyArray<Jwk>; fetchedAt: number }>()
const JWKS_TTL_MS = 60 * 60 * 1000

const base64UrlDecodeToBuffer = (input: string): ArrayBuffer => {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const buffer = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i += 1) {
    view[i] = raw.charCodeAt(i)
  }
  return buffer
}

/** Current wall-clock millis via the effect DateTime module (lint rule). */
const currentMillis = (): number => Effect.runSync(Effect.map(DateTime.now, DateTime.toEpochMillis))

const fetchJwks = async (teamDomain: string): Promise<ReadonlyArray<Jwk>> => {
  const cached = jwksCache.get(teamDomain)
  if (cached !== undefined && currentMillis() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys
  }
  const response = await fetch(`${teamDomain}/cdn-cgi/access/certs`)
  if (!response.ok) throw new Error(`Failed to fetch Access JWKS: ${response.status}`)
  const body: { keys?: ReadonlyArray<Jwk> } = await response.json()
  const keys = body.keys ?? []
  jwksCache.set(teamDomain, { keys, fetchedAt: currentMillis() })
  return keys
}

/** Verify an Access JWT. Returns the subject email when valid. */
export const verifyAccessToken = async (
  token: string,
  teamDomain: string,
): Promise<{ ok: true; email: string | undefined } | { ok: false; reason: string }> => {
  const parts = token.split('.')
  if (
    parts.length !== 3 ||
    parts[0] === undefined ||
    parts[1] === undefined ||
    parts[2] === undefined
  ) {
    return { ok: false, reason: 'malformed token' }
  }
  let header: { kid?: string; alg?: string }
  let payload: { exp?: number; iat?: number; email?: string; iss?: string; aud?: unknown }
  try {
    header = JSON.parse(new TextDecoder().decode(new Uint8Array(base64UrlDecodeToBuffer(parts[0]))))
    payload = JSON.parse(
      new TextDecoder().decode(new Uint8Array(base64UrlDecodeToBuffer(parts[1]))),
    )
  } catch {
    return { ok: false, reason: 'undecodable token' }
  }
  if (header.alg !== 'RS256') return { ok: false, reason: `unexpected alg ${String(header.alg)}` }
  const exp = payload.exp
  if (typeof exp !== 'number' || exp * 1000 < currentMillis())
    return { ok: false, reason: 'expired token' }
  if (typeof payload.iss === 'string' && payload.iss !== teamDomain) {
    return { ok: false, reason: 'wrong issuer' }
  }

  let keys: ReadonlyArray<Jwk>
  try {
    keys = await fetchJwks(teamDomain)
  } catch (cause) {
    return { ok: false, reason: `JWKS unavailable: ${String(cause)}` }
  }
  const jwk = keys.find((candidate) => candidate.kid === header.kid)
  if (jwk === undefined || jwk.n === undefined || jwk.e === undefined) {
    return { ok: false, reason: 'unknown key id' }
  }

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  const data = signingInput.buffer
  const signature = base64UrlDecodeToBuffer(parts[2])
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data)
  if (!valid) return { ok: false, reason: 'bad signature' }
  return { ok: true, email: payload.email }
}

/**
 * The admin gate every Access-protected route runs. Returns the rejection
 * alongside the session it admitted, or `null`/`NO_SESSION` where the gate
 * stood down.
 *
 * A blank `ACCESS_TEAM_DOMAIN` only means "no Access here" on `dev`, where
 * Alchemy skips the Access applications (ADR 0007). On any other stage a blank
 * team domain is a misconfigured deploy and fails closed with 500, because
 * silently serving the Admin ungated is the one failure this gate must not
 * have.
 */
export const verifyAdminAccess = async (request: Request, env: AccessEnv): Promise<AdminAccess> => {
  const teamDomain = (env.ACCESS_TEAM_DOMAIN ?? '').trim()
  if (teamDomain === '') {
    if (env.STAGE === 'dev') return { rejection: null, session: NO_SESSION }
    return { rejection: jsonError('server misconfigured', 500), session: NO_SESSION }
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (token === null) {
    return { rejection: jsonError('missing access token', 401), session: NO_SESSION }
  }
  const result = await verifyAccessToken(token, teamDomain)
  if (!result.ok) {
    return { rejection: jsonError('access denied', 401), session: NO_SESSION }
  }
  const allowlist = (env.ACCESS_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0)
  if (allowlist.length > 0) {
    const email = result.email?.toLowerCase() ?? ''
    if (!allowlist.includes(email)) {
      return { rejection: jsonError('access denied', 403), session: NO_SESSION }
    }
  }
  return { rejection: null, session: { email: result.email ?? null, teamDomain } }
}
