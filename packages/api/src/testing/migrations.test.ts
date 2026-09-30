/**
 * The migrations that build the Photo lifecycle against the F1 harness (`d1-fake`,
 * ADR 0005): the schema 0004 adds, the backfill it writes, the indexes the list
 * queries depend on, and the Photo Number counter 0006 puts outside `photos`.
 */

import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { D1DatabaseLike } from '../gateway'
import { applyMigrations, d1Over, makeD1Fake } from './d1-fake'
import { migrationFiles, migrationsThrough, repoMigrations } from './harness'

const THROUGH_0003 = '0003_blurhash.sql'
const THROUGH_0004 = '0004_presentation.sql'
const COUNTER = '0006_photo_number_counter.sql'

interface LegacyPhoto {
  readonly id: string
  readonly takenAt: string | null
  readonly width: number
  readonly height: number
}

const insertLegacy = async (db: D1DatabaseLike, photo: LegacyPhoto): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO photos (id, slug, title, r2Key, width, height, takenAt, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, '{}')`,
    )
    .bind(
      photo.id,
      photo.id,
      photo.id,
      `originals/${photo.id}.jpg`,
      photo.width,
      photo.height,
      photo.takenAt,
    )
    .run()
}

/** A database at 0001–0003, its engine, and the D1 contract over it. */
const at0003 = (): { engine: DatabaseSync; db: D1DatabaseLike } => {
  const engine = new DatabaseSync(':memory:')
  applyMigrations(engine, migrationsThrough(THROUGH_0003))
  return { engine, db: d1Over(engine) }
}

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

const numbersById = async (db: D1DatabaseLike): Promise<Record<string, number | null>> => {
  const rows = await db.prepare('SELECT id, number FROM photos').all<{
    id: string
    number: number | null
  }>()
  return Object.fromEntries((rows.results ?? []).map((row) => [row.id, row.number]))
}

const ratiosById = async (db: D1DatabaseLike): Promise<Record<string, string | null>> => {
  const rows = await db.prepare('SELECT id, ratio FROM photos').all<{
    id: string
    ratio: string | null
  }>()
  return Object.fromEntries((rows.results ?? []).map((row) => [row.id, row.ratio]))
}

const indexSql = async (db: D1DatabaseLike): Promise<Record<string, string>> => {
  const rows = await db
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'photos'`)
    .all<{ name: string; sql: string }>()
  return Object.fromEntries((rows.results ?? []).map((row) => [row.name, row.sql ?? '']))
}

describe('migration 0004', () => {
  it('applies cleanly to an empty database', async () => {
    const db = makeD1Fake(repoMigrations())
    const indexes = await indexSql(db)
    expect(Object.keys(indexes).sort()).toEqual(
      expect.arrayContaining(['idx_photos_number', 'idx_photos_ratio', 'idx_photos_status']),
    )
    expect(indexes['idx_photos_live']).toBeDefined()
  })

  it('applies cleanly to a database that already has 0001–0003 with rows in it', async () => {
    const { engine, db } = at0003()
    await insertLegacy(db, { id: 'p1', takenAt: '2024-01-15', width: 6000, height: 4000 })
    expect(() => apply0004(engine)).not.toThrow()
    expect(await numbersById(db)).toEqual({ p1: 1 })
  })

  it('numbers a legacy table 1..N oldest first, undated last, ties by id', async () => {
    const { engine, db } = at0003()
    await insertLegacy(db, { id: 'b', takenAt: '2023-05-01', width: 6000, height: 4000 })
    await insertLegacy(db, { id: 'a', takenAt: '2024-01-15', width: 6000, height: 4000 })
    await insertLegacy(db, { id: 'c', takenAt: null, width: 6000, height: 4000 })
    await insertLegacy(db, { id: 'd', takenAt: '2024-01-15', width: 6000, height: 4000 })
    apply0004(engine)

    expect(await numbersById(db)).toEqual({ b: 1, a: 2, c: 4, d: 3 })
  })

  it('issues no gaps and no duplicates for N legacy photos', async () => {
    const { engine, db } = at0003()
    const total = 12
    for (let index = 0; index < total; index += 1) {
      await insertLegacy(db, {
        id: `p${String(index)}`,
        // Every third Photo is undated, so the ordering rule is exercised too.
        takenAt: index % 3 === 0 ? null : `20${String(20 + index).slice(-2)}-01-15`,
        width: 1200 + index,
        height: 800 + index,
      })
    }
    apply0004(engine)

    const rows = await db
      .prepare('SELECT number FROM photos ORDER BY number')
      .all<{ number: number }>()
    expect((rows.results ?? []).map((row) => row.number)).toEqual(
      Array.from({ length: total }, (_unused, index) => index + 1),
    )
  })

  it('converges on a second run of the backfill instead of renumbering', async () => {
    const { engine, db } = at0003()
    await insertLegacy(db, { id: 'b', takenAt: '2023-05-01', width: 6000, height: 4000 })
    await insertLegacy(db, { id: 'a', takenAt: '2024-01-15', width: 3000, height: 3000 })
    apply0004(engine)
    const firstPass = { numbers: await numbersById(db), ratios: await ratiosById(db) }

    // A Photo the operator has since trashed and one they have numbered by
    // hand: a re-run must leave both alone.
    await db
      .prepare(`UPDATE photos SET status = 'draft', deletedAt = '2026-01-01' WHERE id = 'a'`)
      .run()
    await db.prepare(`UPDATE photos SET number = 900 WHERE id = 'a'`).run()
    await db.prepare(`UPDATE photos SET ratio = '16:9' WHERE id = 'a'`).run()

    engine.exec(backfillSection())

    expect(await numbersById(db)).toEqual({ ...firstPass.numbers, a: 900 })
    expect(await ratiosById(db)).toEqual({ ...firstPass.ratios, a: '16:9' })
    const row = await db
      .prepare('SELECT status, deletedAt FROM photos WHERE id = ?')
      .bind('a')
      .first<{ status: string; deletedAt: string | null }>()
    expect(row).toEqual({ status: 'draft', deletedAt: '2026-01-01' })
  })

  it('snaps a legacy frame to its nearest supported ratio', async () => {
    const { engine, db } = at0003()
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
      await insertLegacy(db, { id, takenAt: '2024-01-01', width, height })
    }
    apply0004(engine)

    expect(await ratiosById(db)).toEqual(
      Object.fromEntries(cases.map(([id, _width, _height, ratio]) => [id, ratio])),
    )
  })

  it('backfills a legacy row as a live published JPEG', async () => {
    const { engine, db } = at0003()
    await insertLegacy(db, { id: 'p1', takenAt: '2024-01-15', width: 6000, height: 4000 })
    apply0004(engine)

    const row = await db
      .prepare('SELECT status, deletedAt, mime, bytes FROM photos WHERE id = ?')
      .bind('p1')
      .first<{ status: string; deletedAt: string | null; mime: string; bytes: number | null }>()
    expect(row).toEqual({ status: 'published', deletedAt: null, mime: 'image/jpeg', bytes: null })
  })

  it('gives a new photo the documented defaults', async () => {
    const db = makeD1Fake(repoMigrations())
    await insertLegacy(db, { id: 'fresh', takenAt: '2025-01-01', width: 6000, height: 4000 })
    const row = await db
      .prepare(
        `SELECT status, deletedAt, number, cropX, cropY, cropScale, cropFlip, level,
                borderEnabled, borderStyle, borderColour, borderWidth,
                aperture, shutter, iso, focalLength,
                previewLongEdge, previewFormat, previewQuality, fullQuality,
                keepExif, removeGps
         FROM photos WHERE id = ?`,
      )
      .bind('fresh')
      .first<Record<string, unknown>>()
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
    const db = makeD1Fake(repoMigrations())
    await insertLegacy(db, { id: 'p1', takenAt: '2024-01-15', width: 6000, height: 4000 })
    await expect(
      db.prepare(`UPDATE photos SET status = 'scheduled' WHERE id = 'p1'`).run(),
    ).rejects.toThrow(/CHECK constraint failed: status/i)
    await expect(
      db
        .prepare(
          `INSERT INTO photos (id, slug, title, r2Key, width, height, status)
           VALUES ('p2', 'p2', 'p2', 'originals/p2.jpg', 6000, 4000, 'archived')`,
        )
        .run(),
    ).rejects.toThrow(/CHECK constraint failed: status/i)
  })

  it('rejects a ratio outside the six supported values', async () => {
    const db = makeD1Fake(repoMigrations())
    await expect(
      db
        .prepare(
          `INSERT INTO photos (id, slug, title, r2Key, width, height, ratio)
           VALUES ('p1', 'p1', 'p1', 'originals/p1.jpg', 6000, 4000, '5:4')`,
        )
        .run(),
    ).rejects.toThrow(/CHECK constraint failed: ratio/i)
  })

  it('rejects a duplicate photo number but not a duplicate ratio', async () => {
    const db = makeD1Fake(repoMigrations())
    await insertLegacy(db, { id: 'p1', takenAt: '2024-01-15', width: 6000, height: 4000 })
    await insertLegacy(db, { id: 'p2', takenAt: '2024-01-16', width: 6000, height: 4000 })
    await db.prepare(`UPDATE photos SET number = 7, ratio = '3:2' WHERE id = 'p1'`).run()
    // Both rows are 3:2, so only a non-unique index on ratio can be holding
    // this up.
    await db.prepare(`UPDATE photos SET ratio = '3:2' WHERE id = 'p2'`).run()
    const shared = await db
      .prepare(`SELECT COUNT(*) AS n FROM photos WHERE ratio = '3:2'`)
      .first<{ n: number }>()
    expect(shared?.n).toBe(2)

    await expect(db.prepare(`UPDATE photos SET number = 7 WHERE id = 'p2'`).run()).rejects.toThrow(
      /UNIQUE constraint failed: photos.number/i,
    )
  })

  it('leaves a photo with no number outside the unique index', async () => {
    const db = makeD1Fake(repoMigrations())
    await insertLegacy(db, { id: 'p1', takenAt: '2024-01-15', width: 6000, height: 4000 })
    await insertLegacy(db, { id: 'p2', takenAt: '2024-01-16', width: 6000, height: 4000 })
    await db.prepare(`UPDATE photos SET number = 7 WHERE id = 'p1'`).run()
    // Two unnumbered rows would collide under a plain unique index. The
    // predicate on idx_photos_number is what lets both exist.
    await insertLegacy(db, { id: 'p3', takenAt: '2024-01-17', width: 6000, height: 4000 })
    await insertLegacy(db, { id: 'p4', takenAt: '2024-01-18', width: 6000, height: 4000 })
    expect(await numbersById(db)).toEqual({ p1: 7, p2: null, p3: null, p4: null })
  })

  it('indexes the list queries rather than scanning them', async () => {
    const { engine, db } = at0003()
    for (let index = 0; index < 40; index += 1) {
      await insertLegacy(db, {
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
      const plan = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<{ detail: string }>()
      const details = (plan.results ?? []).map((row) => row.detail)
      expect(details).toHaveLength(1)
      expect(details[0]).toMatch(expected)
      expect(details[0]).not.toMatch(/\bSCAN\b/)
    }
  })

  it('keeps the photos table STRICT for the new columns', async () => {
    const db = makeD1Fake(repoMigrations())
    await insertLegacy(db, { id: 'p1', takenAt: '2024-01-15', width: 6000, height: 4000 })
    await expect(
      db.prepare(`UPDATE photos SET bytes = 'eighteen megabytes' WHERE id = 'p1'`).run(),
    ).rejects.toThrow(/INT/i)
  })
})

describe(`migration ${COUNTER}`, () => {
  /** The counter reads `photos.number`, so 0004 has to be on first. */
  const at0004 = (): { engine: DatabaseSync; db: D1DatabaseLike } => {
    const { engine, db } = at0003()
    apply0004(engine)
    return { engine, db }
  }

  const applyCounter = (engine: DatabaseSync): void => {
    engine.exec(migrationSql(COUNTER))
  }

  const counterValue = async (db: D1DatabaseLike): Promise<number | null> =>
    (
      await db
        .prepare('SELECT value FROM photo_number_counter WHERE id = 1')
        .first<{ value: number }>()
    )?.value ?? null

  it('starts above the highest serial 0004 already handed out', async () => {
    const { engine, db } = at0003()
    await insertLegacy(db, { id: 'a', takenAt: '2023-05-01', width: 6000, height: 4000 })
    await insertLegacy(db, { id: 'b', takenAt: '2024-01-15', width: 6000, height: 4000 })
    apply0004(engine)
    expect(await numbersById(db)).toEqual({ a: 1, b: 2 })
    applyCounter(engine)

    expect(await counterValue(db)).toBe(2)
  })

  it('starts at zero for an empty table', async () => {
    const { engine, db } = at0004()
    applyCounter(engine)
    expect(await counterValue(db)).toBe(0)
  })

  it('converges on a second run instead of rewinding the counter', async () => {
    const { engine, db } = at0004()
    applyCounter(engine)
    await db.prepare('UPDATE photo_number_counter SET value = 41 WHERE id = 1').run()

    applyCounter(engine)

    expect(await counterValue(db)).toBe(41)
  })

  it('holds exactly one row', async () => {
    const db = makeD1Fake(repoMigrations())
    await expect(
      db.prepare('INSERT INTO photo_number_counter (id, value) VALUES (2, 1)').run(),
    ).rejects.toThrow(/CHECK constraint failed/i)
  })

  it('is STRICT, so the counter cannot hold a non-integer', async () => {
    const db = makeD1Fake(repoMigrations())
    await expect(
      db.prepare(`UPDATE photo_number_counter SET value = 'forty one' WHERE id = 1`).run(),
    ).rejects.toThrow(/INT/i)
  })
})

describe('migration 0007_crop_flip.sql', () => {
  const CROP_FLIP = '0007_crop_flip.sql'

  it('defaults every pre-existing row to un-flipped', async () => {
    const engine = new DatabaseSync(':memory:')
    applyMigrations(engine, migrationsThrough(COUNTER))
    const db = d1Over(engine)
    await insertLegacy(db, { id: 'p1', takenAt: '2024-01-15', width: 6000, height: 4000 })

    engine.exec(migrationSql(CROP_FLIP))

    const row = await db
      .prepare('SELECT cropFlip FROM photos WHERE id = ?')
      .bind('p1')
      .first<{ cropFlip: number }>()
    expect(row?.cropFlip).toBe(0)
  })

  it('is NOT NULL, so a crop cannot have an unknown mirror', async () => {
    const db = makeD1Fake(repoMigrations())
    await insertLegacy(db, { id: 'p1', takenAt: '2024-01-15', width: 6000, height: 4000 })
    await expect(
      db.prepare(`UPDATE photos SET cropFlip = NULL WHERE id = 'p1'`).run(),
    ).rejects.toThrow(/NOT NULL/i)
  })
})
