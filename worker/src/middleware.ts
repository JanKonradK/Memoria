import type { MiddlewareHandler } from 'hono';
import type { Variables } from './auth';
import type { Bindings } from './env';
import { hashUserId } from './redact';

type AppEnv = { Bindings: Bindings; Variables: Variables };

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestId = c.req.header('cf-ray') ?? crypto.randomUUID();
  c.set('requestId', requestId);
  await next();
  c.header('X-Request-ID', requestId);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk.technogg.app; " +
      "style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.clerk.accounts.dev " +
      'https://*.clerk.com https://*.clerk.services; frame-src https://*.clerk.accounts.dev https://*.clerk.com; ' +
      "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
  if (c.env.APP_ENV === 'production') {
    c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store');
  else if (/\/assets\/[^/]+-[a-zA-Z0-9_-]{6,}\.(?:js|css)$/.test(c.req.path)) {
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    c.header('Cache-Control', 'no-cache');
  }
};

export const strictCors: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header('origin');
  const allowed = new Set(
    c.env.ALLOWED_ORIGINS.split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
  if (origin && !allowed.has(origin)) return c.json({ error: 'origin_not_allowed' }, 403);
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Headers', 'authorization, content-type, if-match');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
};

export function requireJson(maxBytes = 1_000_000): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
      if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) {
        return c.json({ error: 'content_type_must_be_json' }, 415);
      }
      const size = Number(c.req.header('content-length') ?? 0);
      if (size > maxBytes) return c.json({ error: 'payload_too_large' }, 413);
    }
    await next();
  };
}

export function rateLimit(limit: number, windowMs = 60_000): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const identity = c.get('userId') || c.req.header('cf-connecting-ip') || 'unknown';
    const identityHash = await hashUserId(identity);
    const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
    const key = `${identityHash}:${c.req.path.split('/').slice(0, 3).join('/')}`;
    await c.env.DB.prepare(
      'INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ' +
        'ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1',
    )
      .bind(key, windowStart)
      .run();
    const row = await c.env.DB.prepare('SELECT count FROM rate_limits WHERE key = ? AND window_start = ?')
      .bind(key, windowStart)
      .first<{ count: number }>();
    if ((row?.count ?? 0) > limit) {
      c.header('Retry-After', String(Math.ceil(windowMs / 1000)));
      return c.json({ error: 'rate_limited' }, 429);
    }
    if (Math.random() < 0.01) {
      await c.env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?')
        .bind(windowStart - 2 * windowMs)
        .run();
    }
    await next();
  };
}

export const structuredLog: MiddlewareHandler<AppEnv> = async (c, next) => {
  const started = Date.now();
  await next();
  const userId = c.get('userId');
  const hashedUser = userId ? await hashUserId(userId) : null;
  console.log(
    JSON.stringify({
      type: 'request',
      requestId: c.get('requestId') ?? c.req.header('cf-ray') ?? null,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - started,
      user: hashedUser,
      env: c.env.APP_ENV,
    }),
  );
};
