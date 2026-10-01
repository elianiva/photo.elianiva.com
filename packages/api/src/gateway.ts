/**
 * The R2 side of storage, and the D1 side's absence.
 *
 * `@photo/api` must not depend on alchemy or workerd types — these minimal
 * structural interfaces describe exactly what the services use, and the Worker
 * provides the real bindings through a Layer at wiring time (the seam that
 * keeps every service testable without a Worker runtime).
 *
 * **D1 is not here, and that is the point.** D1 used to be re-declared in this
 * file as `D1DatabaseLike` and reached through 52 hand-written
 * `prepare`/`first`/`all`/`run`/`batch` sites, each wrapped in its own
 * `Effect.tryPromise` with a bespoke `StorageError`. It is now the standard
 * `effect/sql/SqlClient`, provided by `@effect/sql-d1` in the Worker
 * and by `@effect/sql-sqlite-node` over the same real `migrations/*.sql` in the
 * tests. That buys a typed `SqlError` in place of the flattening
 * `describeCause` existed for, a prepared-statement cache, spans carrying the
 * query text, and one data-access style the whole repo shares.
 *
 * Effect has no R2 module, so R2 keeps the structural contract below and the
 * `Gateway` service. What is left here is the half that had no Effect
 * equivalent to move to.
 */

import { Context, Effect, Layer } from 'effect'

export interface R2ObjectLike {
  readonly key: string
  readonly size: number
  readonly uploaded: Date
  readonly httpMetadata?: { readonly contentType?: string } | undefined
  /**
   * Absent, not just null, on an object read through `get` with an `onlyIf`
   * precondition: the binding answers with a bare `R2Object` there and no
   * stream is ever opened. Only `get`/`head` without a precondition carry one.
   */
  readonly body?: ReadableStream | null | undefined
}

export interface R2ListOptions {
  readonly prefix?: string | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
}

export interface R2ObjectsLike {
  readonly objects: ReadonlyArray<R2ObjectLike>
  readonly truncated: boolean
  readonly cursor?: string | undefined
}

/**
 * The bucket, as the services use it — and as the Worker's env binding
 * declares it.
 *
 * Two shape decisions are load-bearing, and neither is a convenience.
 *
 * The methods carry the platform's own *optional* parameters (`get`'s options,
 * `delete`'s key-or-keys). A real binding has them, and TypeScript will not let
 * an overloaded source satisfy a target that promises fewer parameters, so
 * dropping them here is what previously forced the Worker wiring to hand the
 * binding over with an `as never`.
 *
 * `body` is the DOM `ReadableStream`, not the platform's own declaration of
 * one. The two are not assignable to each other in either direction — they
 * declare `getReader` differently — and the services hand this straight to
 * `new Response`, which is the DOM one everywhere the suite runs. So the
 * platform's `R2Bucket` is the one type that cannot be named here without a
 * cast, and the Worker declares the structural shape instead. That is honest in
 * both directions: the runtime binding satisfies it, and it is what the code
 * calls.
 */
export interface R2BucketLike {
  get(key: string, options?: unknown): Promise<R2ObjectLike | null>
  head(key: string): Promise<R2ObjectLike | null>
  list(options?: R2ListOptions): Promise<R2ObjectsLike>
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | Blob | ReadableStream | string | null,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>
  delete(keys: string | ReadonlyArray<string>): Promise<unknown>
}

/** The bucket originals live in. R2 only — the metadata database is the
 *  `SqlClient` every service now takes as a requirement. */
export class Gateway extends Context.Service<
  Gateway,
  {
    readonly photos: R2BucketLike
  }
>()('photo/Gateway') {}

/** Build the Gateway from a real R2 binding. Used by both Workers. */
export const GatewayLive = (bindings: { photos: R2BucketLike }) =>
  Layer.succeed(Gateway, Gateway.of({ photos: bindings.photos }))

/** Run an effect with a fresh R2 bucket — test helper. `Gateway` is removed
 *  from the requirements rather than merely satisfied, so a caller does not
 *  have to thread the exclusion through its own signature. */
export const withGateway = <A, E, R>(
  gateway: typeof Gateway.Service,
  effect: Effect.Effect<A, E, R>,
) => Effect.provide(effect, Layer.succeed(Gateway, gateway))
