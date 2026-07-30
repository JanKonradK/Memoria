DROP INDEX IF EXISTS idx_user_alerts_sent_time;
DROP TABLE IF EXISTS user_alerts_sent;
DROP TABLE IF EXISTS alerts_sent;
DROP TABLE IF EXISTS user_secrets;

DROP INDEX IF EXISTS idx_users_alerts_checked_at;
ALTER TABLE users DROP COLUMN alerts_checked_at;
