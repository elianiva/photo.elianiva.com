-- Settings singleton + tag captions
-- Applied by Alchemy D1 migrations (migrations: "./migrations")

-- One row, id pinned to 1. It holds the export defaults a new upload is seeded
-- from, the watermark and metadata policy, the Storage retention setting, and
-- the SITE copy the public Masthead, Folio nav and Colophon read.
--
-- `sections` is a JSON array of { label, kind, target } in nav order, not the
-- design's single `ALL · STREET · LANDSCAPE · SERIES · ABOUT` string: that
-- string cannot be routed, so a nav entry has to name its own destination.
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  updatedAt TEXT NOT NULL,

  -- Export defaults
  defaultPreviewLongEdge INTEGER NOT NULL DEFAULT 1200,
  defaultPreviewFormat    TEXT NOT NULL DEFAULT 'avif',
  defaultPreviewQuality   INTEGER NOT NULL DEFAULT 82,
  defaultFullQuality      INTEGER NOT NULL DEFAULT 92,

  -- Watermark
  watermarkEnabled   INTEGER NOT NULL DEFAULT 0,
  watermarkColour    TEXT NOT NULL DEFAULT 'white',
  watermarkPosition  TEXT NOT NULL DEFAULT 'bottom-right',

  -- Metadata
  defaultKeepExif    INTEGER NOT NULL DEFAULT 1,
  defaultRemoveGps   INTEGER NOT NULL DEFAULT 1,
  copyright          TEXT,

  -- Archive
  retainForever      INTEGER NOT NULL DEFAULT 1,

  -- Site
  volume             TEXT NOT NULL DEFAULT 'V',
  motto              TEXT,
  aboutCopy          TEXT,
  sections           TEXT
) STRICT;

-- The one row, idempotently: a second run leaves the existing row and its
-- updatedAt alone. ISO-8601 with millis and a Z, which is what the app writes.
INSERT OR IGNORE INTO settings (id, updatedAt) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Tag captions feed the public Series rows — `Ferries, rain, and the long light
-- on Istiklal.` Nullable, so every existing tag reads null rather than ''.
ALTER TABLE tags ADD COLUMN caption TEXT;
