import { describe, expect, it } from 'vitest'
import { clientKey, createRateLimiter } from './rate-limit'

describe('rate limiter', () => {
  it('allows up to the limit then rejects', () => {
    const limiter = createRateLimiter(3, 60_000)
    expect(limiter.check('ip', 0).allowed).toBe(true)
    expect(limiter.check('ip', 1_000).allowed).toBe(true)
    expect(limiter.check('ip', 2_000).allowed).toBe(true)
    const rejected = limiter.check('ip', 3_000)
    expect(rejected.allowed).toBe(false)
    expect(rejected.retryAfter).toBeGreaterThan(0)
  })

  it('slides the window', () => {
    const limiter = createRateLimiter(1, 60_000)
    expect(limiter.check('ip', 0).allowed).toBe(true)
    expect(limiter.check('ip', 1_000).allowed).toBe(false)
    expect(limiter.check('ip', 61_000).allowed).toBe(true)
  })

  it('tracks keys independently', () => {
    const limiter = createRateLimiter(1, 60_000)
    expect(limiter.check('a', 0).allowed).toBe(true)
    expect(limiter.check('b', 0).allowed).toBe(true)
    expect(limiter.check('a', 1_000).allowed).toBe(false)
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
