import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyAdminAccess, type AccessEnv, type AdminGate } from './access'
import worker from './api-worker'

const TEAM_DOMAIN = 'https://team.test'

// `verifyAccessToken` caches a team's JWKS for an hour, so each key gets its
// own team domain and the tests never read another test's cache entry.
let teamsCreated = 0
const nextTeamDomain = (): string => {
  teamsCreated += 1
  return `https://team-${teamsCreated}.test`
}
const KID = 'test-key'

const base64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const encodeSegment = (value: unknown): string =>
  base64Url(new TextEncoder().encode(JSON.stringify(value)))

interface SigningKey {
  readonly teamDomain: string
  readonly privateKey: CryptoKey
  readonly publicJwk: { kid: string; kty: string; n: string; e: string; alg: string }
}

const makeSigningKey = async (): Promise<SigningKey> => {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return {
    teamDomain: nextTeamDomain(),
    privateKey: pair.privateKey,
    publicJwk: { kid: KID, kty: jwk.kty ?? '', n: jwk.n ?? '', e: jwk.e ?? '', alg: 'RS256' },
  }
}

/** A Cloudflare Access assertion: RS256 over `{ alg: 'RS256', kid }` and the payload. */
const signAssertion = async (
  key: SigningKey,
  payload: Record<string, unknown>,
): Promise<string> => {
  const header = encodeSegment({ alg: 'RS256', kid: KID, typ: 'JWT' })
  const body = encodeSegment(payload)
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key.privateKey,
    new TextEncoder().encode(`${header}.${body}`),
  )
  return `${header}.${body}.${base64Url(new Uint8Array(signature))}`
}

/** Serve the team's JWKS, the only network call JWT verification makes. */
const serveJwks = (key: SigningKey): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ keys: [key.publicJwk] }))),
  )
}

const adminRequest = (token?: string): Request =>
  new Request('https://photo-api.test/admin/rpc', {
    method: 'POST',
    ...(token === undefined ? {} : { headers: { 'Cf-Access-Jwt-Assertion': token } }),
  })

const env = (overrides: Partial<AccessEnv>): AccessEnv => ({
  STAGE: 'prod',
  ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
  ...overrides,
})

const outcome = (gate: AdminGate): number | 'allowed' =>
  gate.ok ? 'allowed' : gate.response.status

/** Fails the test if an admin route reads a binding after the gate should have rejected. */
const unbound = (): never => {
  throw new Error('the admin gate must reject before any binding is read')
}

/** A Worker env with nothing behind it. Every admin path exercised here is rejected by the gate. */
const workerEnv = (overrides: Partial<AccessEnv>): Parameters<typeof worker.fetch>[1] => ({
  STAGE: 'prod',
  ACCESS_TEAM_DOMAIN: '',
  DB: { prepare: unbound, batch: unbound },
  PHOTOS: { get: unbound, put: unbound, delete: unbound },
  ...overrides,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('admin access gate', () => {
  it('lets a blank team domain through on the dev stage', async () => {
    const gate = await verifyAdminAccess(
      adminRequest(),
      env({ STAGE: 'dev', ACCESS_TEAM_DOMAIN: '' }),
    )
    expect(outcome(gate)).toBe('allowed')
    // The dev stand-down is the one admitted state with no email: there is no
    // Access claim to read, and no signed-out state to report (ADR 0007).
    expect(gate).toEqual({ ok: true, email: null })
  })

  it('fails closed on a blank team domain off the dev stage', async () => {
    const gate = await verifyAdminAccess(
      adminRequest(),
      env({ STAGE: 'prod', ACCESS_TEAM_DOMAIN: '' }),
    )
    expect(outcome(gate)).toBe(500)
  })

  it('admits a valid assertion and rejects a tampered one', async () => {
    const key = await makeSigningKey()
    serveJwks(key)
    const payload = { iss: key.teamDomain, exp: 4102444800, email: 'owner@photo.test' }
    const valid = await signAssertion(key, payload)
    const team = env({ ACCESS_TEAM_DOMAIN: key.teamDomain })

    expect(outcome(await verifyAdminAccess(adminRequest(valid), team))).toBe('allowed')
    expect(outcome(await verifyAdminAccess(adminRequest(`${valid}x`), team))).toBe(401)
  })

  it('rejects a request with no assertion once a team domain is set', async () => {
    expect(outcome(await verifyAdminAccess(adminRequest(), env({})))).toBe(401)
  })

  it('keeps verifying on the dev stage when a team domain is set', async () => {
    const key = await makeSigningKey()
    serveJwks(key)
    const valid = await signAssertion(key, {
      iss: key.teamDomain,
      exp: 4102444800,
      email: 'owner@photo.test',
    })
    const team = env({ STAGE: 'dev', ACCESS_TEAM_DOMAIN: key.teamDomain })

    expect(outcome(await verifyAdminAccess(adminRequest(valid), team))).toBe('allowed')
    expect(outcome(await verifyAdminAccess(adminRequest(`${valid}x`), team))).toBe(401)
  })
})

describe('the email the gate hands back', () => {
  it('carries the address from the assertion', async () => {
    const key = await makeSigningKey()
    serveJwks(key)
    const valid = await signAssertion(key, {
      iss: key.teamDomain,
      exp: 4102444800,
      email: 'owner@photo.test',
    })

    const gate = await verifyAdminAccess(
      adminRequest(valid),
      env({ ACCESS_TEAM_DOMAIN: key.teamDomain }),
    )

    expect(gate).toEqual({ ok: true, email: 'owner@photo.test' })
  })

  it('carries an allowlisted address, and withholds one that is not', async () => {
    const key = await makeSigningKey()
    serveJwks(key)
    const team = env({
      ACCESS_TEAM_DOMAIN: key.teamDomain,
      ACCESS_ALLOWED_EMAILS: 'owner@photo.test, second@photo.test',
    })

    const allowed = await verifyAdminAccess(
      adminRequest(
        await signAssertion(key, {
          iss: key.teamDomain,
          exp: 4102444800,
          email: 'second@photo.test',
        }),
      ),
      team,
    )
    const refused = await verifyAdminAccess(
      adminRequest(
        await signAssertion(key, {
          iss: key.teamDomain,
          exp: 4102444800,
          email: 'stranger@photo.test',
        }),
      ),
      team,
    )

    expect(allowed).toEqual({ ok: true, email: 'second@photo.test' })
    expect(outcome(refused)).toBe(403)
  })

  it('is null when the assertion carries no email', async () => {
    const key = await makeSigningKey()
    serveJwks(key)
    const valid = await signAssertion(key, { iss: key.teamDomain, exp: 4102444800 })

    const gate = await verifyAdminAccess(
      adminRequest(valid),
      env({ ACCESS_TEAM_DOMAIN: key.teamDomain }),
    )

    expect(gate).toEqual({ ok: true, email: null })
  })
})

describe('admin routes wired to the gate', () => {
  it('answer 500 for a blank team domain off the dev stage', async () => {
    for (const path of ['/admin/rpc', '/upload']) {
      const response = await worker.fetch(
        new Request(`https://photo-api.test${path}`, { method: 'POST' }),
        workerEnv({ STAGE: 'prod', ACCESS_TEAM_DOMAIN: '' }),
        {},
      )
      expect([path, response.status]).toEqual([path, 500])
    }
  })

  it('answers a GetSession RPC with the email the gate verified', async () => {
    const key = await makeSigningKey()
    serveJwks(key)
    const token = await signAssertion(key, {
      iss: key.teamDomain,
      exp: 4102444800,
      email: 'owner@photo.test',
    })

    // `GetSession` reads no binding, so the unbound env stands: a handler that
    // reached for D1 on this path would throw rather than answer.
    const response = await worker.fetch(
      new Request('https://photo-api.test/admin/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Cf-Access-Jwt-Assertion': token },
        body: JSON.stringify({
          _tag: 'Request',
          id: 'req-1',
          tag: 'GetSession',
          payload: {},
          headers: [],
        }),
      }),
      workerEnv({ ACCESS_TEAM_DOMAIN: key.teamDomain }),
      {},
    )

    expect(response.status).toBe(200)
    // The server decodes a request or an array of them and answers with the
    // responses, so the envelope is an array of per-request exits.
    const body: unknown = await response.json()
    expect(body).toEqual([
      {
        _tag: 'Exit',
        requestId: 'req-1',
        exit: { _tag: 'Success', value: { email: 'owner@photo.test' } },
      },
    ])
  })
})
