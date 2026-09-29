import { describe, expect, it } from 'vitest'
import type { D1DatabaseLike } from '../gateway'
import { makeD1Fake } from './d1-fake'
import { repoMigrations } from './harness'

const insertPhoto = async (
  db: D1DatabaseLike,
  overrides: Partial<{ id: string; width: unknown }> = {},
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO photos (id, slug, title, r2Key, width, height, takenAt, metadata, blurhash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      overrides.id ?? 'photo_1',
      'kyoto-street',
      'Kyoto Street',
      'originals/photo_1.jpg',
      overrides.width ?? 1200,
      800,
      '2024-01-15',
      '{"caption":"a"}',
      'LEHV6nWB',
    )
    .run()
}

const migrated = (): D1DatabaseLike => makeD1Fake(repoMigrations())

describe('D1 fake', () => {
  it('applies the repo migrations', async () => {
    const db = migrated()
    await insertPhoto(db)
    const row = await db
      .prepare('SELECT id, slug, blurhash FROM photos WHERE id = ?')
      .bind('photo_1')
      .first<{ id: string; slug: string; blurhash: string }>()
    expect(row).toEqual({ id: 'photo_1', slug: 'kyoto-street', blurhash: 'LEHV6nWB' })
  })

  it('honours STRICT — a TEXT value in an INTEGER column is rejected', async () => {
    const db = migrated()
    await expect(insertPhoto(db, { width: 'not-a-number' })).rejects.toThrow(/INT/i)
  })

  it('honours foreign keys — a photo_tags row with a missing photoId is rejected', async () => {
    const db = migrated()
    await db
      .prepare('INSERT INTO tags (id, slug, label) VALUES (?, ?, ?)')
      .bind('tag_1', 'kyoto', 'Kyoto')
      .run()
    await expect(
      db
        .prepare('INSERT INTO photo_tags (photoId, tagId) VALUES (?, ?)')
        .bind('photo_missing', 'tag_1')
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/i)
  })

  it('honours ON DELETE CASCADE from photo_tags to photos', async () => {
    const db = migrated()
    await insertPhoto(db)
    await db
      .prepare('INSERT INTO tags (id, slug, label) VALUES (?, ?, ?)')
      .bind('tag_1', 'kyoto', 'Kyoto')
      .run()
    await db
      .prepare('INSERT INTO photo_tags (photoId, tagId) VALUES (?, ?)')
      .bind('photo_1', 'tag_1')
      .run()

    await db.prepare('DELETE FROM photos WHERE id = ?').bind('photo_1').run()

    const links = await db.prepare('SELECT photoId FROM photo_tags').all<{ photoId: string }>()
    expect(links.results).toEqual([])
  })

  it('honours the unique slug index', async () => {
    const db = migrated()
    await insertPhoto(db)
    await expect(insertPhoto(db, { id: 'photo_2' })).rejects.toThrow(/UNIQUE/i)
  })

  it('first returns null when the query matches nothing', async () => {
    const db = migrated()
    expect(await db.prepare('SELECT id FROM photos WHERE id = ?').bind('nope').first()).toBeNull()
  })

  it('all returns an empty result set rather than undefined', async () => {
    const db = migrated()
    const result = await db.prepare('SELECT id FROM photos').all<{ id: string }>()
    expect(result.results).toEqual([])
  })

  it('maps a JS undefined bind to SQL NULL', async () => {
    const db = migrated()
    await db
      .prepare('INSERT INTO tags (id, slug, label) VALUES (?, ?, ?)')
      .bind('tag_1', 'kyoto', 'Kyoto')
      .run()
    const row = await db
      .prepare('SELECT id, label FROM tags WHERE id = ?')
      .bind('tag_1')
      .first<{ id: string; label: string }>()
    expect(row).toEqual({ id: 'tag_1', label: 'Kyoto' })

    await expect(
      db
        .prepare('INSERT INTO tags (id, slug, label) VALUES (?, ?, ?)')
        .bind('tag_2', 'film', undefined)
        .run(),
    ).rejects.toThrow(/NOT NULL/i)
  })

  it('batch applies every statement', async () => {
    const db = migrated()
    await db.batch([
      db
        .prepare('INSERT INTO tags (id, slug, label) VALUES (?, ?, ?)')
        .bind('tag_1', 'kyoto', 'Kyoto'),
      db
        .prepare('INSERT INTO tags (id, slug, label) VALUES (?, ?, ?)')
        .bind('tag_2', 'film', 'Film'),
    ])
    const tags = await db.prepare('SELECT slug FROM tags ORDER BY slug').all<{ slug: string }>()
    expect(tags.results).toEqual([{ slug: 'film' }, { slug: 'kyoto' }])
  })

  it('batch rolls the whole batch back when one statement fails', async () => {
    const db = migrated()
    await expect(
      db.batch([
        db
          .prepare('INSERT INTO tags (id, slug, label) VALUES (?, ?, ?)')
          .bind('tag_1', 'kyoto', 'Kyoto'),
        db
          .prepare('INSERT INTO tags (id, slug, label) VALUES (?, ?, ?)')
          .bind('tag_2', 'kyoto', 'Dup'),
      ]),
    ).rejects.toThrow(/UNIQUE/i)

    const tags = await db.prepare('SELECT id FROM tags').all<{ id: string }>()
    expect(tags.results).toEqual([])
  })

  it('keeps each fake on an isolated database', async () => {
    const first = migrated()
    await insertPhoto(first)
    const second = migrated()
    const rows = await second.prepare('SELECT id FROM photos').all<{ id: string }>()
    expect(rows.results).toEqual([])
  })
})
