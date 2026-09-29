-- Photo lifecycle and presentation: Status, Photo Number, the original's byte
-- and MIME facts, Ratio, soft delete, the four EXIF facts the public Exif line
-- prints, the authored crop, and the mat and export settings.
-- Applied by Alchemy D1 migrations (migrations: "./migrations")

-- lifecycle
ALTER TABLE photos ADD COLUMN status TEXT NOT NULL DEFAULT 'published'
  CHECK (status IN ('draft', 'published', 'failed'));
ALTER TABLE photos ADD COLUMN number INTEGER;
ALTER TABLE photos ADD COLUMN deletedAt TEXT;

-- the original in R2
ALTER TABLE photos ADD COLUMN bytes INTEGER;
ALTER TABLE photos ADD COLUMN mime TEXT;

-- Ratio is one of six values, so it is checked rather than trusted: a bare
-- TEXT column is how a typo becomes a frame the front end cannot lay out.
ALTER TABLE photos ADD COLUMN ratio TEXT
  CHECK (ratio IN ('3:2', '2:3', '4:3', '3:4', '16:9', '9:16'));

-- EXIF facts the public Exif line formats. Nullable because EXIF coverage in
-- consumer JPEGs is patchy and a missing fact is omitted, never invented.
ALTER TABLE photos ADD COLUMN aperture REAL;
ALTER TABLE photos ADD COLUMN shutter REAL;
ALTER TABLE photos ADD COLUMN iso INTEGER;
ALTER TABLE photos ADD COLUMN focalLength REAL;

-- authored crop: pan and zoom inside the Ratio, then level
ALTER TABLE photos ADD COLUMN cropX REAL NOT NULL DEFAULT 0;
ALTER TABLE photos ADD COLUMN cropY REAL NOT NULL DEFAULT 0;
ALTER TABLE photos ADD COLUMN cropScale REAL NOT NULL DEFAULT 1;
ALTER TABLE photos ADD COLUMN level REAL;

-- the mat. The design heads this panel BORDER and labels its rows Mat Colour
-- and Mat Style; the columns follow the heading. See CONTEXT.md.
ALTER TABLE photos ADD COLUMN borderEnabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE photos ADD COLUMN borderStyle TEXT;
ALTER TABLE photos ADD COLUMN borderColour TEXT;
ALTER TABLE photos ADD COLUMN borderWidth REAL;

-- export settings for the PREVIEW and FULL renditions
ALTER TABLE photos ADD COLUMN previewLongEdge INTEGER NOT NULL DEFAULT 1200;
ALTER TABLE photos ADD COLUMN previewFormat TEXT NOT NULL DEFAULT 'avif';
ALTER TABLE photos ADD COLUMN previewQuality INTEGER NOT NULL DEFAULT 82;
ALTER TABLE photos ADD COLUMN fullQuality INTEGER NOT NULL DEFAULT 92;
ALTER TABLE photos ADD COLUMN keepExif INTEGER NOT NULL DEFAULT 1;
ALTER TABLE photos ADD COLUMN removeGps INTEGER NOT NULL DEFAULT 1;

-- backfill
-- Each statement is guarded so a re-run converges instead of renumbering: a
-- Photo that already carries a Photo Number or a Ratio keeps it, so a retried
-- or hand-applied backfill can never reissue a serial. Alchemy applies a file
-- once, and the ALTERs above are not re-runnable; this section is.
--
-- A pre-0004 Photo was a live, published JPEG original. `status` and
-- `deletedAt` already hold those values through their column defaults, so
-- writing them here would be a no-op on the first run and a regression on the
-- second — it would unpublish a published Photo and un-trash a trashed one.
-- `mime` has no default, so it is the one of the three that needs writing.
UPDATE photos
SET mime = COALESCE(mime, 'image/jpeg');

-- Photo Number: one site-wide serial, oldest photograph first, undated Photos
-- last, ties broken by id so the assignment is deterministic. `number` stays
-- nullable because it is a stored serial rather than a row identity — a
-- Photo Number is assigned on insert and preserved through trash and purge,
-- which a NOT NULL column could not express without rebuilding the table.
-- #16 must keep the tolerance below in step with its `nearestRatio`.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY takenAt IS NULL, takenAt, id) AS serial
  FROM photos
)
UPDATE photos
SET number = (SELECT serial FROM ranked WHERE ranked.id = photos.id)
WHERE number IS NULL;

-- Ratio: snap the measured frame to the nearest supported value within 0.02.
-- A frame matching none of the six stays NULL — the author picks its Ratio in
-- the Editor rather than have the migration invent one.
UPDATE photos
SET ratio = CASE
  WHEN ABS(CAST(width AS REAL) / height - 1.5)        <= 0.02 THEN '3:2'
  WHEN ABS(CAST(width AS REAL) / height - 2.0 / 3.0)  <= 0.02 THEN '2:3'
  WHEN ABS(CAST(width AS REAL) / height - 4.0 / 3.0)  <= 0.02 THEN '4:3'
  WHEN ABS(CAST(width AS REAL) / height - 0.75)       <= 0.02 THEN '3:4'
  WHEN ABS(CAST(width AS REAL) / height - 16.0 / 9.0)  <= 0.02 THEN '16:9'
  WHEN ABS(CAST(width AS REAL) / height - 9.0 / 16.0)  <= 0.02 THEN '9:16'
END
WHERE ratio IS NULL;

-- indexes
-- Created after the backfill so the unique index validates the Photo Numbers
-- the backfill just issued.
--
-- Photo Number is unique site-wide. The predicate is what makes the nullable
-- column workable: a row that has not been numbered yet cannot collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_number ON photos(number) WHERE number IS NOT NULL;

-- Many Photos share a Ratio, so this is a lookup, not a constraint.
CREATE INDEX IF NOT EXISTS idx_photos_ratio ON photos(ratio);

-- Every list query grows `WHERE deletedAt IS NULL`. Leading on it keeps the
-- Archive and the Admin library off a scan and still orders by takenAt.
CREATE INDEX IF NOT EXISTS idx_photos_live ON photos(deletedAt, takenAt);

-- Status counts and the sidebar meters, over live Photos only.
CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status) WHERE deletedAt IS NULL;
