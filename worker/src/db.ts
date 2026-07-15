import type { AppState } from '@technogg/shared';
import {
  CURRENT_SCHEMA_VERSION,
  compactState,
  emptyState,
  mergeState,
  normalizeState,
  safeParseAppState,
} from '@technogg/shared';

export interface VersionedDocument {
  state: AppState;
  version: number;
  updatedAt: number;
}

const TOMBSTONE_RETENTION_MS = 90 * 86_400_000;

export async function ensureUser(db: D1Database, userId: string, now = Date.now()): Promise<void> {
  await db
    .prepare(
      'INSERT INTO users (user_id, created_at, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(user_id) DO UPDATE SET updated_at = excluded.updated_at, deleted_at = NULL',
    )
    .bind(userId, now, now)
    .run();
}

export async function loadUserDocument(db: D1Database, userId: string): Promise<VersionedDocument> {
  const row = await db
    .prepare('SELECT json, version, updated_at FROM user_docs WHERE user_id = ?')
    .bind(userId)
    .first<{ json: string; version: number; updated_at: number }>();
  if (!row) return { state: emptyState(), version: 0, updatedAt: 0 };
  try {
    return { state: normalizeState(JSON.parse(row.json)), version: row.version, updatedAt: row.updated_at };
  } catch {
    return { state: emptyState(), version: row.version, updatedAt: row.updated_at };
  }
}

export async function mergeUserDocument(
  db: D1Database,
  userId: string,
  incoming: AppState,
  now = Date.now(),
): Promise<VersionedDocument> {
  await ensureUser(db, userId, now);
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await loadUserDocument(db, userId);
    const merged = compactState(mergeState(current.state, incoming), now - TOMBSTONE_RETENTION_MS);
    const validation = safeParseAppState(merged);
    if (!validation.success) throw new Error('document_quota_exceeded');
    const json = JSON.stringify(merged);
    if (new TextEncoder().encode(json).byteLength > 1_000_000) throw new Error('document_quota_exceeded');
    if (current.version === 0) {
      const inserted = await db
        .prepare(
          'INSERT OR IGNORE INTO user_docs (user_id, json, version, schema_version, updated_at) VALUES (?, ?, 1, ?, ?)',
        )
        .bind(userId, json, CURRENT_SCHEMA_VERSION, now)
        .run();
      if ((inserted.meta.changes ?? 0) > 0) return { state: merged, version: 1, updatedAt: now };
      continue;
    }

    const nextVersion = current.version + 1;
    const updated = await db
      .prepare(
        'UPDATE user_docs SET json = ?, version = ?, schema_version = ?, updated_at = ? ' +
          'WHERE user_id = ? AND version = ?',
      )
      .bind(json, nextVersion, CURRENT_SCHEMA_VERSION, now, userId, current.version)
      .run();
    if ((updated.meta.changes ?? 0) > 0) return { state: merged, version: nextVersion, updatedAt: now };
  }
  throw new Error('sync_conflict');
}

export async function replaceUserDocument(
  db: D1Database,
  userId: string,
  state: AppState,
  now = Date.now(),
): Promise<VersionedDocument> {
  await ensureUser(db, userId, now);
  const current = await loadUserDocument(db, userId);
  const version = current.version + 1;
  await db
    .prepare(
      'INSERT INTO user_docs (user_id, json, version, schema_version, updated_at) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, version = excluded.version, ' +
        'schema_version = excluded.schema_version, updated_at = excluded.updated_at',
    )
    .bind(userId, JSON.stringify(state), version, CURRENT_SCHEMA_VERSION, now)
    .run();
  return { state, version, updatedAt: now };
}

export async function deleteUserData(db: D1Database, userId: string, now = Date.now()): Promise<void> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId)));
  const deletedIdentity = `deleted:${Array.from(digest.slice(0, 12))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
  await db.batch([
    db.prepare('DELETE FROM user_alerts_sent WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM user_secrets WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM user_docs WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM client_errors WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM audit_log WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM users WHERE user_id = ?').bind(userId),
    db
      .prepare('INSERT INTO audit_log (user_id, action, metadata_json, created_at) VALUES (?, ?, ?, ?)')
      .bind(deletedIdentity, 'account.deleted', '{}', now),
  ]);
}

export async function listActiveUserIds(db: D1Database, after = '', limit = 100): Promise<string[]> {
  const rows = await db
    .prepare(
      'SELECT d.user_id FROM user_docs d JOIN users u ON u.user_id = d.user_id ' +
        'WHERE d.user_id > ? AND u.deleted_at IS NULL ORDER BY d.user_id LIMIT ?',
    )
    .bind(after, Math.min(100, Math.max(1, limit)))
    .all<{ user_id: string }>();
  return rows.results.map((row) => row.user_id);
}

export async function audit(
  db: D1Database,
  userId: string,
  action: string,
  metadata: Record<string, unknown> = {},
  now = Date.now(),
): Promise<void> {
  await db
    .prepare('INSERT INTO audit_log (user_id, action, metadata_json, created_at) VALUES (?, ?, ?, ?)')
    .bind(userId, action, JSON.stringify(metadata), now)
    .run();
}
