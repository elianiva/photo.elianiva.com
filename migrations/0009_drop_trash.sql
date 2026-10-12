-- The Trash is gone: deleting a Photo removes its row and its R2 objects at
-- once, so `deletedAt` has nothing left to say.
--
-- Both indexes that name the column go first, because SQLite refuses to drop an
-- indexed column. The status index keeps its job without the `deletedAt IS NULL`
-- predicate, which every row satisfied once nothing was soft-deleted.
-- Applied by Alchemy D1 migrations (migrations: "./migrations")

DROP INDEX IF EXISTS idx_photos_live;
DROP INDEX IF EXISTS idx_photos_status;
CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status);

ALTER TABLE photos DROP COLUMN deletedAt;
