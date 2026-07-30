import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { emptyState, type Game } from '@void/shared';
import { deleteUserData, loadUserDocument, mergeUserDocument } from '../src/db';

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

  it('deletes every tenant record while retaining a non-identifying audit marker', async () => {
    await mergeUserDocument(env.DB, 'delete-me', { ...emptyState(), games: [game('private')] });
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO client_errors (user_id, message, stack, build, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind('delete-me', 'private error', '', 'test', Date.now()),
      env.DB.prepare('INSERT INTO audit_log (user_id, action, metadata_json, created_at) VALUES (?, ?, ?, ?)').bind(
        'delete-me',
        'account.accessed',
        '{}',
        Date.now(),
      ),
    ]);

    await deleteUserData(env.DB, 'delete-me');
    expect(await env.DB.prepare('SELECT 1 AS found FROM users WHERE user_id = ?').bind('delete-me').first()).toBeNull();
    expect(
      await env.DB.prepare('SELECT 1 AS found FROM user_docs WHERE user_id = ?').bind('delete-me').first(),
    ).toBeNull();
    expect(
      await env.DB.prepare('SELECT 1 AS found FROM client_errors WHERE user_id = ?').bind('delete-me').first(),
    ).toBeNull();
    expect(
      await env.DB.prepare('SELECT 1 AS found FROM audit_log WHERE user_id = ?').bind('delete-me').first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT user_id FROM audit_log WHERE action = 'account.deleted' ORDER BY id DESC").first<{
        user_id: string;
      }>(),
    ).toMatchObject({ user_id: expect.stringMatching(/^deleted:[a-f0-9]{24}$/) });
  });
});
