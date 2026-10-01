/**
 * Fixed-window in-memory rate limiting for the API Worker.
 *
 * One limiter per route class, provided as a Layer so a route's window is named
 * where the route is wired rather than in a module-level `Map` three routes
 * share. Counters live in the isolate, so limits are approximate under
 * Cloudflare's multi-isolate routing — fine for abuse damping, not for billing.
 *
 * The clock is the fiber's `Clock`, not `Date.now()`, so a limiter is
 * deterministic under a `TestClock` and the production path has no way to read
 * a time that is not the one the runtime reports.
 *
 * **Why this is not `effect/persistence/RateLimiter`.** That module is
 * the obvious candidate — a per-key fixed-window counter over an in-memory
 * store — and it does work on the pinned `effect@4.0.0`, which graduated it
 * to `effect/persistence/…`. It is not used
 * because its `"fixed-window"` algorithm is a *leaky bucket*, not a window, and
 * the two answer differently on a route that fronts an auth gate:
 *
 *  - It refills `limit` tokens across `window` and lets an over-limit request
 *    borrow, so a client that keeps hammering never recovers: measured at
 *    `limit: 1, window: 60s`, the answer stays `delay = 59s` at t = 1s, 61s,
 *    121s and 181s. The old window answers 401-free at t = 61s, because the
 *    first hit has aged out.
 *  - Its `resetAfter` is the time until the window is *whole*, not until this
 *    key has room, so a rejected upload carries `retry-after: 57` where the
 *    window carried the time until the oldest hit expired.
 *
 * Both are defensible for a burst guard; a leaky bucket is arguably the better
 * abuse damper. Changing the semantics of the gate in front of `/api/upload` is
 * a product decision rather than a refactor, so the algorithm stays and the
 * swap is one `check` body. The Effect shape — a service, a Layer per route, a
 * `Clock` rather than `Date.now` — is the part that was worth taking.
 */

import { Clock, Context, Effect, Layer } from 'effect'

/** One request's answer. `retryAfter` is seconds until the window has room
 *  again, and is 0 when the request was allowed. */
export interface RateLimitResult {
  readonly allowed: boolean
  readonly retryAfter: number
}

/** A limiter for one route class. Named apart from the `RateLimit` service tag
 *  below: a `Context.Service` tag and the shape it carries cannot share a name
 *  without the tag winning in type position, which is the same split
 *  `PhotoService` / `PhotoServiceContract` makes. */
export interface RateLimitContract {
  readonly check: (key: string) => Effect.Effect<RateLimitResult>
}

export class RateLimit extends Context.Service<RateLimit, RateLimitContract>()('photo/RateLimit') {}

/** Distinct keys held before the oldest is evicted. */
const KEY_CAP = 10_000

/** A limiter allowing `limit` requests per `windowMs`, per key.
 *
 *  A key's hits are kept as the timestamps of the window still in play and
 *  pruned on every check, so a key nobody asks about again leaves nothing
 *  behind. `KEY_CAP` bounds the table for what pruning cannot reach: a flood of
 *  distinct keys inside one window, where the oldest is dropped to make room
 *  rather than growing the map without limit. */
export const RateLimitLive = (limit: number, windowMs: number): Layer.Layer<RateLimit> =>
  Layer.sync(RateLimit, () => {
    const hits = new Map<string, Array<number>>()

    const check = (key: string): Effect.Effect<RateLimitResult> =>
      Clock.currentTimeMillis.pipe(
        Effect.map((now) => {
          const cutoff = now - windowMs
          const recent = (hits.get(key) ?? []).filter((at) => at > cutoff)
          if (recent.length >= limit) {
            const oldest = recent[0] ?? now
            hits.set(key, recent)
            return {
              allowed: false,
              retryAfter: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
            }
          }
          recent.push(now)
          hits.set(key, recent)
          if (hits.size > KEY_CAP) {
            const oldestKey = hits.keys().next()
            if (!oldestKey.done) hits.delete(oldestKey.value)
          }
          return { allowed: true, retryAfter: 0 }
        }),
      )

    return RateLimit.of({ check })
  })

/** Client identity for limiting: Cloudflare's connecting IP, else first forwarded hop. */
export const clientKey = (request: Request): string => {
  const direct = request.headers.get('cf-connecting-ip')?.trim()
  if (direct !== undefined && direct !== '') return direct
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (forwarded !== undefined && forwarded !== '') return forwarded
  return 'unknown'
}
