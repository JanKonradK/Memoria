import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/auth-session', () => ({
  authHeaders: vi.fn(async () => ({ authorization: 'Bearer test-token' })),
  isHostedSession: vi.fn(() => true),
}));

import { reportClientError } from '../src/reporting';

describe('client error reporting circuit breaker', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('deduplicates messages and sends at most five reports per page load', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    await reportClientError(new Error('duplicate'), 'render');
    await reportClientError(new Error('duplicate'), 'render');
    for (let index = 0; index < 6; index++) {
      await reportClientError(new Error(`unique-${index}`), 'render');
    }

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(
      fetchMock.mock.calls
        .map(([, init]) => JSON.parse(String(init?.body)) as { message: string })
        .map(({ message }) => message),
    ).toEqual(['render: duplicate', 'render: unique-0', 'render: unique-1', 'render: unique-2', 'render: unique-3']);
  });
});
