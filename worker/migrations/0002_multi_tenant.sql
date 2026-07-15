CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS user_docs (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  schema_version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_secrets (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('hoyolab', 'discord', 'telegram')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  masked_label TEXT NOT NULL,
  consented_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE IF NOT EXISTS user_alerts_sent (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_user_alerts_sent_time ON user_alerts_sent(sent_at);
CREATE INDEX IF NOT EXISTS idx_user_docs_updated ON user_docs(updated_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON audit_log(user_id, created_at DESC);
