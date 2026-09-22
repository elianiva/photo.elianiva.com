/**
 * Fixed-window in-memory rate limiter for the API Worker.
 *
 * One limiter instance per route class, module-scoped so it survives across
 * requests within an isolate. Not shared across isolates — limits are
 * approximate under Cloudflare's multi-isolate routing, which is fine for
 * abuse damping (not billing).
 */

export interface RateLimitResult {
  readonly allowed: boolean
  /** Seconds until retry when rejected, 0 when allowed. */
  readonly retryAfter: number
}

export const createRateLimiter = (limit: number, windowMs: number) => {
  const hits = new Map<string, Array<number>>()

  const check = (key: string, now: number = Date.now()): RateLimitResult => {
    const cutoff = now - windowMs
    const recent = (hits.get(key) ?? []).filter((at) => at > cutoff)
    if (recent.length >= limit) {
      const oldest = recent[0] ?? now
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))
      hits.set(key, recent)
      return { allowed: false, retryAfter }
    }
    recent.push(now)
    hits.set(key, recent)
    if (hits.size > 10_000) {
      const oldestKey = hits.keys().next()
      if (!oldestKey.done) hits.delete(oldestKey.value)
    }
    return { allowed: true, retryAfter: 0 }
  }

  const reset = (): void => {
    hits.clear()
  }

  return { check, reset }
}

/** Client identity for limiting: Cloudflare's connecting IP, else first forwarded hop. */
export const clientKey = (request: Request): string => {
  const direct = request.headers.get('cf-connecting-ip')?.trim()
  if (direct !== undefined && direct !== '') return direct
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (forwarded !== undefined && forwarded !== '') return forwarded
  return 'unknown'
}
