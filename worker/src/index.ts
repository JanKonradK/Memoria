import { createClerkClient } from '@clerk/backend';
import { Hono } from 'hono';
import { timeout } from 'hono/timeout';
import { CURRENT_SCHEMA_VERSION, normalizeState, safeParseAppState } from '@void/shared';
import { sendTestAlert, sweepAlerts } from './alerts';
import { authenticate, type Variables } from './auth';
import {
  deleteUserData,
  DocumentTooLargeError,
  InvalidDocumentStateError,
  loadUserDocument,
  MAX_DOCUMENT_BYTES,
  mergeUserDocument,
  pruneOperationalData,
  replaceUserDocument,
  shouldRunOperationalRetention,
} from './db';
import type { Bindings } from './env';
import { integrationRoutes } from './integrations';
import { rateLimit, requireJson, securityHeaders, strictCors, structuredLog } from './middleware';
import { listIntegrationStatuses } from './secrets';

type AppEnv = { Bindings: Bindings; Variables: Variables };
const CLIENT_ERROR_PATH = '/api/client-error';

const app = new Hono<AppEnv>();
app.use('*', securityHeaders);
app.use('/api/*', structuredLog);
app.use('*', timeout(15_000));
// Keep retired operational endpoints indistinguishable from any other missing route.
app.use('/api/admin/*', async (c) => c.json({ error: 'not_found' }, 404));
app.use('/api/*', strictCors);
app.use('/api/*', requireJson(MAX_DOCUMENT_BYTES));

app.get('/api/health', (c) => c.json({ ok: true, service: 'void', environment: c.env.APP_ENV, time: Date.now() }));
app.get('/api/ready', async (c) => {
  await c.env.DB.prepare('SELECT 1').first();
  return c.json({ ok: true });
});

app.use('/api/*', authenticate);
const standardRateLimit = rateLimit(120);
app.use('/api/*', async (c, next) => {
  if (c.req.path === CLIENT_ERROR_PATH) {
    await next();
    return;
  }
  await standardRateLimit(c, next);
});
app.use(CLIENT_ERROR_PATH, rateLimit(10));

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
  const rawSchemaVersion =
    body.state && typeof body.state === 'object'
      ? (body.state as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (typeof rawSchemaVersion === 'number' && rawSchemaVersion > CURRENT_SCHEMA_VERSION) {
    return c.json({ error: 'client_outdated' }, 409);
  }
  const stateForValidation =
    body.state && typeof body.state === 'object' && Array.isArray((body.state as { games?: unknown }).games)
      ? { ...body.state, games: normalizeState(body.state).games }
      : body.state;
  const parsed = safeParseAppState(stateForValidation);
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
    if (error instanceof InvalidDocumentStateError) {
      return c.json({ error: 'invalid_state', detail: error.detail }, 422);
    }
    if (error instanceof DocumentTooLargeError) {
      return c.json({ error: 'document_quota_exceeded', bytes: error.bytes }, 413);
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
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const result = await sweepAlerts(env, { now: event.scheduledTime });
        if (shouldRunOperationalRetention(event.scheduledTime)) {
          await pruneOperationalData(env.DB, event.scheduledTime);
        }
        console.log(JSON.stringify({ type: 'metric', name: 'cron.sweep', ...result }));
      })(),
    );
  },
};

export { app, replaceUserDocument };
