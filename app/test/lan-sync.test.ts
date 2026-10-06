import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { emptyState, encodePairingCode, type Game } from '@memoria/shared';
const native = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true }, CapacitorHttp: native }));
vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn(async () => []) }));
import {
  disconnectLanSync,
  normalizeLanHost,
  pairLanDevice,
  pairLanFromQr,
  syncLanNow,
  useLanSync,
} from '../src/lan-sync';
import { useApp } from '../src/store';

const token = 'a'.repeat(43);
const game = (id: string, updatedAt = 1): Game => ({
  id,
  name: id,
  short: id,
  color: '#ffffff',
  icon: '',
  platform: 'pc',
  tz: 'UTC',
  dailyResetHour: 4,
  weeklyResetDay: 1,
  monthlyResetDay: 1,
  paused: false,
  sort: 0,
  updatedAt,
});
const reply = (data: unknown) => ({ status: 200, data });
async function pair() {
  native.post
    .mockResolvedValueOnce(reply({ token, deviceId: 'phone' }))
    .mockResolvedValueOnce(reply({ state: emptyState() }));
  await pairLanDevice('192.168.1.20:17820', '12345678');
}
beforeEach(async () => {
  vi.useFakeTimers();
  native.post.mockResolvedValue(reply({ ok: true }));
  await disconnectLanSync();
  native.post.mockReset();
  useApp.setState({ state: emptyState() });
});
afterEach(async () => {
  native.post.mockResolvedValue(reply({ ok: true }));
  await disconnectLanSync();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('native LAN sync', () => {
  it('retires the previous credential at the new address when the PC changes networks', async () => {
    await pair();
    const nextToken = 'b'.repeat(43);
    native.post.mockClear();
    native.post.mockImplementation(async (options: { url: string }) => {
      if (options.url.endsWith('/pair')) return reply({ token: nextToken, deviceId: 'new-phone' });
      if (options.url === 'http://192.168.1.20:17820/disconnect') throw new Error('old network unavailable');
      return options.url.endsWith('/sync') ? reply({ state: emptyState() }) : reply({ ok: true });
    });
    await pairLanFromQr(encodePairingCode(['192.168.2.20'], '12345678'));
    expect(native.post).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://192.168.2.20:17820/disconnect',
        headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
      }),
    );
    expect(useLanSync.getState().host).toBe('http://192.168.2.20:17820');
    expect(useLanSync.getState().status).toBe('ok');
  });

  it('tries the next PC address from a QR code when the first network is unreachable', async () => {
    native.post
      .mockRejectedValueOnce(new Error('no route'))
      .mockResolvedValueOnce(reply({ token, deviceId: 'phone' }))
      .mockResolvedValueOnce(reply({ state: emptyState() }));
    await pairLanFromQr(encodePairingCode(['10.0.0.1', '192.168.1.20'], '12345678'));
    expect(useLanSync.getState().status).toBe('ok');
    expect(useLanSync.getState().host).toBe('http://192.168.1.20:17820');
    expect(native.post.mock.calls.map(([options]) => options.url)).toEqual([
      'http://10.0.0.1:17820/pair',
      'http://192.168.1.20:17820/pair',
      'http://192.168.1.20:17820/sync',
    ]);
  });
  it('does not send requests for unrelated QR codes and keeps an existing connection after a failed replacement', async () => {
    await pair();
    native.post.mockClear();
    await expect(pairLanFromQr('https://example.com')).rejects.toThrow('not a Memoria');
    expect(native.post).not.toHaveBeenCalled();
    native.post.mockRejectedValueOnce(new Error('offline'));
    await expect(pairLanFromQr(encodePairingCode(['192.168.2.20'], '12345678'))).rejects.toThrow('Cannot reach');
    expect(useLanSync.getState().host).toBe('http://192.168.1.20:17820');
    native.post.mockResolvedValueOnce(reply({ state: emptyState() }));
    await syncLanNow();
    expect(useLanSync.getState().status).toBe('ok');
  });
  it('accepts only private literal addresses without credentials, query strings or paths', () => {
    expect(normalizeLanHost('192.168.1.20')).toBe('http://192.168.1.20:17820');
    for (const value of [
      'https://example.com',
      'http://127.0.0.1',
      'http://10.0.0.1/sync',
      'http://a:b@10.0.0.1',
      'http://10.0.0.1?secret=x',
    ])
      expect(() => normalizeLanHost(value)).toThrow();
  });
  it('waits for an active request and sends edits made during it in a follow-up', async () => {
    await pair();
    let finish!: (value: unknown) => void;
    native.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const sync = syncLanNow();
    useApp.setState({ state: { ...emptyState(), games: [game('local', 100)] } });
    const completed = vi.fn();
    const concurrent = syncLanNow().then(completed);
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    finish(reply({ state: { ...emptyState(), games: [game('remote', 50)] } }));
    await Promise.all([sync, concurrent]);
    expect(completed).toHaveBeenCalledOnce();
    expect(
      useApp
        .getState()
        .state.games.map((g) => g.id)
        .sort(),
    ).toEqual(['local', 'remote']);
    native.post.mockResolvedValueOnce(reply({ state: useApp.getState().state }));
    await vi.advanceTimersByTimeAsync(300);
    expect(native.post.mock.lastCall?.[0].data.state.games).toHaveLength(2);
    expect(native.post.mock.lastCall?.[0].disableRedirects).toBe(true);
  });
  it('does not promote an impossible remote snapshot over a current phone reading', async () => {
    await pair();
    const reading = { id: 'phone-reading', resourceId: 'energy', value: 20, takenAt: Date.now() - 60_000 };
    useApp.setState({ state: { ...emptyState(), snapshots: [reading] } });
    native.post.mockResolvedValueOnce(
      reply({
        state: {
          ...emptyState(),
          games: [game('pc')],
          snapshots: [{ id: 'future-reading', resourceId: 'energy', value: 100, takenAt: Date.now() + 86_400_000 }],
        },
      }),
    );

    await syncLanNow();

    expect(useApp.getState().state.snapshots).toEqual([reading]);
    expect(useApp.getState().state.games.map((item) => item.id)).toEqual(['pc']);
    expect(useLanSync.getState().status).toBe('ok');
  });
  it('ignores late responses after disconnect', async () => {
    await pair();
    let finish!: (value: unknown) => void;
    native.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const sync = syncLanNow();
    await disconnectLanSync();
    finish(reply({ state: { ...emptyState(), games: [game('late')] } }));
    await sync;
    expect(useApp.getState().state.games).toHaveLength(0);
    expect(useLanSync.getState().status).toBe('off');
  });
  it('keeps data while offline and reconnects without pairing again', async () => {
    await pair();
    useApp.setState({ state: { ...emptyState(), games: [game('offline')] } });
    native.post.mockRejectedValueOnce(new Error('network offline'));
    await syncLanNow();
    expect(useLanSync.getState().status).toBe('offline');
    expect(useApp.getState().state.games).toHaveLength(1);
    native.post.mockResolvedValueOnce(reply({ state: emptyState() }));
    await syncLanNow();
    expect(useLanSync.getState().status).toBe('ok');
    expect(useApp.getState().state.games).toHaveLength(1);
  });
});
