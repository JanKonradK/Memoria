ALTER TABLE users ADD COLUMN alerts_checked_at INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_alerts_checked_at ON users(alerts_checked_at);
