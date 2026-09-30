-- The settings row keeps only what the photograph pipeline reads.
--
-- Five columns go, all of them text or nav that the public site no longer reads
-- because every line it prints is authored in `home/content.ts`:
--
-- - `volume`    — `VOL. V` was the Masthead's newspaper cosplay, and the Admin
--                 never had a control for it: the row only ever carried the
--                 column default.
-- - `motto`     — the Masthead's centred site name. The Front prints the
--                 authored one, so this column was written and never read.
-- - `aboutCopy` — the Colophon's About paragraph. The Colophon prints the
--                 authored blurb.
-- - `sections`  — the Folio nav. The Folio prints the authored nav, so the
--                 Admin's repeater was editing a column the site ignored.
-- - `copyright` — the Colophon's rights line, authored like the rest of it.
--
-- What is left is the export defaults, the watermark and metadata policy and
-- the retention setting, which the pipeline genuinely reads.
--
-- Applied by Alchemy D1 migrations (migrations: "./migrations")

ALTER TABLE settings DROP COLUMN volume;
ALTER TABLE settings DROP COLUMN motto;
ALTER TABLE settings DROP COLUMN aboutCopy;
ALTER TABLE settings DROP COLUMN sections;
ALTER TABLE settings DROP COLUMN copyright;
