-- Photo showcase: flat list, tags, JSON metadata
-- Applied by Alchemy D1 migrations (migrations: "./migrations")

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  r2Key TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  takenAt TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL
) STRICT;

CREATE TABLE photo_tags (
  photoId TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  tagId TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (photoId, tagId)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_photos_takenAt ON photos(takenAt);
CREATE INDEX idx_photo_tags_tagId ON photo_tags(tagId);
CREATE INDEX idx_tags_slug ON tags(slug);
