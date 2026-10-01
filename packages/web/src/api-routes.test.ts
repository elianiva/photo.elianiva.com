import { describe, expect, it } from 'vitest'
import worker from './api-worker'
import type { WebsiteEnv } from '../../../alchemy.run'
import { ADMIN_RPC_PATH, HEALTH_PATH, IMAGE_PATH, RPC_PATH, UPLOAD_PATH } from './lib/api'

/**
 * The Worker's routing.
 *
 * `access.test.ts` drives the gate through the real `fetch`, so it already
 * proves the two gated routes are mounted and refuse. What it cannot see is
 * everything else the dispatch does: which paths exist, which methods they
 * answer, what an unknown path answers, and the trailing-slash rule the RPC
 * client depends on. Those are the contracts the hand-written `if`-chain used to
 * carry, and they are the ones a refactor of the dispatcher would quietly break.
 */

/** A D1 binding that answers only what the health probe asks, and refuses
 *  everything else loudly — a probe that stopped being a real round trip would
 *  still answer `200` against a stub like this, so it throws rather than
 *  returning a plausible row. */
const d1 = (answer: () => Promise<unknown>): WebsiteEnv['DB'] => {
  const partial = {
    prepare: (query: string) => {
      if (!query.includes('SELECT 1')) {
        throw new Error(`unexpected query: ${query}`)
      }
      return {
        bind: () => ({ all: answer, first: answer, run: answer }),
        all: answer,
        first: answer,
        run: answer,
      }
    },
    batch: () => {
      throw new Error('unexpected batch')
    },
    exec: () => {
      throw new Error('unexpected exec')
    },
    withSession: () => {
      throw new Error('unexpected session')
    },
    dump: () => {
      throw new Error('unexpected dump')
    },
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a partial D1 is the point: the probe must fail loudly on anything it was not written to answer, which is the property under test
  return partial as unknown as WebsiteEnv['DB']
}

const env = (overrides: Partial<WebsiteEnv> = {}): WebsiteEnv => ({
  STAGE: 'dev',
  ACCESS_TEAM_DOMAIN: '',
  DB: d1(async () => ({ ok: 1 })),
  PHOTOS: {
    get: async () => null,
    head: async () => null,
    list: async () => ({ objects: [], truncated: false }),
    put: async () => undefined,
    delete: async () => undefined,
  },
  ...overrides,
})

const at = (path: string, init?: RequestInit): Promise<Response> =>
  worker.fetch(new Request(`https://photo-api.test${path}`, init), env())

describe("the API Worker's routes", () => {
  it('answers the health probe with a real round trip', async () => {
    const response = await at(HEALTH_PATH)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('reports 503 when the database is not answering', async () => {
    const failing = env({
      DB: d1(async () => {
        throw new Error('no database')
      }),
    })
    const response = await worker.fetch(
      new Request(`https://photo-api.test${HEALTH_PATH}`),
      failing,
    )
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false })
  })

  it('answers the public RPC path with or without its trailing slash', async () => {
    // Effect's HTTP RPC client appends the slash to the URL it is given, so the
    // app asks for `/api/rpc/` where the route is declared `/api/rpc`. Both must
    // reach the group; the hand-written dispatcher normalised this by hand for
    // one path, and the router does it for all of them.
    for (const path of [RPC_PATH, `${RPC_PATH}/`]) {
      const response = await at(path, { method: 'POST', body: '{}' })
      // Not 404: the group answered. Whether the payload satisfies it is the
      // group's business, not the router's.
      expect([path, response.status]).not.toEqual([path, 404])
    }
  })

  it('does not answer the admin group from the public path', async () => {
    const response = await at(ADMIN_RPC_PATH, { method: 'POST', body: '{}' })
    // The admin group is mounted under its own path and gated. On the dev stage
    // a blank team domain lets the gate through, so what matters is that the
    // two paths are not the same route.
    expect(response.status).not.toBe(404)
    expect(ADMIN_RPC_PATH).not.toBe(RPC_PATH)
  })

  it('answers the image proxy for a key under its prefix', async () => {
    // The key is a path parameter now, so the prefix is owned by the route
    // rather than by a `startsWith` in the dispatcher.
    const missing = await at(`${IMAGE_PATH}/originals/absent.jpg`)
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toEqual({ message: 'not found' })
  })

  it('refuses an image key that is not under originals/', async () => {
    for (const key of ['../secrets', 'other/thing.jpg', '%00']) {
      const response = await at(`${IMAGE_PATH}/${key}`)
      expect([key, response.status]).toEqual([key, 404])
    }
  })

  it('answers 404 for a path it does not serve', async () => {
    for (const path of ['/', '/api', '/api/nope', `${UPLOAD_PATH}/extra`]) {
      const response = await at(path)
      expect([path, response.status]).toEqual([path, 404])
    }
  })

  it('answers the upload path only for POST', async () => {
    // Mounted for one method: a GET on it is not the upload, so it is a 404
    // rather than a gate refusal that would read as an unproven session.
    const response = await at(UPLOAD_PATH)
    expect(response.status).toBe(404)
  })

  it('puts the security headers on every answer, refusals included', async () => {
    for (const path of [HEALTH_PATH, '/api/nope']) {
      const response = await at(path)
      expect([path, response.headers.get('x-content-type-options')]).toEqual([path, 'nosniff'])
      expect([path, response.headers.get('referrer-policy')]).toEqual([
        path,
        'strict-origin-when-cross-origin',
      ])
    }
  })
})
