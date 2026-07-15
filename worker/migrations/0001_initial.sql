-- Legacy single-document schema retained for local data migration.
CREATE TABLE IF NOT EXISTS doc (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts_sent (
  dedupe_key TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL
);
