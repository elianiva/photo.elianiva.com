import { afterEach, describe, expect, it, vi } from 'vitest'
import { Effect, Layer, Result } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { verifyAdminAccess as verifyAdminAccessEffect, type AccessEnv, type AdminGate } from './access'
import worker from './api-worker'

/** The gate, run over the same fetch-backed HTTP client the Worker's own layer
 *  provides. Shadowed under the old name so every assertion below reads the
 *  same as it did before the gate became an `Effect`. */
const verifyAdminAccess = (request: Request, accessEnv: AccessEnv): Promise<AdminGate> =>
  Effect.runPromise(verifyAdminAccessEffect(request, accessEnv).pipe(Effect.provide(httpLayer)))

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

/** Serve the team's JWKS, the only network call JWT verification makes.
 *
 *  Two paths reach it, and each needs the transport named differently:
 *
 *  - A direct call to the gate below is handed `Fetch` explicitly, because
 *    `FetchHttpClient.Fetch` is a `Context.Reference` and a Reference memoises
 *    its default value on the reference object at first read, for the lifetime
 *    of the module (`Context.ts`, `defaultValueCacheKey`). A
 *    `vi.stubGlobal('fetch', …)` after the first request would be invisible to
 *    it, and every test after the first would be handed the first test's key.
 *  - A call that goes through `worker.fetch` reads `globalThis.fetch` per call
 *    (see `gateHttpLayer` in `api-worker.ts`), so the global stub is what that
 *    path sees.
 *
 *  Both read the same `currentJwk`, so one `serveJwks` drives both. */
let currentJwk: { kid: string; kty: string; n: string; e: string; alg: string } | undefined

const jwksBody = (): Response =>
  currentJwk === undefined
    ? new Response('no key configured', { status: 500 })
    : new Response(JSON.stringify({ keys: [currentJwk] }))

const jwksFetch = async (): Promise<Response> => jwksBody()

/** The same transport the Worker's own layer builds, over the stub above. */
const httpLayer = Layer.provide(
  FetchHttpClient.layer,
  Layer.succeed(FetchHttpClient.Fetch, jwksFetch),
)

const serveJwks = (key: SigningKey): void => {
  currentJwk = key.publicJwk
  vi.stubGlobal('fetch', vi.fn(jwksBody))
}

const adminRequest = (token?: string): Request =>
  new Request('https://photo-api.test/api/admin/rpc', {
    method: 'POST',
    ...(token === undefined ? {} : { headers: { 'Cf-Access-Jwt-Assertion': token } }),
  })

const env = (overrides: Partial<AccessEnv>): AccessEnv => ({
  STAGE: 'prod',
  ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
  ...overrides,
})

const outcome = (gate: AdminGate): number | 'allowed' =>
  Result.isSuccess(gate) ? 'allowed' : gate.failure.status

/** Fails the test if an admin route reads a binding after the gate should have rejected. */
const unbound = (): never => {
  throw new Error('the admin gate must reject before any binding is read')
}

/** A Worker env with nothing behind it. Every admin path exercised here is rejected by the gate. */
const workerEnv = (overrides: Partial<AccessEnv>): Parameters<typeof worker.fetch>[1] => ({
  STAGE: 'prod',
  ACCESS_TEAM_DOMAIN: '',
  // Every member the binding contracts are listed, not just the ones a test
  // happens to call: a member missing from this object would be a hole in the
  // env type rather than a failing test, and the gate is what has to stop any
  // of them being read.
  DB: { prepare: unbound, batch: unbound, exec: unbound, withSession: unbound, dump: unbound },
  PHOTOS: { get: unbound, head: unbound, list: unbound, put: unbound, delete: unbound },
  ...overrides,
})

afterEach(() => {
  currentJwk = undefined
  vi.unstubAllGlobals()
})

describe('admin access gate', () => {
  it('lets a blank team domain through on the dev stage', async () => {
    const gate = await verifyAdminAccess(
      adminRequest(),
      env({ STAGE: 'dev', ACCESS_TEAM_DOMAIN: '' }),
    )
    expect(outcome(gate)).toBe('allowed')
    // The dev stand-down is the one admitted state with no claims: there is no
    // Access assertion to read, and no signed-out state to report (ADR 0003).
    expect(gate).toEqual(Result.succeed({ email: null, teamDomain: null }))
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

describe('the claims the gate hands back', () => {
  it('carries the address and the team that vouched for it', async () => {
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

    expect(gate).toEqual(
      Result.succeed({ email: 'owner@photo.test', teamDomain: key.teamDomain }),
    )
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

    expect(allowed).toEqual(
      Result.succeed({ email: 'second@photo.test', teamDomain: key.teamDomain }),
    )
    expect(outcome(refused)).toBe(403)
  })

  it('reports no email when the assertion carries none, and still names the team', async () => {
    const key = await makeSigningKey()
    serveJwks(key)
    const valid = await signAssertion(key, { iss: key.teamDomain, exp: 4102444800 })

    const gate = await verifyAdminAccess(
      adminRequest(valid),
      env({ ACCESS_TEAM_DOMAIN: key.teamDomain }),
    )

    // The sidebar's `Sign out` row needs the team even with no address to
    // print, so the two claims stand or fall apart.
    expect(gate).toEqual(Result.succeed({ email: null, teamDomain: key.teamDomain }))
  })

  it('falls back to the configured team when the assertion carries no issuer', async () => {
    const key = await makeSigningKey()
    serveJwks(key)
    const valid = await signAssertion(key, { exp: 4102444800, email: 'owner@photo.test' })

    const gate = await verifyAdminAccess(
      adminRequest(valid),
      env({ ACCESS_TEAM_DOMAIN: key.teamDomain }),
    )

    // An `iss` is optional in the verifier, and a session is never half-read.
    expect(gate).toEqual(
      Result.succeed({ email: 'owner@photo.test', teamDomain: key.teamDomain }),
    )
  })
})

describe('admin routes wired to the gate', () => {
  it('answer 500 for a blank team domain off the dev stage', async () => {
    for (const path of ['/api/admin/rpc', '/api/upload']) {
      const response = await worker.fetch(
        new Request(`https://photo-api.test${path}`, { method: 'POST' }),
        workerEnv({ STAGE: 'prod', ACCESS_TEAM_DOMAIN: '' }),
      )
      expect([path, response.status]).toEqual([path, 500])
    }
  })

  it('answers a GetSession RPC with the claims the gate verified', async () => {
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
      new Request('https://photo-api.test/api/admin/rpc', {
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
    )

    expect(response.status).toBe(200)
    // The server decodes a request or an array of them and answers with the
    // responses, so the envelope is an array of per-request exits.
    const body: unknown = await response.json()
    expect(body).toEqual([
      {
        _tag: 'Exit',
        requestId: 'req-1',
        exit: {
          _tag: 'Success',
          value: { email: 'owner@photo.test', teamDomain: key.teamDomain },
        },
      },
    ])
  })
})

describe('the paths the app asks for', () => {
  // Effect's HTTP RPC client appends a slash to the URL it is given, so both
  // groups are addressed with one: `prependUrl('/api/rpc')` plus a request path
  // of `''` joins into `/api/rpc/`. The Worker matches each path by hand, so a
  // trailing slash it does not account for is the Not found at the bottom of
  // `fetch` — from the site's own reads, not from a stranger's.
  it('serves the admin group with and without the trailing slash', async () => {
    const key = await makeSigningKey()
    serveJwks(key)
    const token = await signAssertion(key, {
      iss: key.teamDomain,
      exp: 4102444800,
      email: 'owner@photo.test',
    })

    for (const path of ['/api/admin/rpc', '/api/admin/rpc/']) {
      const response = await worker.fetch(
        new Request(`https://photo-api.test${path}`, {
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
      )

      expect([path, response.status]).toEqual([path, 200])
    }
  })

  it('serves the public group with and without the trailing slash', async () => {
    const ask = async (path: string): Promise<{ status: number; body: unknown }> => {
      const response = await worker.fetch(
        new Request(`https://photo-api.test${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            _tag: 'Request',
            id: 'req-1',
            tag: 'GetSession',
            payload: {},
            headers: [],
          }),
        }),
        // The dev stand-down: no team domain, so the public route answers
        // without an assertion.
        workerEnv({ STAGE: 'dev', ACCESS_TEAM_DOMAIN: '' }),
      )
      return { status: response.status, body: await response.json() }
    }

    const plain = await ask('/api/rpc')
    const slashed = await ask('/api/rpc/')

    expect(plain.status).toBe(200)
    expect(slashed.status).toBe(200)
    // The same group answered both, so the trailing slash reaches the public
    // handlers rather than the Worker's Not found. `GetSession` is the admin
    // group's tag and this path never mounts it, which is why the answer is a
    // failure — a claim about the routing, not a passing test in disguise.
    expect(slashed.body).toEqual(plain.body)
  })
})

describe('CORS for the two dev origins', () => {
  // The site's dev server (5173) and the API Worker (13371) are separate
  // origins, so the browser preflights the admin group's POST before it is
  // sent — the dev pair is a real CORS client, not a same-origin one.
  //
  // In production they are the same origin, so CORS is a development-only
  // concern and this list is the whole of it. That narrowing is the fix for the
  // Admin's login rather than a tidy-up: a cross-origin preflight carries no
  // cookies by design, so Cloudflare Access answered it with a bare 403 before
  // the Worker was reached, and the Admin could never read anything.
  const preflight = (origin: string, path = '/api/admin/rpc'): Request =>
    new Request(`https://photo-api.test${path}`, {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST' },
    })

  it('answers the dev site origin', async () => {
    const response = await worker.fetch(preflight('http://localhost:5173'), workerEnv({}))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(response.headers.get('access-control-allow-headers')).toContain('content-type')
    expect(response.headers.get('vary')).toBe('Origin')
  })

  it('allows the trace headers the client stamps on every request', async () => {
    // Effect's HTTP client puts `b3` and `traceparent` on every request it
    // makes, so the dev browser asks for them in the preflight. A preflight
    // that does not answer with the headers it was asked about is a failed
    // preflight: the browser drops the POST, the Worker never sees it, and the
    // Admin reads it as an unproven session rather than as a CORS failure.
    const response = await worker.fetch(preflight('http://localhost:5173'), workerEnv({}))
    const allowed = (response.headers.get('access-control-allow-headers') ?? '')
      .split(',')
      .map((header) => header.trim().toLowerCase())
    expect(allowed).toContain('b3')
    expect(allowed).toContain('traceparent')
  })

  it('carries the header on an answer, not only on the preflight', async () => {
    const response = await worker.fetch(
      new Request('https://photo-api.test/not-a-route', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173' },
      }),
      workerEnv({}),
    )
    expect(response.status).toBe(404)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
  })

  it('refuses a preflight from an origin outside the list', async () => {
    const response = await worker.fetch(preflight('https://not-photo.test'), workerEnv({}))
    // The refusal is the absent header, and that is the part a browser
    // enforces: a preflight answered without `access-control-allow-origin`
    // fails whatever its status. The status did change — the router's CORS
    // middleware answers every preflight `204` and leaves the origin decision
    // to the headers, where the hand-written dispatcher used to answer `403` —
    // so it is asserted here as `204` to keep the change visible rather than
    // silently accepted.
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    // `vary: Origin` still has to be there, or a cache could hand one origin's
    // allowance to another.
    expect(response.headers.get('vary')).toContain('Origin')
  })

  it('emits nothing for the site itself, which is same-origin and needs none', async () => {
    // The site hostname used to be on this list. It is not any more: with the
    // API mounted on a route of the site's own hostname there is no cross-origin
    // exchange in production, and a CORS header here would only be a second
    // description of a topology that no longer exists.
    const response = await worker.fetch(preflight('https://photo.elianiva.com'), workerEnv({}))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})
