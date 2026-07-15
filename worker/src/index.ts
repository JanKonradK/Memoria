import { createClerkClient } from '@clerk/backend';
import { Hono } from 'hono';
import { timeout } from 'hono/timeout';
import { safeParseAppState } from '@technogg/shared';
import { processUserAlerts, sendTestAlert } from './alerts';
import { authenticate, type Variables } from './auth';
import { deleteUserData, listActiveUserIds, loadUserDocument, mergeUserDocument, replaceUserDocument } from './db';
import type { AlertJob, Bindings } from './env';
import { integrationRoutes } from './integrations';
import { rateLimit, requireJson, securityHeaders, strictCors, structuredLog } from './middleware';
import { listIntegrationStatuses, rotateSecretBatch } from './secrets';
import { hashUserId } from './redact';

type AppEnv = { Bindings: Bindings; Variables: Variables };
const MAX_DOCUMENT_BYTES = 1_000_000;

const app = new Hono<AppEnv>();
app.use('*', securityHeaders);
app.use('*', timeout(15_000));
app.use('/api/*', strictCors);
app.use('/api/*', requireJson(MAX_DOCUMENT_BYTES));

app.get('/api/health', (c) => c.json({ ok: true, service: 'technogg', environment: c.env.APP_ENV, time: Date.now() }));
app.get('/api/ready', async (c) => {
  await c.env.DB.prepare('SELECT 1').first();
  return c.json({ ok: true });
});

app.post('/api/admin/migrate-legacy', async (c) => {
  const key = c.req.header('x-admin-migration-key');
  if (!c.env.ADMIN_MIGRATION_KEY || key !== c.env.ADMIN_MIGRATION_KEY) return c.json({ error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => null)) as { userId?: string; apply?: boolean } | null;
  if (!body?.userId) return c.json({ error: 'userId_required' }, 400);
  const row = await c.env.DB.prepare('SELECT json FROM doc WHERE id = 1').first<{ json: string }>();
  if (!row) return c.json({ error: 'legacy_document_not_found' }, 404);
  const parsed = safeParseAppState(JSON.parse(row.json));
  if (!parsed.success) return c.json({ error: 'legacy_document_invalid', detail: parsed.error }, 422);
  if (!body.apply) {
    return c.json({
      preview: {
        games: parsed.data.games.filter((game) => !game.deleted).length,
        events: parsed.data.events.filter((event) => !event.deleted).length,
      },
    });
  }
  const result = await mergeUserDocument(c.env.DB, body.userId, parsed.data);
  return c.json({ migrated: true, version: result.version });
});

app.post('/api/admin/rotate-secrets', async (c) => {
  const key = c.req.header('x-admin-migration-key');
  if (!c.env.ADMIN_MIGRATION_KEY || key !== c.env.ADMIN_MIGRATION_KEY) return c.json({ error: 'not_found' }, 404);
  if (!c.env.PREVIOUS_MASTER_KEY) return c.json({ error: 'previous_key_not_configured' }, 409);
  const rotated = await rotateSecretBatch(
    c.env.DB,
    c.env.MASTER_KEY,
    c.env.PREVIOUS_MASTER_KEY,
    Number(c.env.MASTER_KEY_VERSION),
  );
  return c.json({ rotated, complete: rotated === 0 });
});

app.use('/api/*', authenticate);
app.use('/api/*', rateLimit(120));
app.use('/api/*', structuredLog);

app.get('/api/state', async (c) => {
  const document = await loadUserDocument(c.env.DB, c.get('userId'));
  return c.json(document);
});

app.post('/api/sync', async (c) => {
  const text = await c.req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES) {
    return c.json({ error: 'payload_too_large' }, 413);
  }
  let body: { state?: unknown; version?: unknown };
  try {
    body = JSON.parse(text) as { state?: unknown; version?: unknown };
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = safeParseAppState(body.state);
  if (!parsed.success) return c.json({ error: 'invalid_state', detail: parsed.error }, 422);
  try {
    const result = await mergeUserDocument(c.env.DB, c.get('userId'), parsed.data);
    console.log(
      JSON.stringify({
        type: 'metric',
        name: 'sync',
        bytes: new TextEncoder().encode(text).byteLength,
        version: result.version,
      }),
    );
    return c.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'sync_conflict') {
      return c.json({ error: 'sync_conflict_retry' }, 409);
    }
    if (error instanceof Error && error.message === 'document_quota_exceeded') {
      return c.json({ error: 'document_quota_exceeded' }, 413);
    }
    throw error;
  }
});

app.get('/api/export', async (c) => {
  const [document, integrations] = await Promise.all([
    loadUserDocument(c.env.DB, c.get('userId')),
    listIntegrationStatuses(c.env.DB, c.get('userId')),
  ]);
  return c.json({
    exportedAt: new Date().toISOString(),
    schemaVersion: document.state.schemaVersion,
    state: document.state,
    integrations,
    secretsIncluded: false,
  });
});

app.delete('/api/account', async (c) => {
  const userId = c.get('userId');
  await deleteUserData(c.env.DB, userId);
  if (c.env.CLERK_SECRET_KEY && c.env.APP_ENV !== 'local') {
    const clerk = createClerkClient({ secretKey: c.env.CLERK_SECRET_KEY });
    await clerk.users.deleteUser(userId);
  }
  return c.json({ deleted: true });
});

app.post('/api/test-alert', async (c) => {
  const sent = await sendTestAlert(c.env, c.get('userId'));
  return c.json({ sent });
});

app.post('/api/client-error', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { message?: unknown; stack?: unknown; build?: unknown } | null;
  const message = typeof body?.message === 'string' ? body.message.slice(0, 2_000) : '';
  const stack = typeof body?.stack === 'string' ? body.stack.slice(0, 12_000) : '';
  const build = typeof body?.build === 'string' ? body.build.slice(0, 100) : '';
  if (!message) return c.json({ error: 'message_required' }, 400);
  await c.env.DB.prepare(
    'INSERT INTO client_errors (user_id, message, stack, build, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(c.get('userId'), message, stack, build, Date.now())
    .run();
  return c.json({ accepted: true }, 202);
});

app.route('/api', integrationRoutes);

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((error, c) => {
  const requestId = c.get('requestId') ?? c.req.header('cf-ray') ?? crypto.randomUUID();
  console.error(JSON.stringify({ type: 'request.error', requestId, message: error.message, path: c.req.path }));
  return c.json({ error: 'internal_error', requestId }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        let after = '';
        let enqueued = 0;
        for (let page = 0; page < 100; page++) {
          const userIds = await listActiveUserIds(env.DB, after, 100);
          if (userIds.length === 0) break;
          await env.ALERT_QUEUE.sendBatch(
            userIds.map((userId) => ({ body: { userId, requestedAt: Date.now() } satisfies AlertJob })),
          );
          enqueued += userIds.length;
          after = userIds[userIds.length - 1]!;
          if (userIds.length < 100) break;
        }
        console.log(JSON.stringify({ type: 'metric', name: 'cron.scan', enqueued }));
      })(),
    );
  },
  async queue(batch: MessageBatch<AlertJob>, env: Bindings): Promise<void> {
    for (const message of batch.messages) {
      try {
        const result = await processUserAlerts(env, message.body.userId);
        console.log(
          JSON.stringify({
            type: 'metric',
            name: 'alert.job',
            queueLagMs: Date.now() - message.body.requestedAt,
            pending: result.pending,
            delivered: result.delivered,
          }),
        );
        message.ack();
      } catch (error) {
        console.error(
          JSON.stringify({
            type: 'alert.job.error',
            user: await hashUserId(message.body.userId),
            attempt: message.attempts,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        message.retry({ delaySeconds: Math.min(3600, 30 * 2 ** Math.max(0, message.attempts - 1)) });
      }
    }
  },
};

export { app, replaceUserDocument };
