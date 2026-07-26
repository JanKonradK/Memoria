import type { PendingAlert } from '@void/shared';
import { evaluateAlerts, inQuietHours } from '@void/shared';
import { claimUsersForAlertSweep, loadUserDocument } from './db';
import type { Bindings } from './env';
import { dispatchAlerts, type NotificationSecrets } from './notify';
import { hashUserId } from './redact';
import { getSecret } from './secrets';

const RETENTION_MS = 60 * 86_400_000;
const DEFAULT_SWEEP_MAX_USERS = 5;
const DEFAULT_SWEEP_CONCURRENCY = 2;
const DEFAULT_SWEEP_BUDGET_MS = 20_000;

export interface AlertSweep {
  scanned: number;
  delivered: number;
  failed: number;
}

function positiveInteger(value: number | string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

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
    title: 'Void test ping',
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

export async function sweepAlerts(
  env: Bindings,
  opts: { now?: number; maxUsers?: number; concurrency?: number; budgetMs?: number } = {},
): Promise<AlertSweep> {
  const now = opts.now ?? Date.now();
  const maxUsers = positiveInteger(opts.maxUsers ?? env.ALERT_SWEEP_MAX_USERS, DEFAULT_SWEEP_MAX_USERS);
  const concurrency = Math.min(3, positiveInteger(opts.concurrency, DEFAULT_SWEEP_CONCURRENCY));
  const budgetMs = positiveInteger(opts.budgetMs, DEFAULT_SWEEP_BUDGET_MS);
  const startedAt = Date.now();
  const userIds = await claimUsersForAlertSweep(env.DB, maxUsers);
  const result: AlertSweep = { scanned: 0, delivered: 0, failed: 0 };
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (Date.now() - startedAt < budgetMs) {
      const index = nextIndex++;
      const userId = userIds[index];
      if (!userId) return;
      result.scanned++;
      let userFailed = false;
      try {
        const processed = await processUserAlerts(env, userId, now);
        result.delivered += processed.delivered;
      } catch (error) {
        userFailed = true;
        result.failed++;
        console.error(
          JSON.stringify({
            type: 'alert.sweep.error',
            user: await hashUserId(userId),
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      try {
        await env.DB.prepare('UPDATE users SET alerts_checked_at = ? WHERE user_id = ?').bind(now, userId).run();
      } catch (error) {
        if (!userFailed) result.failed++;
        console.error(
          JSON.stringify({
            type: 'alert.sweep.checkpoint.error',
            user: await hashUserId(userId),
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, userIds.length) }, () => runNext()));
  return result;
}
