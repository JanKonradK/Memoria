import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from '@void/shared';
import { sweepAlerts } from '../src/alerts';
import { mergeUserDocument, pruneOperationalData, shouldRunOperationalRetention } from '../src/db';
import { putSecret } from '../src/secrets';

const masterKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function dueState(now: number) {
  const state = emptyState();
  state.settings = { ...state.settings, quietStart: null, quietEnd: null };
  state.reminders = [
    {
      id: `reminder-${now}`,
      gameId: null,
      message: 'Spend energy',
      at: now - 1,
      updatedAt: now,
    },
  ];
  return state;
}

async function checkedAt(userId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT alerts_checked_at FROM users WHERE user_id = ?')
    .bind(userId)
    .first<{ alerts_checked_at: number }>();
  return row?.alerts_checked_at ?? -1;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await env.DB.prepare('UPDATE users SET alerts_checked_at = ?').bind(Number.MAX_SAFE_INTEGER).run();
});

describe('scheduled alert sweep', () => {
  it('rotates users across consecutive sweeps', async () => {
    const firstNow = Date.now();
    const userIds = ['rotation-a', 'rotation-b', 'rotation-c'];
    for (const userId of userIds) {
      await mergeUserDocument(env.DB, userId, dueState(firstNow), firstNow);
    }

    for (let index = 0; index < userIds.length; index++) {
      expect(await sweepAlerts(env, { now: firstNow + index, maxUsers: 1 })).toMatchObject({
        scanned: 1,
        failed: 0,
      });
      const advanced = await Promise.all(userIds.map(async (userId) => (await checkedAt(userId)) !== 0));
      expect(advanced.filter(Boolean)).toHaveLength(index + 1);
    }
  });

  it('continues after a per-user failure and advances the failed user', async () => {
    const now = Date.now();
    const userIds = ['failure-a', 'failure-b'];
    for (const userId of userIds) {
      await mergeUserDocument(env.DB, userId, dueState(now), now);
    }
    await putSecret(
      env.DB,
      masterKey,
      'failure-a',
      'discord',
      { webhook: 'https://discord.com/api/webhooks/123/test' },
      'Webhook …0123',
      now,
    );
    await env.DB.prepare("UPDATE user_secrets SET ciphertext = 'invalid' WHERE user_id = ?").bind('failure-a').run();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await sweepAlerts(env, { now, maxUsers: 2, concurrency: 1 })).toEqual({
      scanned: 2,
      delivered: 0,
      failed: 1,
    });
    expect(await Promise.all(userIds.map(checkedAt))).toEqual([now, now]);
  });

  it('respects maxUsers', async () => {
    const now = Date.now();
    const userIds = ['maximum-a', 'maximum-b', 'maximum-c'];
    for (const userId of userIds) {
      await mergeUserDocument(env.DB, userId, dueState(now), now);
    }

    expect(await sweepAlerts(env, { now, maxUsers: 2 })).toMatchObject({ scanned: 2 });
    const advanced = await Promise.all(userIds.map(async (userId) => (await checkedAt(userId)) === now));
    expect(advanced.filter(Boolean)).toHaveLength(2);
  });

  it('gates retention to the first cron slot each hour', () => {
    expect(shouldRunOperationalRetention(Date.UTC(2026, 0, 1, 12, 0))).toBe(true);
    expect(shouldRunOperationalRetention(Date.UTC(2026, 0, 1, 12, 10))).toBe(false);
  });

  it('prunes global operational tables with their separate retention windows', async () => {
    const now = Date.UTC(2026, 0, 1, 12);
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO client_errors (user_id, message, stack, build, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind('retention', 'old-client-error', '', 'test', now - 30 * 86_400_000 - 1),
      env.DB.prepare(
        'INSERT INTO client_errors (user_id, message, stack, build, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind('retention', 'new-client-error', '', 'test', now - 30 * 86_400_000),
      env.DB.prepare('INSERT INTO audit_log (user_id, action, metadata_json, created_at) VALUES (?, ?, ?, ?)').bind(
        'retention',
        'old-audit',
        '{}',
        now - 180 * 86_400_000 - 1,
      ),
      env.DB.prepare('INSERT INTO audit_log (user_id, action, metadata_json, created_at) VALUES (?, ?, ?, ?)').bind(
        'retention',
        'new-audit',
        '{}',
        now - 180 * 86_400_000,
      ),
      env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)').bind(
        'retention-old',
        now - 120_001,
        1,
      ),
      env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)').bind(
        'retention-new',
        now - 120_000,
        1,
      ),
    ]);

    await pruneOperationalData(env.DB, now);

    expect(
      await env.DB.prepare("SELECT message FROM client_errors WHERE user_id = 'retention' ORDER BY message").all<{
        message: string;
      }>(),
    ).toMatchObject({ results: [{ message: 'new-client-error' }] });
    expect(
      await env.DB.prepare("SELECT action FROM audit_log WHERE user_id = 'retention' ORDER BY action").all<{
        action: string;
      }>(),
    ).toMatchObject({ results: [{ action: 'new-audit' }] });
    expect(
      await env.DB.prepare("SELECT key FROM rate_limits WHERE key LIKE 'retention-%' ORDER BY key").all<{
        key: string;
      }>(),
    ).toMatchObject({ results: [{ key: 'retention-new' }] });
  });
});
