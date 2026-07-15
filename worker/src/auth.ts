import { createClerkClient } from '@clerk/backend';
import type { MiddlewareHandler } from 'hono';
import type { Bindings } from './env';

export interface Variables {
  userId: string;
  requestId: string;
}

export const authenticate: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  const requestId = c.get('requestId');

  if (c.env.APP_ENV === 'local' && !c.env.CLERK_SECRET_KEY) {
    const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (c.env.SYNC_TOKEN && token === c.env.SYNC_TOKEN) {
      c.set('userId', 'local-user');
      await next();
      return;
    }
    return c.json({ error: 'unauthorized', requestId }, 401);
  }

  if (!c.env.CLERK_SECRET_KEY || !c.env.CLERK_PUBLISHABLE_KEY) {
    return c.json({ error: 'authentication_not_configured', requestId }, 503);
  }

  const client = createClerkClient({
    secretKey: c.env.CLERK_SECRET_KEY,
    publishableKey: c.env.CLERK_PUBLISHABLE_KEY,
    jwtKey: c.env.CLERK_JWT_KEY,
  });
  const state = await client.authenticateRequest(c.req.raw, {
    authorizedParties: c.env.ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    jwtKey: c.env.CLERK_JWT_KEY,
  });
  const auth = state.toAuth();
  if (!state.isAuthenticated || !auth?.userId) return c.json({ error: 'unauthorized', requestId }, 401);
  c.set('userId', auth.userId);
  await next();
};
