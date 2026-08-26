/**
 * Cloudflare Access JWT verification (ADR 0007, defense-in-depth layer).
 *
 * The edge (Cloudflare Access applications) is the primary gate; this module
 * independently verifies the `Cf-Access-Jwt-Assertion` token inside the
 * Worker so protection survives any Access misconfiguration. Signature
 * (RS256 against the team JWKS) and expiry are checked; `aud` pinning can be
 * added later without interface changes.
 *
 * When `teamDomain` is empty (local dev, where no Access exists) verification
 * is skipped; when set, a missing or invalid token fails closed.
 */

import { DateTime, Effect } from 'effect'

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
  let payload: { exp?: number; email?: string }
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
