-- Single-user state document (the whole AppState as JSON).
CREATE TABLE IF NOT EXISTS doc (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Alert dedupe ledger: one row per alert that has been delivered.
CREATE TABLE IF NOT EXISTS alerts_sent (
  dedupe_key TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL
);
