import { afterEach, describe, expect, it, vi } from 'vitest';
import { launcherFetch } from '../src/launcher';

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('launcher authorization', () => {
  it('uses an explicit header and prevents cookies or redirects from leaking it', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:17817' } });
    const token = 't'.repeat(43);
    sessionStorage.setItem('memoria-launcher-token', token);
    const fetchMock = vi.fn(async () => new Response());
    vi.stubGlobal('fetch', fetchMock);
    await launcherFetch('/api/state');
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/state');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${token}`);
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' });
    expect(() => launcherFetch('https://attacker.invalid/api/state')).toThrow(/Invalid launcher/);
    expect(() => launcherFetch('//attacker.invalid')).toThrow(/Invalid launcher/);
  });

  it('requires a shortcut launch before sending a request', () => {
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:17817' } });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(() => launcherFetch('/api/state')).toThrow(/desktop shortcut/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
