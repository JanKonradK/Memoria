import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { emptyState, type Game } from '@void/shared';
import { deleteUserData, loadUserDocument, mergeUserDocument } from '../src/db';
import { getSecret, putSecret, rotateSecretBatch } from '../src/secrets';

function game(id: string, updatedAt = Date.now()): Game {
  return {
    id,
    name: id,
    short: id,
    color: '#8b5cf6',
    icon: '🎮',
    platform: 'both',
    tz: 'UTC',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    paused: false,
    sort: 0,
    updatedAt,
  };
}

describe('tenant documents', () => {
  it('isolates users and preserves concurrent row-wise changes', async () => {
    const left = { ...emptyState(), games: [game('left')] };
    const right = { ...emptyState(), games: [game('right')] };
    await Promise.all([
      mergeUserDocument(env.DB, 'user-a', left),
      mergeUserDocument(env.DB, 'user-a', right),
      mergeUserDocument(env.DB, 'user-b', { ...emptyState(), games: [game('private-b')] }),
    ]);

    const a = await loadUserDocument(env.DB, 'user-a');
    const b = await loadUserDocument(env.DB, 'user-b');
    expect(a.state.games.map((item) => item.id).sort()).toEqual(['left', 'right']);
    expect(b.state.games.map((item) => item.id)).toEqual(['private-b']);
  });

  it('encrypts integration values and deletes every tenant record', async () => {
    const masterKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    await putSecret(
      env.DB,
      masterKey,
      'delete-me',
      'discord',
      { webhook: 'https://discord.com/api/webhooks/123/very-secret' },
      'Webhook …0123',
    );
    const row = await env.DB.prepare('SELECT ciphertext FROM user_secrets WHERE user_id = ?')
      .bind('delete-me')
      .first<{ ciphertext: string }>();
    expect(row?.ciphertext).not.toContain('very-secret');
    expect(await getSecret(env.DB, masterKey, 'delete-me', 'discord')).toEqual({
      webhook: 'https://discord.com/api/webhooks/123/very-secret',
    });
    expect(
      await getSecret(env.DB, 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=', 'delete-me', 'discord', masterKey),
    ).toEqual({ webhook: 'https://discord.com/api/webhooks/123/very-secret' });
    const nextKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
    expect(await rotateSecretBatch(env.DB, nextKey, masterKey, 2)).toBeGreaterThan(0);
    expect(await getSecret(env.DB, nextKey, 'delete-me', 'discord')).toEqual({
      webhook: 'https://discord.com/api/webhooks/123/very-secret',
    });

    await deleteUserData(env.DB, 'delete-me');
    expect(
      await env.DB.prepare('SELECT 1 AS found FROM user_secrets WHERE user_id = ?').bind('delete-me').first(),
    ).toBeNull();
    expect(await env.DB.prepare('SELECT 1 AS found FROM users WHERE user_id = ?').bind('delete-me').first()).toBeNull();
    expect(
      await env.DB.prepare('SELECT 1 AS found FROM audit_log WHERE user_id = ?').bind('delete-me').first(),
    ).toBeNull();
  });
});
