/**
 * The slice of the Node built-ins the test fakes use.
 *
 * `@photo/api` is Worker-typed on purpose — `src/gateway.ts` declares
 * structural Cloudflare contracts precisely so nothing in this package needs
 * workerd or Node types. Pulling in `@types/node` to typecheck two Node-only
 * test fakes would undo that, so the handful of members the fakes touch are
 * declared here instead. `node:sqlite` is stable from Node 24, which is the
 * floor `package.json` declares; a missing or renamed member surfaces as a
 * typecheck error in `d1-fake.ts` rather than as a silently divergent fake.
 */

declare module 'node:sqlite' {
  export type SqliteInputValue = null | number | bigint | string | Uint8Array

  export interface StatementChanges {
    changes: number | bigint
    lastInsertRowid: number | bigint
  }

  export interface StatementSync {
    all(...values: Array<SqliteInputValue>): Array<Record<string, unknown>>
    get(...values: Array<SqliteInputValue>): Record<string, unknown> | undefined
    run(...values: Array<SqliteInputValue>): StatementChanges
  }

  export interface DatabaseSync {
    /** False while a transaction is open. */
    readonly isTransaction: boolean
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
}

declare module 'node:fs' {
  export function readdirSync(path: string | URL): Array<string>
  export function readFileSync(path: string | URL, encoding: 'utf8'): string
}
