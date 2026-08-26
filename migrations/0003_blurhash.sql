-- Blurhash placeholder: encoded client-side at upload time (Workers cannot
-- decode pixels), decoded back to a tiny placeholder in the browser.
-- Applied by Alchemy D1 migrations (migrations: "./migrations")

ALTER TABLE photos ADD COLUMN blurhash TEXT;
