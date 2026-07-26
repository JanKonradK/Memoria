import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../src/env';
import { rateLimit, requireJson } from '../src/middleware';

type AppEnv = { Bindings: Bindings; Variables: { userId?: string } };

/**
 * Mount the middleware on a throwaway app so the tests exercise the middleware
 * itself rather than the real route table (which layers auth, CORS and logging
 * on top and would mask which rule produced a given status).
 */
function appWith(middleware: ReturnType<typeof rateLimit> | ReturnType<typeof requireJson>, userId = 'limiter-user') {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    await next();
  });
  app.use('*', middleware);
  app.all('*', (c) => c.json({ ok: true }));
  return app;
}

function jsonRequest(path: string, extraHeaders: Record<string, string> = {}) {
  return new Request(`https://example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: '{}',
  });
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM rate_limits').run();
  vi.useRealTimers();
});

describe('rateLimit', () => {
  it('allows requests up to the limit and rejects the one past it with Retry-After', async () => {
    const app = appWith(rateLimit(3));

    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await app.fetch(jsonRequest('/api/sync'), env);
      expect(res.status, `request ${attempt} should be allowed`).toBe(200);
    }

    const blocked = await app.fetch(jsonRequest('/api/sync'), env);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'rate_limited' });
    expect(blocked.headers.get('Retry-After')).toBe('60');
  });

  it('buckets by the first two path segments, so sibling routes are independent', async () => {
    const app = appWith(rateLimit(1));

    expect((await app.fetch(jsonRequest('/api/sync'), env)).status).toBe(200);
    // Different second segment -> different bucket, so this must NOT be limited.
    expect((await app.fetch(jsonRequest('/api/state'), env)).status).toBe(200);
    // Same bucket as the first call -> limited.
    expect((await app.fetch(jsonRequest('/api/sync'), env)).status).toBe(429);
  });

  it('shares one bucket across deeper paths under the same prefix', async () => {
    // `/api/integrations/discord` and `/api/integrations/telegram` both collapse
    // to `/api/integrations`, which is deliberate — one tenant, one budget.
    const app = appWith(rateLimit(1));

    expect((await app.fetch(jsonRequest('/api/integrations/discord'), env)).status).toBe(200);
    expect((await app.fetch(jsonRequest('/api/integrations/telegram'), env)).status).toBe(429);
  });

  it('separates tenants — one user exhausting the budget does not block another', async () => {
    const alice = appWith(rateLimit(1), 'alice');
    const bob = appWith(rateLimit(1), 'bob');

    expect((await alice.fetch(jsonRequest('/api/sync'), env)).status).toBe(200);
    expect((await alice.fetch(jsonRequest('/api/sync'), env)).status).toBe(429);
    expect((await bob.fetch(jsonRequest('/api/sync'), env)).status).toBe(200);
  });

  it('resets when the window rolls over', async () => {
    const app = appWith(rateLimit(1, 60_000));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T10:00:00.000Z'));

    expect((await app.fetch(jsonRequest('/api/sync'), env)).status).toBe(200);
    expect((await app.fetch(jsonRequest('/api/sync'), env)).status).toBe(429);

    vi.setSystemTime(new Date('2026-07-26T10:01:00.000Z'));
    expect((await app.fetch(jsonRequest('/api/sync'), env)).status).toBe(200);
  });

  it('does not under-count concurrent requests', async () => {
    // The counter is a single INSERT ... ON CONFLICT ... RETURNING; the previous
    // read-after-write could let two in-flight requests both observe a count
    // below the limit and both be admitted.
    const app = appWith(rateLimit(5));

    const results = await Promise.all(
      Array.from({ length: 12 }, () => app.fetch(jsonRequest('/api/sync'), env).then((r) => r.status)),
    );

    expect(results.filter((status) => status === 200)).toHaveLength(5);
    expect(results.filter((status) => status === 429)).toHaveLength(7);
  });
});

describe('requireJson', () => {
  it('rejects a non-JSON content type on writes with 415', async () => {
    const app = appWith(requireJson(1_000));
    const res = await app.fetch(
      new Request('https://example.test/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'hello',
      }),
      env,
    );

    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'content_type_must_be_json' });
  });

  it('rejects an oversized declared body with 413', async () => {
    const app = appWith(requireJson(1_000));
    const res = await app.fetch(jsonRequest('/api/sync', { 'content-length': '5000' }), env);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
  });

  it('lets a well-formed write through', async () => {
    const app = appWith(requireJson(1_000));
    const res = await app.fetch(jsonRequest('/api/sync', { 'content-length': '2' }), env);
    expect(res.status).toBe(200);
  });

  it('ignores GET requests entirely', async () => {
    // Reads carry no body, so neither rule should apply to them.
    const app = appWith(requireJson(1_000));
    const res = await app.fetch(new Request('https://example.test/api/state'), env);
    expect(res.status).toBe(200);
  });
});
