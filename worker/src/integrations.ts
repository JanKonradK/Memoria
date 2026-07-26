import { Hono } from 'hono';
import type { IntegrationKind } from '@void/shared';
import type { Variables } from './auth';
import type { Bindings } from './env';
import { deleteSecret, listIntegrationStatuses, putSecret } from './secrets';

type AppEnv = { Bindings: Bindings; Variables: Variables };

function mask(kind: IntegrationKind, value: Record<string, string>): string {
  if (kind === 'discord') {
    const id = /\/webhooks\/(\d+)/.exec(value.webhook ?? '')?.[1];
    return id ? `Webhook …${id.slice(-4)}` : 'Discord webhook';
  }
  return value.chatId ? `Chat …${value.chatId.slice(-4)}` : 'Telegram';
}

function validateSecret(kind: IntegrationKind, value: Record<string, string>): string | null {
  if (kind === 'discord') {
    try {
      const url = new URL(value.webhook ?? '');
      if (!['discord.com', 'discordapp.com'].includes(url.hostname) || !url.pathname.startsWith('/api/webhooks/')) {
        return 'invalid_discord_webhook';
      }
    } catch {
      return 'invalid_discord_webhook';
    }
  }
  if (kind === 'telegram') {
    if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(value.token ?? '')) return 'invalid_telegram_token';
    if (!/^-?\d{4,}$/.test(value.chatId ?? '')) return 'invalid_telegram_chat';
  }
  return null;
}

export const integrationRoutes = new Hono<AppEnv>();

integrationRoutes.get('/integrations', async (c) => {
  return c.json({ integrations: await listIntegrationStatuses(c.env.DB, c.get('userId')) });
});

integrationRoutes.put('/integrations/:kind', async (c) => {
  const kind = c.req.param('kind') as IntegrationKind;
  if (!(['discord', 'telegram'] as const).includes(kind)) return c.json({ error: 'invalid_kind' }, 400);
  const body = (await c.req.json().catch(() => null)) as { value?: Record<string, string>; consent?: boolean } | null;
  if (!body?.consent || !body.value) return c.json({ error: 'explicit_consent_required' }, 400);
  const validationError = validateSecret(kind, body.value);
  if (validationError) return c.json({ error: validationError }, 400);
  await putSecret(
    c.env.DB,
    c.env.MASTER_KEY,
    c.get('userId'),
    kind,
    body.value,
    mask(kind, body.value),
    Date.now(),
    Number(c.env.MASTER_KEY_VERSION),
  );
  return c.json({ ok: true });
});

integrationRoutes.delete('/integrations/:kind', async (c) => {
  const kind = c.req.param('kind') as IntegrationKind;
  if (!(['discord', 'telegram'] as const).includes(kind)) return c.json({ error: 'invalid_kind' }, 400);
  await deleteSecret(c.env.DB, c.get('userId'), kind);
  return c.json({ ok: true });
});
