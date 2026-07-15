import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from '@technogg/shared';
import { processUserAlerts } from '../src/alerts';
import { mergeUserDocument } from '../src/db';
import { putSecret } from '../src/secrets';

const masterKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

afterEach(() => vi.restoreAllMocks());

describe('queued alert processing', () => {
  it('deduplicates per user without leaking the ledger across tenants', async () => {
    const now = Date.now();
    const state = emptyState();
    state.settings = { ...state.settings, quietStart: null, quietEnd: null };
    state.reminders = [
      {
        id: 'same-reminder',
        gameId: null,
        message: 'Spend energy',
        at: now - 1,
        updatedAt: now,
      },
    ];
    for (const userId of ['alert-user-a', 'alert-user-b']) {
      await mergeUserDocument(env.DB, userId, state, now);
      await putSecret(
        env.DB,
        masterKey,
        userId,
        'discord',
        { webhook: 'https://discord.com/api/webhooks/123/test' },
        'Webhook …0123',
        now,
      );
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    expect(await processUserAlerts(env, 'alert-user-a', now)).toMatchObject({ delivered: 1 });
    expect(await processUserAlerts(env, 'alert-user-a', now)).toMatchObject({ delivered: 0 });
    expect(await processUserAlerts(env, 'alert-user-b', now)).toMatchObject({ delivered: 1 });
  });
});
