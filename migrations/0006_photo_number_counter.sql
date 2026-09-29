-- The Photo Number counter, deliberately outside `photos`.
--
-- A Photo Number is never reused — not by a deleted Photo, and not by a
-- trashed one (CONTEXT.md), and #29 rests on that when it purges a row and
-- #20 rests on it when it serves `No. 024`. `MAX(number) + 1` cannot honour it:
-- a purge deletes the row, and the next upload issues the freed serial again
-- (proved in `photo-service.test.ts`). The counter is one row, bumped inside
-- the same transaction as the insert that spends it, so the serial survives
-- every deletion.
--
-- Applied by Alchemy D1 migrations (migrations: "./migrations")

CREATE TABLE IF NOT EXISTS photo_number_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL DEFAULT 0
) STRICT;

-- Single row, and convergent: 0004's backfill may have already numbered rows,
-- so the counter starts above the highest serial in existence. `OR IGNORE`
-- leaves an existing counter alone, which is what makes a re-run a no-op
-- instead of a rewind.
INSERT OR IGNORE INTO photo_number_counter (id, value)
VALUES (1, (SELECT COALESCE(MAX(number), 0) FROM photos));
