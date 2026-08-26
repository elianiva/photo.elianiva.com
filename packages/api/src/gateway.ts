/**
 * Structural Cloudflare binding contracts + the `Gateway` service.
 *
 * `@photo/api` must not depend on alchemy or workerd types — these minimal
 * structural interfaces describe exactly what the services use, and the
 * Worker provides the real bindings through a single Layer at wiring time
 * (the seam that keeps every service testable without a Worker runtime).
 */

export interface D1Result<Row> {
  readonly results?: ReadonlyArray<Row> | undefined
}

export interface D1StatementResult {
  first<Row = unknown>(): Promise<Row | null>
  all<Row = unknown>(): Promise<D1Result<Row>>
  run(): Promise<unknown>
}

export interface D1PreparedStatementLike extends D1StatementResult {
  bind(...values: ReadonlyArray<unknown>): D1StatementResult
}

export type D1Statement = D1PreparedStatementLike

export interface D1DatabaseLike {
  prepare(query: string): D1Statement
  batch(statements: ReadonlyArray<D1Statement>): Promise<ReadonlyArray<unknown>>
}

export interface R2ObjectLike {
  readonly httpMetadata?: { readonly contentType?: string } | undefined
  readonly body: ReadableStream | null
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>
  put(
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>
  delete(key: string): Promise<unknown>
}

import { Context, Effect, Layer } from 'effect'

/** The storage gateway: D1 for metadata, R2 for originals. */
export class Gateway extends Context.Service<
  Gateway,
  {
    readonly db: D1DatabaseLike
    readonly photos: R2BucketLike
  }
>()('photo/Gateway') {}

/** Build the Gateway from real Worker bindings. Used by `worker.ts`. */
export const GatewayLive = (bindings: { db: D1DatabaseLike; photos: R2BucketLike }) =>
  Layer.succeed(Gateway, Gateway.of({ db: bindings.db, photos: bindings.photos }))

/** Run an effect with a fresh Gateway — test helper. */
export const withGateway = <A, E, R>(
  gateway: typeof Gateway.Service,
  effect: Effect.Effect<A, E, R>,
) => Effect.provide(effect, Layer.succeed(Gateway, gateway))
