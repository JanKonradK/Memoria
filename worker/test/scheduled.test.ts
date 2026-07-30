import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { pruneOperationalData, shouldRunOperationalRetention } from '../src/db';

describe('scheduled operational retention', () => {
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
