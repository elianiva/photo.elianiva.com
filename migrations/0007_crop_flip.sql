-- The crop's horizontal flip. The Editor's transform row draws a mirror beside
-- the two straighten buttons, and a mirror is authored data like the pan and
-- the zoom, so it is a column on the Photo rather than a view-only toggle.
-- 0004 authored the crop without it; this is the one field it was missing.
--
-- NOT NULL with a default of 0, so an un-flipped Photo is the default and every
-- pre-0007 row reads back as un-flipped rather than as an unknown.
ALTER TABLE photos ADD COLUMN cropFlip INTEGER NOT NULL DEFAULT 0;
