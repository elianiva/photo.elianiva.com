-- The grid's own rendition (`renditions/<id>/thumb.webp`, ~640px). Photos
-- uploaded before it existed stay at 0 until the Library's backfill makes one.

ALTER TABLE photos ADD COLUMN thumb INTEGER NOT NULL DEFAULT 0 CHECK (thumb IN (0, 1));
