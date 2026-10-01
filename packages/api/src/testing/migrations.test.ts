/**
 * The migrations that build the Photo lifecycle: the schema 0004 adds, the
 * backfill it writes, the indexes the list queries depend on, and the Photo
 * Number counter 0006 puts outside `photos`.
 *
 * Straight against `node:sqlite`, the engine the whole suite runs on
 * (`@effect/sql-sqlite-node` over the same driver). Migration files are SQL
 * applied to SQLite, so testing them by way of a D1-shaped wrapper tested the
 * wrapper as much as the migration; the wrapper is gone (ADR 0005) and with it
 * that indirection.
 */

import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrationFiles, migrationsThrough, repoMigrations } from './harness'

const THROUGH_0003 = '0003_blurhash.sql'
const THROUGH_0004 = '0004_presentation.sql'
const COUNTER = '0006_photo_number_counter.sql'

/** A migrated, in-memory database. `:memory:` is the isolation: the handle
 *  dies with the test, and nothing is left on disk to clean up. */
const migrated = (migrations: ReadonlyArray<string>): DatabaseSync => {
  const engine = new DatabaseSync(':memory:')
  for (const statement of migrations) engine.exec(statement)
  return engine
}

interface LegacyPhoto {
  readonly id: string
  readonly takenAt: string | null
  readonly width: number
  readonly height: number
}

/** `node:sqlite` hands back null-prototype rows; a record literal is what the
 *  assertions below and `toEqual` want. */
const records = <Row>(rows: ReadonlyArray<Record<string, unknown>>): ReadonlyArray<Row> =>
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- `node:sqlite` types its rows as `Record<string, SQLOutputValue>`, so the shape a query returns can only be named at the call site; `Row` is that name
  rows.map((row) => ({ ...row }) as Row)

const insertLegacy = (engine: DatabaseSync, photo: LegacyPhoto): void => {
  engine
    .prepare(
      `INSERT INTO photos (id, slug, title, r2Key, width, height, takenAt, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, '{}')`,
    )
    .run(
      photo.id,
      photo.id,
      photo.id,
      `originals/${photo.id}.jpg`,
      photo.width,
      photo.height,
      photo.takenAt,
    )
}

/** A database at 0001–0003. */
const at0003 = (): DatabaseSync => migrated(migrationsThrough(THROUGH_0003))

const migrationSql = (name: string): string => {
  const file = migrationFiles().find((entry) => entry.name === name)
  if (file === undefined) throw new Error(`migrations/${name} is missing`)
  return file.sql
}

const apply0004 = (engine: DatabaseSync): void => {
  engine.exec(migrationSql(THROUGH_0004))
}

/**
 * The 0004 file's guarded section. The ALTERs that precede it are one-shot by
 * nature, so re-running the whole file is not possible; re-running this section
 * is, and it is the part that has to converge.
 */
const backfillSection = (): string => {
  const sql = migrationSql(THROUGH_0004)
  const start = sql.indexOf('-- backfill')
  const end = sql.indexOf('-- indexes')
  if (start < 0 || end < 0) throw new Error(`${THROUGH_0004} lost its section headers`)
  return sql.slice(start, end)
}

/** What `node:sqlite` will bind: null, a number, a bigint, a string or a
 *  typed array. Narrower than `unknown`, and saying so is what lets a fixture
 *  pass a column value without a cast. */
type Bindable = null | number | bigint | string | NodeJS.ArrayBufferView

const all = <Row>(
  engine: DatabaseSync,
  sql: string,
  ...params: ReadonlyArray<Bindable>
): ReadonlyArray<Row> => records<Row>(engine.prepare(sql).all(...params))

/** One row, or null. `node:sqlite` calls this `get`; the read above it is
 *  `all`, and the pair is what the D1-shaped `first` used to be. */
const one = <Row>(
  engine: DatabaseSync,
  sql: string,
  ...params: ReadonlyArray<Bindable>
): Row | null => {
  const row = engine.prepare(sql).get(...params)
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- as `records`: the engine hands back untyped rows and `Row` names the shape the query returns
  return row === undefined ? null : ({ ...row } as Row)
}

const numbersById = (engine: DatabaseSync): Record<string, number | null> =>
  Object.fromEntries(
    all<{ id: string; number: number | null }>(engine, 'SELECT id, number FROM photos').map(
      (row) => [row.id, row.number],
    ),
  )

const ratiosById = (engine: DatabaseSync): Record<string, string | null> =>
  Object.fromEntries(
    all<{ id: string; ratio: string | null }>(engine, 'SELECT id, ratio FROM photos').map((row) => [
      row.id,
      row.ratio,
    ]),
  )

const indexSql = (engine: DatabaseSync): Record<string, string> =>
  Object.fromEntries(
    all<{ name: string; sql: string }>(
      engine,
      `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'photos'`,
    ).map((row) => [row.name, row.sql ?? '']),
  )

describe('migration 0004', () => {
  it('applies cleanly to an empty database', async () => {
    const engine = migrated(repoMigrations())
    const indexes = indexSql(engine)
    expect(Object.keys(indexes).sort()).toEqual(
      expect.arrayContaining(['idx_photos_number', 'idx_photos_ratio', 'idx_photos_status']),
    )
    expect(indexes['idx_photos_live']).toBeDefined()
  })

  it('applies cleanly to a database that already has 0001–0003 with rows in it', async () => {
    const engine = at0003()
    insertLegacy(engine, { id: 'p1', takenAt: '2024-01-15', width: 6000, height: 4000 })
    expect(() => apply0004(engine)).not.toThrow()
    expect(numbersById(engine)).toEqual({ p1: 1 })
  })

  it('numbers a legacy table 1..N oldest first, undated last, ties by id', async () => {
    const engine = at0003()
    insertLegacy(engine, { id: 'b', takenAt: '2023-05-01', width: 6000, height: 4000 })
    insertLegacy(engine, { id: 'a', takenAt: '2024-01-15', width: 6000, height: 4000 })
    insertLegacy(engine, { id: 'c', takenAt: null, width: 6000, height: 4000 })
    insertLegacy(engine, { id: 'd', takenAt: '2024-01-15', width: 6000, height: 4000 })
    apply0004(engine)

    expect(numbersById(engine)).toEqual({ b: 1, a: 2, c: 4, d: 3 })
  })

  it('issues no gaps and no duplicates for N legacy photos', async () => {
    const engine = at0003()
    const total = 12
    for (let index = 0; index < total; index += 1) {
      insertLegacy(engine, {
        id: `p${String(index)}`,
        // Every third Photo is undated, so the ordering rule is exercised too.
        takenAt: index % 3 === 0 ? null : `20${String(20 + index).slice(-2)}-01-15`,
        width: 1200 + index,
        height: 800 + index,
      })
    }
    apply0004(engine)

    const rows = all<{ number: number }>(engine, 'SELECT number FROM photos ORDER BY number')
    expect(rows.map((row) => row.number)).toEqual(
      Array.from({ length: total }, (_unused, index) => index + 1),
    )
  })

  it('converges on a second run of the backfill instead of renumbering', async () => {
    const engine = at0003()
    insertLegacy(engine, { id: 'b', takenAt: '2023-05-01', width: 6000, height: 4000 })
    insertLegacy(engine, { id: 'a', takenAt: '2024-01-15', width: 3000, height: 3000 })
    apply0004(engine)
    const firstPass = { numbers: numbersById(engine), ratios: ratiosById(engine) }

    // A Photo the operator has since trashed and one they have numbered by
    // hand: a re-run must leave both alone.
    engine
      .prepare(`UPDATE photos SET status = 'draft', deletedAt = '2026-01-01' WHERE id = 'a'`)
      .run()
    engine.prepare(`UPDATE photos SET number = 900 WHERE id = 'a'`).run()
    engine.prepare(`UPDATE photos SET ratio = '16:9' WHERE id = 'a'`).run()

    engine.exec(backfillSection())

    expect(numbersById(engine)).toEqual({ ...firstPass.numbers, a: 900 })
    expect(ratiosById(engine)).toEqual({ ...firstPass.ratios, a: '16:9' })
    expect(
      one<{ status: string; deletedAt: string | null }>(
        engine,
        'SELECT status, deletedAt FROM photos WHERE id = ?',
        'a',
      ),
    ).toEqual({ status: 'draft', deletedAt: '2026-01-01' })
  })

  it('snaps a legacy frame to its nearest supported ratio', async () => {
    const engine = at0003()
    const cases: ReadonlyArray<[string, number, number, string | null]> = [
      ['p3-2', 6000, 4000, '3:2'],
      ['p2-3', 4000, 6000, '2:3'],
      ['p4-3', 1024, 768, '4:3'],
      ['p3-4', 768, 1024, '3:4'],
      ['p16-9', 1920, 1080, '16:9'],
      ['p9-16', 1080, 1920, '9:16'],
      // 6016x4000 is 1.504 against 3:2's 1.5 — inside the tolerance.
      ['podd', 6016, 4000, '3:2'],
      // 3000x3000 matches none of the six, so the migration invents nothing.
      ['psquare', 3000, 3000, null],
    ]
    for (const [id, width, height] of cases) {
      insertLegacy(engine, { id, takenAt: '2024-01-01', width, height })
    }
    apply0004(engine)

    expect(ratiosById(engine)).toEqual(
      Object.fromEntries(cases.map(([id, _width, _height, ratio]) => [id, ratio])),
    )
  })

  it('backfills a legacy row as a live published JPEG', async () => {
    const engine = at0003()
    insertLegacy(engine, { id: 'p1', takenAt: '2024-01-15', width: 6000, height: 4000 })
    apply0004(engine)

    const row = one<{
      status: string
      deletedAt: string | null
      mime: string
      bytes: number | null
    }>(engine, 'SELECT status, deletedAt, mime, bytes FROM photos WHERE id = ?', 'p1')
    expect(row).toEqual({ status: 'published', deletedAt: null, mime: 'image/jpeg', bytes: null })
  })

  it('gives a new photo the documented defaults', async () => {
    const engine = migrated(repoMigrations())
    insertLegacy(engine, { id: 'fresh', takenAt: '2025-01-01', width: 6000, height: 4000 })
    const row = one<Record<string, unknown>>(
      engine,
      `SELECT status, deletedAt, number, cropX, cropY, cropScale, cropFlip, level,
                borderEnabled, borderStyle, borderColour, borderWidth,
                aperture, shutter, iso, focalLength,
                previewLongEdge, previewFormat, previewQuality, fullQuality,
                keepExif, removeGps
         FROM photos WHERE id = ?`,
      'fresh',
    )
    expect(row).toEqual({
      status: 'published',
      deletedAt: null,
      number: null,
      cropX: 0,
      cropY: 0,
      cropScale: 1,
      cropFlip: 0,
      level: null,
      borderEnabled: 0,
      borderStyle: null,
      borderColour: null,
      borderWidth: null,
      aperture: null,
      shutter: null,
      iso: null,
      focalLength: null,
      previewLongEdge: 1200,
      previewFormat: 'avif',
      previewQuality: 82,
      fullQuality: 92,
      keepExif: 1,
      removeGps: 1,
    })
  })

  it('rejects a status outside draft, published and failed', async () => {
    const engine = migrated(repoMigrations())
    insertLegacy(engine, { id: 'p1', takenAt: '2024-01-15', width: 6000, height: 4000 })
    expect(() =>
      engine.prepare(`UPDATE photos SET status = 'scheduled' WHERE id = 'p1'`).run(),
    ).toThrow(/CHECK constraint failed: status/i)
    expect(() =>
      engine
        .prepare(
          `INSERT INTO photos (id, slug, title, r2Key, width, height, status)
           VALUES ('p2', 'p2', 'p2', 'originals/p2.jpg', 6000, 4000, 'archived')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed: status/i)
  })

  it('rejects a ratio outside the six supported values', async () => {
    const engine = migrated(repoMigrations())
    expect(() =>
      engine
        .prepare(
          `INSERT INTO photos (id, slug, title, r2Key, width, height, ratio)
           VALUES ('p1', 'p1', 'p1', 'originals/p1.jpg', 6000, 4000, '5:4')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed: ratio/i)
  })

  it('rejects a duplicate photo number but not a duplicate ratio', async () => {
    const engine = migrated(repoMigrations())
    insertLegacy(engine, { id: 'p1', takenAt: '2024-01-15', width: 6000, height: 4000 })
    insertLegacy(engine, { id: 'p2', takenAt: '2024-01-16', width: 6000, height: 4000 })
    one<{}>(engine, `UPDATE photos SET number = 7, ratio = '3:2' WHERE id = 'p1'`)
    // Both rows are 3:2, so only a non-unique index on ratio can be holding
    // this up.
    engine.prepare(`UPDATE photos SET ratio = '3:2' WHERE id = 'p2'`).run()
    const shared = one<{ n: number }>(
      engine,
      `SELECT COUNT(*) AS n FROM photos WHERE ratio = '3:2'`,
    )
    expect(shared?.n).toBe(2)

    expect(() => engine.prepare(`UPDATE photos SET number = 7 WHERE id = 'p2'`).run()).toThrow(
      /UNIQUE constraint failed: photos.number/i,
    )
  })

  it('leaves a photo with no number outside the unique index', async () => {
    const engine = migrated(repoMigrations())
    insertLegacy(engine, { id: 'p1', takenAt: '2024-01-15', width: 6000, height: 4000 })
    insertLegacy(engine, { id: 'p2', takenAt: '2024-01-16', width: 6000, height: 4000 })
    one<{}>(engine, `UPDATE photos SET number = 7 WHERE id = 'p1'`)
    // Two unnumbered rows would collide under a plain unique index. The
    // predicate on idx_photos_number is what lets both exist.
    insertLegacy(engine, { id: 'p3', takenAt: '2024-01-17', width: 6000, height: 4000 })
    insertLegacy(engine, { id: 'p4', takenAt: '2024-01-18', width: 6000, height: 4000 })
    expect(numbersById(engine)).toEqual({ p1: 7, p2: null, p3: null, p4: null })
  })

  it('indexes the list queries rather than scanning them', async () => {
    const engine = at0003()
    for (let index = 0; index < 40; index += 1) {
      insertLegacy(engine, {
        id: `p${String(index)}`,
        takenAt: `2024-01-${String((index % 28) + 1).padStart(2, '0')}`,
        width: 6000,
        height: 4000,
      })
    }
    apply0004(engine)

    const cases: ReadonlyArray<[string, RegExp]> = [
      [
        `SELECT id FROM photos WHERE deletedAt IS NULL AND status = 'draft' ORDER BY takenAt`,
        /USING (COVERING )?INDEX idx_photos_(live|status)/,
      ],
      [
        `SELECT COUNT(*) FROM photos WHERE status = 'draft' AND deletedAt IS NULL`,
        /USING (COVERING )?INDEX idx_photos_status/,
      ],
      [`SELECT id FROM photos WHERE ratio = '3:2'`, /USING (COVERING )?INDEX idx_photos_ratio/],
      [`SELECT id FROM photos WHERE number = 7`, /USING (COVERING )?INDEX idx_photos_number/],
    ]
    for (const [sql, expected] of cases) {
      const details = all<{ detail: string }>(engine, `EXPLAIN QUERY PLAN ${sql}`).map(
        (row) => row.detail,
      )
      expect(details).toHaveLength(1)
      expect(details[0]).toMatch(expected)
      expect(details[0]).not.toMatch(/\bSCAN\b/)
    }
  })

  it('keeps the photos table STRICT for the new columns', async () => {
    const engine = migrated(repoMigrations())
    insertLegacy(engine, { id: 'p1', takenAt: '2024-01-15', width: 6000, height: 4000 })
    expect(() =>
      engine.prepare(`UPDATE photos SET bytes = 'eighteen megabytes' WHERE id = 'p1'`).run(),
    ).toThrow(/INT/i)
  })
})

describe(`migration ${COUNTER}`, () => {
  /** The counter reads `photos.number`, so 0004 has to be on first. */
  const at0004 = (): DatabaseSync => {
    const engine = at0003()
    apply0004(engine)
    return engine
  }

  const applyCounter = (engine: DatabaseSync): void => {
    engine.exec(migrationSql(COUNTER))
  }

  const counterValue = (engine: DatabaseSync): number | null =>
    one<{ value: number | null }>(engine, 'SELECT value FROM photo_number_counter WHERE id = 1')
      ?.value ?? null

  it('starts above the highest serial 0004 already handed out', async () => {
    const engine = at0003()
    insertLegacy(engine, { id: 'a', takenAt: '2023-05-01', width: 6000, height: 4000 })
    insertLegacy(engine, { id: 'b', takenAt: '2024-01-15', width: 6000, height: 4000 })
    apply0004(engine)
    expect(numbersById(engine)).toEqual({ a: 1, b: 2 })
    applyCounter(engine)

    expect(counterValue(engine)).toBe(2)
  })

  it('starts at zero for an empty table', async () => {
    const engine = at0004()
    applyCounter(engine)
    expect(counterValue(engine)).toBe(0)
  })

  it('converges on a second run instead of rewinding the counter', async () => {
    const engine = at0004()
    applyCounter(engine)
    engine.prepare('UPDATE photo_number_counter SET value = 41 WHERE id = 1').run()

    applyCounter(engine)

    expect(counterValue(engine)).toBe(41)
  })

  it('holds exactly one row', async () => {
    const engine = migrated(repoMigrations())
    expect(() =>
      engine.prepare('INSERT INTO photo_number_counter (id, value) VALUES (2, 1)').run(),
    ).toThrow(/CHECK constraint failed/i)
  })

  it('is STRICT, so the counter cannot hold a non-integer', async () => {
    const engine = migrated(repoMigrations())
    expect(() =>
      engine.prepare(`UPDATE photo_number_counter SET value = 'forty one' WHERE id = 1`).run(),
    ).toThrow(/INT/i)
  })
})

describe('migration 0007_crop_flip.sql', () => {
  const CROP_FLIP = '0007_crop_flip.sql'

  it('defaults every pre-existing row to un-flipped', async () => {
    const engine = migrated(migrationsThrough(COUNTER))
    insertLegacy(engine, { id: 'p1', takenAt: '2024-01-15', width: 6000, height: 4000 })

    engine.exec(migrationSql(CROP_FLIP))

    expect(
      one<{ cropFlip: number }>(engine, 'SELECT cropFlip FROM photos WHERE id = ?', 'p1')?.cropFlip,
    ).toBe(0)
  })

  it('is NOT NULL, so a crop cannot have an unknown mirror', async () => {
    const engine = migrated(repoMigrations())
    insertLegacy(engine, { id: 'p1', takenAt: '2024-01-15', width: 6000, height: 4000 })
    expect(() => engine.prepare(`UPDATE photos SET cropFlip = NULL WHERE id = 'p1'`).run()).toThrow(
      /NOT NULL/i,
    )
  })
})
