/**
 * A `D1Database` binding over `node:sqlite`, for testing the D1 driver itself.
 *
 * The service suite runs on `@effect/sql-sqlite-node` and never loads
 * `@effect/sql-d1`, so the production wiring would ship untested — most of all
 * `BatchD1Live`, which reaches for the one method the generic `SqlClient` does
 * not have. This binding is what lets those run in a plain Node process: it
 * answers the same `prepare`/`bind`/`first`/`all`/`run`/`raw`/`batch` surface D1
 * does, over a real SQL engine.
 *
 * What is faithful, and is the point:
 *
 * - **`batch` is atomic**, by the same guarantee D1 makes: every statement in
 *   the batch is applied as one unit, and if any one fails the whole batch is
 *   rolled back. The alternative — applying what it can — would make `Batch`
 *   mean two different things depending on which layer happened to be under it.
 * - **D1's envelopes**, including `first` answering `null` for no match,
 *   `all`/`run` answering `{ results, success, meta }`, and `run` reporting
 *   `meta.changes`.
 *
 * Two places where this is deliberately not D1, because nothing observable
 * depends on the difference:
 *
 * - A failed batch **throws** here where D1 answers with an entry carrying
 *   `error`. The driver catches both into the same `SqlError`, and D1's own
 *   types declare `error?: never` on a successful response, so there is no
 *   honest way to type the per-entry form without lying about the contract.
 * - `meta` is filled in, not measured. D1 reports its own timings; nothing
 *   reads them.
 *
 * Node-only, and never exported from the package index.
 */

import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { D1Binding } from '../metadata'

/**
 * D1's envelope, taken from the binding rather than re-listed: a hand-written
 * copy of this shape is how the two drift, and the one field that matters — the
 * `changes` a write reports — is the one a caller reads.
 */
type D1Meta = Awaited<ReturnType<ReturnType<D1Binding['prepare']>['all']>>['meta']

/** What `batch` is handed: the bound statements the driver built. */
type D1PreparedStatementLike = ReturnType<D1Binding['prepare']>

/** Placeholder timings, and a real `changes` count from the engine. */
const meta = (changes: number): D1Meta => ({
  changes,
  last_row_id: 0,
  duration: 1,
  size_after: 0,
  rows_read: 0,
  rows_written: changes,
  changed_db: changes > 0,
  timings: { sql_duration_ms: 0 },
})

/**
 * A migrated D1-shaped binding.
 *
 * The migrations run through a raw `DatabaseSync` because several files hold
 * several statements and the Effect SQLite client prepares one at a time. That
 * is a property of the migration files, not of the driver, and it is why the
 * test harness applies them the same way.
 */
export const makeD1Fake = (migrations: ReadonlyArray<string>): D1Binding => {
  const engine = new DatabaseSync(':memory:')
  for (const migration of migrations) engine.exec(migration)

  /** One prepared statement. The driver picks the method that matches the
   *  operation, so each of these runs the SQL exactly once. D1 is
   *  asynchronous, so each answers a promise even where `node:sqlite` is
   *  synchronous. */
  const prepared = (sql: string, bound: ReadonlyArray<SQLInputValue>) => {
    const statement = engine.prepare(sql)
    /**
     * D1's two `raw` shapes, both of which the driver can ask for. Written as an
     * overloaded function because one implementation cannot be both: `columnNames`
     * prepends the column names as the first element.
     */
    function raw<Row = unknown[]>(options: { readonly columnNames: true }): Promise<[string[], ...Row[]]>
    function raw<Row = unknown[]>(options?: { readonly columnNames?: false }): Promise<Row[]>
    function raw<Row = unknown[]>(options?: {
      readonly columnNames?: boolean
    }): Promise<[string[], ...ReadonlyArray<Row>] | ReadonlyArray<Row>> {
      const rows = statement.all(...bound)
      if (options?.columnNames === true) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- `node:sqlite` types its rows as `Record<string, SQLOutputValue>`; `Row` is the shape the caller asked D1 for
        return Promise.resolve([Object.keys(rows[0] ?? {}), ...rows] as unknown as [string[], ...ReadonlyArray<Row>])
      }
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- as above, in D1's positional-array shape
      return Promise.resolve(rows.map((row) => Object.values(row)) as unknown as ReadonlyArray<Row>)
    }
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- `node:sqlite` types `changes` as `number | bigint`; a row count is a number here, as it is in D1's `meta`
    const run = (): { changes: number } => statement.run(...bound) as { changes: number }
    return {
      bind: (...values: ReadonlyArray<unknown>) =>
        prepared(sql, values.map((value) => (value === undefined ? null : toInput(value)))),
      all: async <Row>() => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- `node:sqlite` types its rows as `Record<string, SQLOutputValue>`; `Row` is the shape the query returns, and the driver is what asks for it
        const results = statement.all(...bound) as unknown as Row[]
        return { results, success: true as const, meta: meta(0) }
      },
      first: async <Row>(colName?: string): Promise<Row | null> => {
        const found = statement.get(...bound)
        if (found === undefined) return null
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- `node:sqlite` types its rows as `Record<string, SQLOutputValue>`; `Row` is the shape the caller asked D1 for
        const row = found as unknown as Record<string, unknown>
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- as above; a named column is the single-value form D1 answers with
        return (colName === undefined ? row : (row[colName] ?? null)) as unknown as Row | null
      },
      run: async <Row>() =>
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a write with no `RETURNING` answers no rows; the driver only reads `meta.changes` off this
        ({ results: [], success: true, meta: meta(Number(run().changes)) }) as {
          results: Row[]
          success: true
          meta: D1Meta
        },
      raw,
    }
  }

  /** D1 accepts what a JSON value can hold; `node:sqlite` wants the narrower
   *  set and spells the booleans as integers. */
  const toInput = (value: unknown): SQLInputValue => {
    if (typeof value === 'boolean') return value ? 1 : 0
    if (value === undefined || value === null) return null
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') return value
    if (value instanceof Uint8Array) return value
    return JSON.stringify(value)
  }

  return {
    prepare: (query: string) => prepared(query, []),
    batch: async <Row>(statements: ReadonlyArray<D1PreparedStatementLike>) => {
      engine.exec('BEGIN')
      try {
        const results = await Promise.all(
          statements.map((statement) => statement.all<Record<string, unknown>>()),
        )
        engine.exec('COMMIT')
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- `node:sqlite` types its rows as `Record<string, SQLOutputValue>`; `Row` is the shape the driver's callers asked D1 for, and the driver is what reads these
        return results as unknown as Row[]
      } catch (error) {
        engine.exec('ROLLBACK')
        throw error
      }
    },
    exec: async (query: string) => {
      engine.exec(query)
      return { count: 0, duration: 1 }
    },
    // A session is the same binding with a bookmark; nothing here reads the
    // bookmark, and the driver has no use for a session either.
    withSession: () => {
      const session = makeD1Fake(migrations)
      return {
        // Bound to the binding rather than passed on bare: these are methods on
        // an object, and handing them over unbound is the mistake the rule is
        // about.
        prepare: (query: string) => session.prepare(query),
        batch: (statements: ReadonlyArray<D1PreparedStatementLike>) => session.batch([...statements]),
        getBookmark: () => null,
      }
    },
    dump: async () => new ArrayBuffer(0),
  }
}
