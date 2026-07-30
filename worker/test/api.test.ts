import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { CURRENT_SCHEMA_VERSION, emptyState, MAX_GAME_IMAGE_LENGTH, type Game } from '@void/shared';
import { app, replaceUserDocument } from '../src/index';

const headers = {
  authorization: 'Bearer test-token',
  'content-type': 'application/json',
  origin: 'http://localhost:5173',
};

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: 'game',
    name: 'Game',
    short: 'G',
    color: '#8b5cf6',
    icon: '',
    platform: 'both',
    tz: 'Etc/UTC',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    paused: false,
    sort: 0,
    updatedAt: 1,
    ...overrides,
  };
}

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
      telegramChatId: '123456789',
    };
    const response = await app.request('/api/sync', { method: 'POST', headers, body: JSON.stringify({ state }) }, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { state: { settings: Record<string, unknown> }; version: number };
    expect(body.version).toBeGreaterThan(0);
    expect(body.state.settings).not.toHaveProperty('discordWebhook');
    expect(body.state.settings).not.toHaveProperty('telegramToken');
    expect(body.state.settings).not.toHaveProperty('telegramChatId');
  });

  it('rejects malformed documents', async () => {
    const response = await app.request(
      '/api/sync',
      { method: 'POST', headers, body: JSON.stringify({ state: { games: 'not-an-array' } }) },
      env,
    );
    expect(response.status).toBe(422);
  });

  it('returns client_outdated before validating a newer raw schema', async () => {
    const response = await app.request(
      '/api/sync',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ state: { schemaVersion: CURRENT_SCHEMA_VERSION + 1, games: 'future-shape' } }),
      },
      env,
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'client_outdated' });
  });

  it('self-heals oversized images before validating an older client document', async () => {
    const state = emptyState();
    state.games = [game({ image: 'x'.repeat(MAX_GAME_IMAGE_LENGTH + 1) })];

    const response = await app.request('/api/sync', { method: 'POST', headers, body: JSON.stringify({ state }) }, env);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { state: { games: Game[] } };
    expect(body.state.games[0]).not.toHaveProperty('image');
  });

  it('heals a corrupt stored document instead of refusing the sync, and still enforces the byte quota', async () => {
    // This asserted a 422 for a schema-invalid stored row. `normalizeState` now
    // salvages per record — clamping what it can, dropping only the row it
    // cannot — and `mergeState` normalizes both sides before merging, so a
    // single bad row can no longer poison the whole document. The sync succeeds
    // and the bad row is simply gone, which is the better outcome: a user whose
    // stored document got corrupted can still sync instead of being locked out
    // by a 422 they have no way to fix.
    //
    // The `invalid_state` branch stays in the handler as defence in depth for
    // anything a future schema change makes unsalvageable. The byte quota below
    // is a size check rather than a schema check, so it remains reachable and is
    // the half of this test that still exercises a rejection.
    const invalid = emptyState();
    invalid.games = [
      {
        id: 'invalid-game',
        name: 'x'.repeat(501),
        short: 'IG',
        color: '#000000',
        icon: '',
        platform: 'both',
        tz: 'Etc/UTC',
        dailyResetHour: 4,
        weeklyResetDay: 1,
        monthlyResetDay: 1,
        paused: false,
        sort: 0,
        updatedAt: 1,
      },
    ];
    await replaceUserDocument(env.DB, 'local-user', invalid);

    const invalidResponse = await app.request(
      '/api/sync',
      { method: 'POST', headers, body: JSON.stringify({ state: emptyState() }) },
      env,
    );
    expect(invalidResponse.status).toBe(200);
    const healed = (await invalidResponse.json()) as { state: { games: Game[] } };
    // The unsalvageable row is dropped rather than taking the document with it.
    expect(healed.state.games.some((game) => game.id === 'invalid-game')).toBe(false);

    const current = emptyState();
    current.reminders = Array.from({ length: 30 }, (_, index) => ({
      id: `current-${index}`,
      gameId: null,
      message: 'c'.repeat(20_000),
      at: index,
      updatedAt: 1,
    }));
    const incoming = emptyState();
    incoming.reminders = Array.from({ length: 30 }, (_, index) => ({
      id: `incoming-${index}`,
      gameId: null,
      message: 'i'.repeat(20_000),
      at: index,
      updatedAt: 1,
    }));
    await replaceUserDocument(env.DB, 'local-user', current);

    const quotaResponse = await app.request(
      '/api/sync',
      { method: 'POST', headers, body: JSON.stringify({ state: incoming }) },
      env,
    );
    expect(quotaResponse.status).toBe(413);
    const quotaBody = (await quotaResponse.json()) as { error: string; bytes: number };
    expect(quotaBody).toMatchObject({ error: 'document_quota_exceeded', bytes: expect.any(Number) });
    expect(quotaBody.bytes).toBeGreaterThan(1_000_000);

    await replaceUserDocument(env.DB, 'local-user', emptyState());
  });

  it('applies security headers on public endpoints', async () => {
    const health = await app.request('/api/health', {}, env);
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect(health.headers.get('x-frame-options')).toBe('DENY');
    expect(health.headers.get('x-request-id')).toBeTruthy();
    expect(health.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(health.headers.get('content-security-policy')).toContain(env.CLERK_FRONTEND_API);
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

  it('logs authentication and CORS failures while retaining the authenticated user on success', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect((await app.request('/api/state', {}, env)).status).toBe(401);
      expect(
        (
          await app.request(
            '/api/state',
            { headers: { authorization: 'Bearer test-token', origin: 'https://evil.example' } },
            env,
          )
        ).status,
      ).toBe(403);
      expect((await app.request('/api/state', { headers }, env)).status).toBe(200);

      const requestLogs = log.mock.calls
        .map(([entry]) => {
          try {
            return JSON.parse(String(entry)) as { type?: string; path?: string; status?: number; user?: string | null };
          } catch {
            return null;
          }
        })
        .filter((entry) => entry?.type === 'request' && entry.path === '/api/state');
      expect(requestLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 401, user: null }),
          expect.objectContaining({ status: 403, user: null }),
          expect.objectContaining({ status: 200, user: expect.stringMatching(/^[a-f0-9]{16}$/) }),
        ]),
      );
    } finally {
      log.mockRestore();
    }
  });

  it('applies the tighter client-error rate limit without double-counting the global limiter', async () => {
    const responses = [];
    for (let index = 0; index < 11; index++) {
      responses.push(
        await app.request(
          '/api/client-error',
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ message: `error-${index}`, stack: '', build: 'test' }),
          },
          env,
        ),
      );
    }

    expect(responses.slice(0, 10).every((response) => response.status === 202)).toBe(true);
    expect(responses[10]!.status).toBe(429);
    const row = await env.DB.prepare(
      "SELECT SUM(count) AS count FROM rate_limits WHERE key LIKE '%:/api/client-error'",
    ).first<{ count: number }>();
    expect(row?.count).toBe(11);
  });
});
