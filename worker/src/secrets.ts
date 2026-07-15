import type { IntegrationKind, IntegrationStatus } from '@technogg/shared';
import { audit, ensureUser } from './db';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey(masterKey: string): Promise<CryptoKey> {
  const bytes = base64ToBytes(masterKey);
  if (bytes.byteLength !== 32) throw new Error('MASTER_KEY must be a base64-encoded 32-byte key');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptJson(masterKey: string, value: unknown): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(masterKey), plaintext);
  return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv) };
}

export async function decryptJson<T>(masterKey: string, ciphertext: string, iv: string): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    await encryptionKey(masterKey),
    base64ToBytes(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export async function putSecret(
  db: D1Database,
  masterKey: string,
  userId: string,
  kind: IntegrationKind,
  value: Record<string, string>,
  maskedLabel: string,
  now = Date.now(),
  keyVersion = 1,
): Promise<void> {
  await ensureUser(db, userId, now);
  const encrypted = await encryptJson(masterKey, value);
  await db
    .prepare(
      'INSERT INTO user_secrets (user_id, kind, ciphertext, iv, masked_label, consented_at, updated_at, key_version) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, kind) DO UPDATE SET ' +
        'ciphertext = excluded.ciphertext, iv = excluded.iv, masked_label = excluded.masked_label, ' +
        'consented_at = excluded.consented_at, updated_at = excluded.updated_at, key_version = excluded.key_version',
    )
    .bind(userId, kind, encrypted.ciphertext, encrypted.iv, maskedLabel, now, now, keyVersion)
    .run();
  await audit(db, userId, `integration.${kind}.connected`, {}, now);
}

export async function getSecret<T>(
  db: D1Database,
  masterKey: string,
  userId: string,
  kind: IntegrationKind,
  previousMasterKey?: string,
): Promise<T | null> {
  const row = await db
    .prepare('SELECT ciphertext, iv FROM user_secrets WHERE user_id = ? AND kind = ?')
    .bind(userId, kind)
    .first<{ ciphertext: string; iv: string }>();
  if (!row) return null;
  try {
    return await decryptJson<T>(masterKey, row.ciphertext, row.iv);
  } catch (error) {
    if (!previousMasterKey) throw error;
    return decryptJson<T>(previousMasterKey, row.ciphertext, row.iv);
  }
}

export async function deleteSecret(
  db: D1Database,
  userId: string,
  kind: IntegrationKind,
  now = Date.now(),
): Promise<void> {
  await db.prepare('DELETE FROM user_secrets WHERE user_id = ? AND kind = ?').bind(userId, kind).run();
  await audit(db, userId, `integration.${kind}.disconnected`, {}, now);
}

export async function listIntegrationStatuses(db: D1Database, userId: string): Promise<IntegrationStatus[]> {
  const rows = await db
    .prepare('SELECT kind, masked_label, consented_at, updated_at FROM user_secrets WHERE user_id = ?')
    .bind(userId)
    .all<{ kind: IntegrationKind; masked_label: string; consented_at: number; updated_at: number }>();
  const byKind = new Map(rows.results.map((row) => [row.kind, row]));
  return (['discord', 'telegram'] as const).map((kind) => {
    const row = byKind.get(kind);
    return {
      kind,
      connected: Boolean(row),
      maskedLabel: row?.masked_label ?? '',
      updatedAt: row?.updated_at ?? null,
      consentedAt: row?.consented_at ?? null,
    };
  });
}

export async function rotateSecretBatch(
  db: D1Database,
  currentMasterKey: string,
  previousMasterKey: string,
  currentVersion: number,
  limit = 100,
): Promise<number> {
  const rows = await db
    .prepare(
      'SELECT user_id, kind, ciphertext, iv FROM user_secrets WHERE key_version <> ? ORDER BY user_id, kind LIMIT ?',
    )
    .bind(currentVersion, Math.min(100, Math.max(1, limit)))
    .all<{ user_id: string; kind: IntegrationKind; ciphertext: string; iv: string }>();
  for (const row of rows.results) {
    const value = await decryptJson<Record<string, string>>(previousMasterKey, row.ciphertext, row.iv);
    const encrypted = await encryptJson(currentMasterKey, value);
    await db
      .prepare(
        'UPDATE user_secrets SET ciphertext = ?, iv = ?, key_version = ?, updated_at = ? WHERE user_id = ? AND kind = ?',
      )
      .bind(encrypted.ciphertext, encrypted.iv, currentVersion, Date.now(), row.user_id, row.kind)
      .run();
  }
  return rows.results.length;
}
