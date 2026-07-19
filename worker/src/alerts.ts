import type { PendingAlert } from '@technogg/shared';
import { evaluateAlerts, inQuietHours } from '@technogg/shared';
import { loadUserDocument } from './db';
import type { Bindings } from './env';
import { dispatchAlerts, type NotificationSecrets } from './notify';
import { getSecret } from './secrets';

const RETENTION_MS = 60 * 86_400_000;

async function notificationSecrets(env: Bindings, userId: string): Promise<NotificationSecrets> {
  const [discord, telegram] = await Promise.all([
    getSecret<{ webhook: string }>(env.DB, env.MASTER_KEY, userId, 'discord', env.PREVIOUS_MASTER_KEY),
    getSecret<{ token: string; chatId: string }>(env.DB, env.MASTER_KEY, userId, 'telegram', env.PREVIOUS_MASTER_KEY),
  ]);
  return { ...(discord ? { discord } : {}), ...(telegram ? { telegram } : {}) };
}

export async function sendTestAlert(env: Bindings, userId: string): Promise<string[]> {
  const alert: PendingAlert = {
    dedupeKey: `test:${Date.now()}`,
    gameId: null,
    type: 'reminder',
    title: "Techno's Library test ping",
    body: 'Alerts are connected. May your pulls be golden.',
    color: '#8b5cf6',
  };
  return dispatchAlerts(await notificationSecrets(env, userId), [alert]);
}

export async function processUserAlerts(
  env: Bindings,
  userId: string,
  now = Date.now(),
): Promise<{ pending: number; delivered: number }> {
  const document = await loadUserDocument(env.DB, userId);
  const state = document.state;
  const pending = evaluateAlerts(state, now);
  if (pending.length === 0 || inQuietHours(state.settings, now)) {
    return { pending: pending.length, delivered: 0 };
  }

  const placeholders = pending.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT dedupe_key FROM user_alerts_sent WHERE user_id = ? AND dedupe_key IN (${placeholders})`,
  )
    .bind(userId, ...pending.map((alert) => alert.dedupeKey))
    .all<{ dedupe_key: string }>();
  const sent = new Set(rows.results.map((row) => row.dedupe_key));
  const fresh = pending.filter((alert) => !sent.has(alert.dedupeKey));
  if (fresh.length === 0) return { pending: pending.length, delivered: 0 };

  const channels = await dispatchAlerts(await notificationSecrets(env, userId), fresh);
  if (channels.length === 0) return { pending: pending.length, delivered: 0 };

  const insert = env.DB.prepare(
    'INSERT OR IGNORE INTO user_alerts_sent (user_id, dedupe_key, sent_at) VALUES (?, ?, ?)',
  );
  await env.DB.batch(fresh.map((alert) => insert.bind(userId, alert.dedupeKey, now)));
  await env.DB.prepare('DELETE FROM user_alerts_sent WHERE sent_at < ?')
    .bind(now - RETENTION_MS)
    .run();
  return { pending: pending.length, delivered: fresh.length };
}
