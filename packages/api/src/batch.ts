/**
 * Statements run as one atomic unit.
 *
 * D1 has no transactions. Its atomic primitive is `batch`: a single call
 * taking prepared statements, which is what the tag-link and row-delete writes
 * were built on ("the delete and the inserts go in one batch so the links are
 * never half-written"). `@effect/sql-d1` exposes that on `D1Client`; the
 * generic `SqlClient` deliberately does not, because no dialect promises it.
 *
 * So the guarantee is a service rather than a method on the client. The Worker
 * provides {@link BatchD1Live}, which forwards to D1's own `batch`; the tests
 * provide {@link BatchTransactionLive}, which reaches the same atomicity
 * through `SqlClient.withTransaction` on `node:sqlite`. Both are atomic, and
 * the two callers that need it — `linkTags` and the delete path — name the
 * service rather than the driver.
 */

import { Context, Effect, Layer } from 'effect'
// The deep path, not the barrel: `@effect/sql-d1` re-exports its own module as
// a namespace, and a namespace's member types are not reachable through it.
import * as D1Client from '@effect/sql-d1/D1Client'
import * as SqlClient from 'effect/unstable/sql/SqlClient'
import { SqlError } from 'effect/unstable/sql/SqlError'
import type { Statement } from 'effect/unstable/sql/Statement'

/** A statement this package hands to a batch. The batch callers are writes and
 *  never read their rows, so the row type is left open. */
export type BatchStatement = Statement<unknown>

/** Named apart from the `Batch` tag for the same reason every service in this
 *  package splits its tag from its shape: the tag wins in type position. */
export interface BatchContract {
  /** Run the statements in order, atomically, and answer with their results. */
  readonly run: (
    statements: ReadonlyArray<BatchStatement>,
  ) => Effect.Effect<ReadonlyArray<unknown>, SqlError>
}

export class Batch extends Context.Service<Batch, BatchContract>()('photo/Batch') {}

/**
 * D1's own atomic batch, over the `D1Client` the Worker already provides
 * alongside the generic `SqlClient`. This is the single place in the package
 * that knows the metadata database is D1, and the only reason `@effect/sql-d1`
 * is a dependency of `packages/api` rather than of the Worker wiring alone.
 */
export const BatchD1Live: Layer.Layer<Batch, never, D1Client.D1Client> = Layer.effect(
  Batch,
  Effect.gen(function* () {
    const client = yield* D1Client.D1Client
    return Batch.of({
      run: (statements) => client.batch(statements).pipe(Effect.map((results) => [...results])),
    })
  }),
)

/** The same guarantee over any `SqlClient`, by wrapping the statements in a
 *  transaction. This is what the tests run against `node:sqlite`. */
export const BatchTransactionLive: Layer.Layer<Batch, never, SqlClient.SqlClient> = Layer.effect(
  Batch,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return Batch.of({
      run: (statements) =>
        sql
          .withTransaction(Effect.forEach(statements, (statement) => statement.raw))
          .pipe(Effect.map((results) => [...results])),
    })
  }),
)
