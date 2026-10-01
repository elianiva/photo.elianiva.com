/**
 * Metadata storage, wired to Cloudflare D1.
 *
 * The metadata database is no longer a hand-rolled `D1DatabaseLike` reached
 * through 52 bespoke `prepare`/`first`/`all` sites. It is the standard
 * `effect/sql/SqlClient`, so the one place that has to know it is D1
 * is this file, and it is a few dozen lines instead of a type declaration and
 * 52 call sites.
 *
 * Two things come out of that, and both are the reason it was worth doing:
 *
 * - **`Batch` is now a service, not a method.** D1 has no transactions. Its
 *   atomic primitive is `batch`, which the generic `SqlClient` deliberately does
 *   not expose, because no dialect promises it. So the guarantee "the delete
 *   and the tag links go in together" lives in `Batch`, and the tests satisfy
 *   it with a real transaction on `node:sqlite`. Both sides are atomic; neither
 *   caller names the driver.
 * - **The error is typed.** Every failure is an `SqlError` carrying the query,
 *   the parameters and the engine's own reason, where the old wrapping threw
 *   that away into a flattened `describeCause` string.
 */

import { Layer } from 'effect'
// The deep path, not the barrel: `@effect/sql-d1` re-exports its own module as
// a namespace, and a namespace's member types are not reachable through it.
import * as D1Client from '@effect/sql-d1/D1Client'
import { BatchD1Live } from './batch'
import { GatewayLive, type R2BucketLike } from './gateway'

/** The D1 binding, named from the driver's own config rather than re-declared.
 *  `@cloudflare/workers-types` is deliberately not a dependency of this package
 *  — workerd types belong to the Worker wiring — but the *shape* is the driver's
 *  to say, and a real `env.DB` satisfies it structurally. */
export type D1Binding = D1Client.D1ClientConfig['db']

export interface MetadataBindings {
  readonly db: D1Binding
  readonly photos: R2BucketLike
}

/**
 * The whole metadata stack over a real D1 binding: the `SqlClient` every
 * service takes, the D1 `Batch`, and the R2 `Gateway`.
 *
 * `Layer.orDie` is not papering over a failure mode. `D1Client.layer` is
 * declared against a `Config.Wrap` and so carries a `ConfigError` requirement
 * it cannot actually fail with — a concrete config is always readable. The
 * failure that *is* real, a Worker deployed without its D1 binding, is a
 * startup error rather than something to answer a request with.
 */
export const MetadataLive = (bindings: MetadataBindings) =>
  Layer.mergeAll(BatchD1Live, GatewayLive({ photos: bindings.photos })).pipe(
    // `D1Client.layer` provides both `D1Client` and the generic `SqlClient`, so
    // `Batch` and the services end up on the same client and the same prepared
    // statement cache.
    Layer.provideMerge(Layer.orDie(D1Client.layer({ db: bindings.db }))),
  )
