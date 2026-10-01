import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { TestClock } from 'effect/testing'
import { RateLimit, RateLimitLive, clientKey } from './rate-limit'
import type { RateLimitResult } from './rate-limit'

/** One limiter, checked at each of `offsets` with the clock moved to it — which
 *  is how the window slides now that the limiter reads the fiber's `Clock`
 *  rather than a `now` argument. */
const checkAt = (limit: number, key: string, offsets: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    const limiter = yield* RateLimit
    const results: Array<RateLimitResult> = []
    for (const offset of offsets) {
      yield* TestClock.setTime(offset)
      results.push(yield* limiter.check(key))
    }
    return results
  })

/** `TestClock.layer()` is provided explicitly: the `TestClock` reference's
 *  default value is not the controllable clock `setTime` drives. */
const run = (limit: number, key: string, offsets: ReadonlyArray<number>) =>
  Effect.runPromise(
    checkAt(limit, key, offsets).pipe(
      Effect.provide(RateLimitLive(limit, 60_000)),
      Effect.provide(TestClock.layer()),
    ),
  )

describe('rate limiter', () => {
  it('allows up to the limit then rejects', async () => {
    const results = await run(3, 'ip', [0, 1_000, 2_000, 3_000])
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false])
    const rejected = results[3]
    expect(rejected?.allowed).toBe(false)
    expect(rejected?.retryAfter).toBeGreaterThan(0)
  })

  it('slides the window', async () => {
    const results = await run(1, 'ip', [0, 1_000, 61_000])
    expect(results.map((r) => r.allowed)).toEqual([true, false, true])
  })

  it('tracks keys independently', async () => {
    // One limiter, two keys: reading one key's window must not consume the other.
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const limiter = yield* RateLimit
        yield* TestClock.setTime(0)
        const a1 = yield* limiter.check('a')
        const b1 = yield* limiter.check('b')
        yield* TestClock.setTime(1_000)
        const a2 = yield* limiter.check('a')
        return { a1, b1, a2 }
      }).pipe(Effect.provide(RateLimitLive(1, 60_000)), Effect.provide(TestClock.layer())),
    )
    expect(results.a1.allowed).toBe(true)
    expect(results.b1.allowed).toBe(true)
    expect(results.a2.allowed).toBe(false)
  })

  it('reports zero retry seconds when a request is allowed', async () => {
    const results = await run(2, 'ip', [0])
    expect(results[0]).toEqual({ allowed: true, retryAfter: 0 })
  })

  it('drops a key once its window has fully passed', async () => {
    // The same key, checked twice a whole window apart, is two independent
    // windows rather than one that never releases.
    const results = await run(5, 'ip', [0, 60_001])
    expect(results.map((r) => r.allowed)).toEqual([true, true])
  })
})

describe('clientKey', () => {
  it('prefers cf-connecting-ip', () => {
    const req = new Request('https://x.test/', {
      headers: { 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' },
    })
    expect(clientKey(req)).toBe('1.2.3.4')
  })

  it('falls back to forwarded-for then unknown', () => {
    const forwarded = new Request('https://x.test/', {
      headers: { 'x-forwarded-for': '5.6.7.8, 9.9.9.9' },
    })
    expect(clientKey(forwarded)).toBe('5.6.7.8')
    expect(clientKey(new Request('https://x.test/'))).toBe('unknown')
  })
})
