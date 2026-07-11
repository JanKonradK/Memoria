import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppState, HoyoSend } from '@technogg/shared';
import {
  emptyState,
  evaluateAlerts,
  inQuietHours,
  isAllowedHoyoUrl,
  mergeState,
  normalizeState,
  refreshNotes,
} from '@technogg/shared';
import { dispatchAlerts } from './notify';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Set with: npx wrangler secret put SYNC_TOKEN */
  SYNC_TOKEN: string;
}

const ALERTS_RETENTION_MS = 60 * 86_400_000;

async function loadDoc(db: D1Database): Promise<AppState> {
  const row = await db.prepare('SELECT json FROM doc WHERE id = 1').first<{ json: string }>();
  if (!row) return emptyState();
  try {
    return normalizeState(JSON.parse(row.json));
  } catch {
    return emptyState();
  }
}

async function saveDoc(db: D1Database, state: AppState): Promise<void> {
  await db
    .prepare(
      'INSERT INTO doc (id, json, updated_at) VALUES (1, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at',
    )
    .bind(JSON.stringify(state), Date.now())
    .run();
}

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors({ origin: '*', allowHeaders: ['authorization', 'content-type'] }));

app.use('/api/*', async (c, next) => {
  const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!c.env.SYNC_TOKEN || token !== c.env.SYNC_TOKEN) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});

app.get('/api/state', async (c) => {
  return c.json({ state: await loadDoc(c.env.DB) });
});

app.post('/api/sync', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { state?: unknown };
  const client = normalizeState(body.state);
  const server = await loadDoc(c.env.DB);
  const merged = mergeState(server, client);
  await saveDoc(c.env.DB, merged);
  return c.json({ state: merged });
});

// CORS-free relay to HoYoLAB for the browser app (host-allowlisted, token-authed).
app.post('/api/hoyolab', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { url?: string; headers?: Record<string, string> };
  if (!body.url || !isAllowedHoyoUrl(body.url)) return c.json({ error: 'url not allowed' }, 400);
  try {
    const res = await fetch(body.url, { headers: body.headers });
    return c.body(await res.text(), 200, { 'content-type': 'application/json' });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'fetch failed' }, 502);
  }
});

app.post('/api/test-alert', async (c) => {
  const state = await loadDoc(c.env.DB);
  const sent = await dispatchAlerts(state.settings, [
    {
      dedupeKey: 'test',
      gameId: null,
      type: 'reminder',
      title: '✅ TechnoGG test ping',
      body: 'Alerts are wired up. May your pulls be golden.',
      color: '#8b5cf6',
    },
  ]);
  return c.json({ sent });
});

// Everything else falls through to the built PWA (SPA fallback via assets config).
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

const hoyoSend: HoyoSend = async (req) => {
  const res = await fetch(req.url, { headers: req.headers });
  return res.json();
};

export async function runAlertCron(env: Env, now = Date.now()): Promise<{ pending: number; delivered: number }> {
  let state = await loadDoc(env.DB);

  // Auto-import fresh HoYoLAB notes first so alerts judge live values, not the
  // last manual entry. Errors are logged and never block alert delivery.
  const refreshed = await refreshNotes(state, now, hoyoSend).catch((e) => {
    console.warn('hoyolab refresh failed', e);
    return { state, errors: [] as string[] };
  });
  if (refreshed.errors.length > 0) console.warn('hoyolab refresh errors', refreshed.errors);
  if (refreshed.state !== state) {
    state = refreshed.state;
    await saveDoc(env.DB, state);
  }

  const pending = evaluateAlerts(state, now);
  if (pending.length === 0) return { pending: 0, delivered: 0 };

  // During quiet hours nothing is sent OR recorded, so alerts naturally
  // catch up on the first cron tick after the window ends.
  if (inQuietHours(state.settings, now)) return { pending: pending.length, delivered: 0 };

  const keys = pending.map((p) => p.dedupeKey);
  const placeholders = keys.map(() => '?').join(',');
  const rows = await env.DB.prepare(`SELECT dedupe_key FROM alerts_sent WHERE dedupe_key IN (${placeholders})`)
    .bind(...keys)
    .all<{ dedupe_key: string }>();
  const already = new Set(rows.results.map((r) => r.dedupe_key));
  const fresh = pending.filter((p) => !already.has(p.dedupeKey));
  if (fresh.length === 0) return { pending: pending.length, delivered: 0 };

  const channels = await dispatchAlerts(state.settings, fresh);
  if (channels.length > 0) {
    const stmt = env.DB.prepare('INSERT OR IGNORE INTO alerts_sent (dedupe_key, sent_at) VALUES (?, ?)');
    await env.DB.batch(fresh.map((f) => stmt.bind(f.dedupeKey, now)));
    await env.DB.prepare('DELETE FROM alerts_sent WHERE sent_at < ?').bind(now - ALERTS_RETENTION_MS).run();
  }
  return { pending: pending.length, delivered: channels.length > 0 ? fresh.length : 0 };
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runAlertCron(env));
  },
};
