import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { emptyState } from '@technogg/shared';
import { app } from '../src/index';

const headers = {
  authorization: 'Bearer test-token',
  'content-type': 'application/json',
  origin: 'http://localhost:5173',
};

describe('sync API boundaries', () => {
  it('requires authentication and an allowed origin', async () => {
    const unauthorized = await app.request('/api/state', {}, env);
    expect(unauthorized.status).toBe(401);

    const badOrigin = await app.request(
      '/api/state',
      { headers: { authorization: 'Bearer test-token', origin: 'https://evil.example' } },
      env,
    );
    expect(badOrigin.status).toBe(403);
  });

  it('validates and stores a tenant-scoped document without legacy secrets', async () => {
    const state = emptyState() as unknown as Record<string, unknown>;
    state.settings = {
      ...(state.settings as object),
      discordWebhook: 'https://discord.com/api/webhooks/should-not-sync',
      telegramToken: '12345:should-not-sync',
    };
    const response = await app.request('/api/sync', { method: 'POST', headers, body: JSON.stringify({ state }) }, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { state: { settings: Record<string, unknown> }; version: number };
    expect(body.version).toBeGreaterThan(0);
    expect(body.state.settings).not.toHaveProperty('discordWebhook');
    expect(body.state.settings).not.toHaveProperty('telegramToken');
  });

  it('rejects malformed documents', async () => {
    const response = await app.request(
      '/api/sync',
      { method: 'POST', headers, body: JSON.stringify({ state: { games: 'not-an-array' } }) },
      env,
    );
    expect(response.status).toBe(422);
  });

  it('applies security headers on public endpoints', async () => {
    const health = await app.request('/api/health', {}, env);
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect(health.headers.get('x-frame-options')).toBe('DENY');
    expect(health.headers.get('x-request-id')).toBeTruthy();
    expect(health.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('does not persist sync data for unauthorized callers', async () => {
    const before = await env.DB.prepare('SELECT COUNT(*) AS count FROM user_docs').first<{ count: number }>();
    const response = await app.request(
      '/api/sync',
      {
        method: 'POST',
        headers: { ...headers, authorization: 'Bearer rejected-token' },
        body: JSON.stringify({ state: emptyState() }),
      },
      env,
    );
    expect(response.status).toBe(401);
    const after = await env.DB.prepare('SELECT COUNT(*) AS count FROM user_docs').first<{ count: number }>();
    expect(after?.count).toBe(before?.count ?? 0);
  });
});
