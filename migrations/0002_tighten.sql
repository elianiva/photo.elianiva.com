-- Tighten constraints: unique R2 key, drop redundant tag index
-- Applied by Alchemy D1 migrations (migrations: "./migrations")

CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_r2Key ON photos(r2Key);
DROP INDEX IF EXISTS idx_tags_slug;
