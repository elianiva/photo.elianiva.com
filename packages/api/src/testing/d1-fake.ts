/**
 * `D1DatabaseLike` backed by a real SQLite engine (`node:sqlite`).
 *
 * A hand-written stub would get the four things this project's schema leans on
 * wrong: `STRICT` column affinity, `WITHOUT ROWID` tables, foreign keys, and
 * partial indexes. Running the actual `migrations/*.sql` over a real engine is
 * the only way the aggregate and paging queries the rest of the chain adds are
 * exercised the way D1 executes them.
 *
 * Node-only. It is never exported from the package index, so it stays out of
 * the Worker bundle.
 */

import { DatabaseSync } from 'node:sqlite'
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1Result,
  D1StatementResult,
} from '../gateway'

/** D1 accepts JS values SQLite does not; coerce them the way D1 does. */
const toSqliteValue = (value: unknown): null | number | bigint | string | Uint8Array => {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') {
    return value
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  throw new TypeError(`D1 cannot bind a value of type ${typeof value}`)
}

const toSqliteValues = (
  values: ReadonlyArray<unknown>,
): Array<null | number | bigint | string | Uint8Array> => values.map(toSqliteValue)

/** D1 hands back plain JSON objects; `node:sqlite` hands back null-prototype
 *  rows whose values are `unknown`. One cast lives here, at that boundary. */
const toRows = <Row>(rows: ReadonlyArray<Record<string, unknown>>): ReadonlyArray<Row> =>
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the row shape is named by the caller, as in D1
  rows.map((row) => ({ ...row }) as Row)

const toRow = <Row>(row: Record<string, unknown> | undefined): Row | null =>
  row === undefined ? null : (toRows<Row>([row])[0] ?? null)

const makeStatement = (
  db: DatabaseSync,
  sql: string,
  values: ReadonlyArray<unknown>,
): D1PreparedStatementLike => ({
  bind: (...next: ReadonlyArray<unknown>) => makeStatement(db, sql, [...values, ...next]),
  first: async <Row>() => toRow<Row>(db.prepare(sql).get(...toSqliteValues(values))),
  all: async <Row>(): Promise<D1Result<Row>> => ({
    results: toRows<Row>(db.prepare(sql).all(...toSqliteValues(values))),
  }),
  run: async () => {
    const changes = db.prepare(sql).run(...toSqliteValues(values))
    return {
      success: true,
      meta: { changes: Number(changes.changes), last_row_id: Number(changes.lastInsertRowid) },
    }
  },
})

/** Apply migration SQL in order, the way Alchemy applies `migrations/`. */
export const applyMigrations = (db: DatabaseSync, migrations: ReadonlyArray<string>): void => {
  for (const sql of migrations) db.exec(sql)
}

/**
 * The D1 contract over a SQLite engine. Exported so a test can migrate a
 * populated database between two assertions instead of only starting fresh.
 */
export const d1Over = (db: DatabaseSync): D1DatabaseLike => ({
  prepare: (sql) => makeStatement(db, sql, []),
  // D1 runs a batch inside one transaction: any statement failing rolls the
  // whole batch back.
  batch: async (statements: ReadonlyArray<D1StatementResult>) => {
    db.exec('BEGIN')
    try {
      const results: Array<unknown> = []
      for (const statement of statements) results.push(await statement.run())
      db.exec('COMMIT')
      return results
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK')
      throw error
    }
  },
})

/** A migrated in-memory D1. Each call is an isolated database. */
export const makeD1Fake = (migrations: ReadonlyArray<string> = []): D1DatabaseLike => {
  const db = new DatabaseSync(':memory:')
  applyMigrations(db, migrations)
  return d1Over(db)
}
