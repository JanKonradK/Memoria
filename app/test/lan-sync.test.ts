import {
  devicePublicKey,
  deviceFingerprint,
  lanKeys,
  sealLan,
  openLan,
  type LanPacket,
} from '@memoria/shared/lan-crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { emptyState, encodePairingCode, type Game } from '@memoria/shared';
const native = vi.hoisted(() => ({ post: vi.fn(), relayOffline: false }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  // A stand-in Keystore: sealed text that is plainly not the key.
  registerPlugin: () => ({
    seal: async ({ value }: { value: string }) => ({ sealed: btoa(`sealed:${value}`) }),
    unseal: async ({ sealed }: { sealed: string }) => ({ value: atob(sealed).replace(/^sealed:/, '') }),
  }),
  CapacitorHttp: {
    post: async (request: { url: string; data: LanPacket | { path: string; body: LanPacket } }) => {
      // Through the relay, the PC's answer comes back wrapped with its status.
      if (request.url.includes('/v1/rooms/')) {
        if (native.relayOffline)
          return { status: 200, data: { status: 503, body: { error: 'Your PC is not connected.' } } };
        const { path, body } = request.data as { path: string; body: LanPacket };
        const inner = await pcAnswer(`relay:${path}`, path, body, request);
        return { status: 200, data: { status: inner.status, body: inner.data } };
      }
      return pcAnswer(request.url, new URL(request.url).pathname, request.data as LanPacket, request);
    },
  },
}));
/** The PC: a challenge for /hello, and for anything else the reply native.post gives, sealed. */
async function pcAnswer(url: string, path: string, packet: LanPacket, request: object) {
  const pc = devicePublicKey('11'.repeat(32));
  if (path === '/hello') return { status: 200, data: { publicKey: pc, challenge: 'ab'.repeat(32) } };
  const keys = lanKeys('11'.repeat(32), packet.publicKey, pc, packet.publicKey);
  const data = openLan(keys.request, path, packet);
  const result = await native.post({ ...request, url, data });
  return {
    status: 200,
    data: sealLan(
      keys.response,
      path,
      pc,
      packet.challenge,
      result.status === 200 ? result.data : { error: result.data.error, status: result.status },
      packet.nonce,
    ),
  };
}
vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn(async () => []) }));
import {
  disconnectLanSync,
  resolveFirstSync,
  normalizeLanHost,
  pairLanDevice,
  pairLanFromQr,
  syncLanNow,
  useLanSync,
} from '../src/lan-sync';
import { useApp } from '../src/store';

const token = 'a'.repeat(43);
const fingerprint = deviceFingerprint(devicePublicKey('11'.repeat(32)));
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
  await pairLanDevice('192.168.1.20:17820', '12345678', fingerprint);
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
  it('rejects a substituted PC key before it sends the pairing code', async () => {
    await expect(pairLanDevice('192.168.1.20', '12345678', '00'.repeat(32))).rejects.toThrow('PC key does not match');
    expect(native.post).not.toHaveBeenCalled();
    expect(localStorage.getItem('memoria-wifi-device')).toBeNull();
  });
  it('retires the previous credential at the new address when the PC changes networks', async () => {
    await pair();
    const nextToken = 'b'.repeat(43);
    native.post.mockClear();
    native.post.mockImplementation(async (options: { url: string }) => {
      if (options.url.endsWith('/pair')) return reply({ token: nextToken, deviceId: 'new-phone' });
      if (options.url === 'http://192.168.1.20:17820/disconnect') throw new Error('old network unavailable');
      return options.url.endsWith('/sync') ? reply({ state: emptyState() }) : reply({ ok: true });
    });
    await pairLanFromQr(encodePairingCode(['192.168.2.20'], '12345678', fingerprint));
    expect(native.post).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://192.168.2.20:17820/disconnect',
        headers: { 'Content-Type': 'application/json' },
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
    await pairLanFromQr(encodePairingCode(['10.0.0.1', '192.168.1.20'], '12345678', fingerprint));
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
    await expect(pairLanFromQr(encodePairingCode(['192.168.2.20'], '12345678', fingerprint))).rejects.toThrow(
      'Cannot reach',
    );
    expect(useLanSync.getState().host).toBe('http://192.168.1.20:17820');
    native.post.mockResolvedValueOnce(reply({ state: emptyState() }));
    await syncLanNow();
    expect(useLanSync.getState().status).toBe('ok');
  });
  it('learns the PC addresses from a sync and switches to one that works, such as Tailscale', async () => {
    native.post
      .mockResolvedValueOnce(reply({ token, deviceId: 'phone' }))
      .mockResolvedValueOnce(
        reply({ state: emptyState(), addresses: ['http://192.168.1.20:17820', 'http://100.101.2.3:17820', 'x'] }),
      );
    await pairLanDevice('192.168.1.20:17820', '12345678', fingerprint);
    // The private key is stored sealed by the Keystore, never in the clear.
    await vi.waitFor(() =>
      expect(JSON.parse(localStorage.getItem('memoria-wifi-device')!).sealedSecret).toBeTypeOf('string'),
    );
    expect(JSON.parse(localStorage.getItem('memoria-wifi-device')!).secret).toBeUndefined();
    expect(JSON.parse(localStorage.getItem('memoria-wifi-device')!).hosts).toEqual([
      'http://192.168.1.20:17820',
      'http://100.101.2.3:17820',
    ]);
    native.post.mockClear();
    native.post
      .mockRejectedValueOnce(new Error('away from home'))
      .mockResolvedValueOnce(reply({ state: emptyState() }));
    await syncLanNow();
    expect(native.post.mock.calls.map(([options]) => options.url)).toEqual([
      'http://192.168.1.20:17820/sync',
      'http://100.101.2.3:17820/sync',
    ]);
    expect(useLanSync.getState().status).toBe('ok');
    expect(useLanSync.getState().host).toBe('http://100.101.2.3:17820');
    // The pairing is written once its key is sealed.
    await vi.waitFor(() =>
      expect(JSON.parse(localStorage.getItem('memoria-wifi-device')!).host).toBe('http://100.101.2.3:17820'),
    );
  });
  it('reaches the PC through the relay it reported when no address answers, and looks nearby first next time', async () => {
    native.post
      .mockResolvedValueOnce(reply({ token, deviceId: 'phone' }))
      .mockResolvedValueOnce(reply({ state: emptyState(), relay: 'https://relay.example.workers.dev/' }));
    await pairLanDevice('192.168.1.20:17820', '12345678', fingerprint);
    await vi.waitFor(() =>
      expect(JSON.parse(localStorage.getItem('memoria-wifi-device')!).relay).toBe('https://relay.example.workers.dev'),
    );
    native.post.mockClear();
    native.post
      .mockRejectedValueOnce(new Error('away from home'))
      .mockResolvedValueOnce(reply({ state: emptyState() }));
    await syncLanNow();
    expect(native.post.mock.calls.map(([options]) => options.url)).toEqual([
      'http://192.168.1.20:17820/sync',
      'relay:/sync',
    ]);
    expect(useLanSync.getState()).toMatchObject({ status: 'ok', route: 'relay' });
    native.post.mockClear();
    native.post.mockRejectedValueOnce(new Error('still away')).mockResolvedValueOnce(reply({ state: emptyState() }));
    await syncLanNow();
    expect(native.post.mock.calls.map(([options]) => options.url)).toEqual([
      'http://192.168.1.20:17820/sync',
      'relay:/sync',
    ]);
    // Back home: the nearby PC answers first and the relay rests.
    native.post.mockClear();
    native.post.mockResolvedValueOnce(reply({ state: emptyState(), relay: null }));
    await syncLanNow();
    expect(useLanSync.getState().route).toBe('wifi');
    // The owner removed the relay on the PC, so the phone forgets it too.
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem('memoria-wifi-device')!).relay).toBeUndefined());
  });
  it('says the PC is away when the relay cannot reach it either', async () => {
    native.post
      .mockResolvedValueOnce(reply({ token, deviceId: 'phone' }))
      .mockResolvedValueOnce(reply({ state: emptyState(), relay: 'https://relay.example.workers.dev' }));
    await pairLanDevice('192.168.1.20:17820', '12345678', fingerprint);
    native.post.mockClear();
    native.post.mockRejectedValueOnce(new Error('away from home'));
    native.relayOffline = true;
    await syncLanNow();
    native.relayOffline = false;
    expect(useLanSync.getState()).toMatchObject({ status: 'offline', error: 'Your PC is not connected.' });
  });
  it('reports the PC as offline once every known address fails', async () => {
    native.post
      .mockResolvedValueOnce(reply({ token, deviceId: 'phone' }))
      .mockResolvedValueOnce(reply({ state: emptyState(), addresses: ['http://100.101.2.3:17820'] }));
    await pairLanDevice('192.168.1.20:17820', '12345678', fingerprint);
    native.post.mockClear();
    native.post.mockRejectedValue(new Error('offline'));
    await syncLanNow();
    expect(native.post).toHaveBeenCalledTimes(2);
    expect(useLanSync.getState().status).toBe('offline');
    expect(useLanSync.getState().host).toBe('http://192.168.1.20:17820');
  });
  it('accepts only private literal addresses without credentials, query strings or paths', () => {
    expect(normalizeLanHost('192.168.1.20')).toBe('http://192.168.1.20:17820');
    expect(normalizeLanHost('100.101.2.3')).toBe('http://100.101.2.3:17820');
    for (const value of [
      'http://100.63.0.1',
      'http://100.128.0.1',
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
    await Promise.resolve();
    await Promise.resolve();
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

    expect(useApp.getState().state.snapshots).toEqual([expect.objectContaining(reading)]);
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
    await Promise.resolve();
    await Promise.resolve();
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

  describe('first sync with games on both sides', () => {
    const local = { ...emptyState(), games: [game('tablet-genshin')] };
    const pc = { ...emptyState(), games: [game('pc-genshin'), game('pc-hsr')] };
    const sent = () =>
      native.post.mock.calls
        .map(([options]: [{ url: string; data: { state?: { games: Game[] } } }]) => options)
        .filter((options) => options.url.endsWith('/sync'))
        .map((options) => options.data.state!.games.map((entry) => entry.id));
    async function pairWithGames() {
      useApp.setState({ state: local });
      native.post
        .mockResolvedValueOnce(reply({ token, deviceId: 'tablet' }))
        .mockResolvedValueOnce(reply({ state: pc }));
      await pairLanDevice('192.168.1.20:17820', '12345678', fingerprint);
    }

    it('asks before combining and sends nothing of this device while the question is open', async () => {
      await pairWithGames();
      expect(useLanSync.getState().choice).toEqual({ deviceGames: 1, pcGames: 2 });
      expect(useLanSync.getState().status).toBe('choosing');
      // The only sync request so far carried an empty state.
      expect(sent()).toEqual([[]]);
      expect(useApp.getState().state.games.map((entry) => entry.id)).toEqual(['tablet-genshin']);
      await syncLanNow();
      expect(sent()).toEqual([[]]);
    });

    it("replaces this device's games with the PC's when asked to", async () => {
      await pairWithGames();
      native.post.mockResolvedValueOnce(reply({ state: pc }));
      await resolveFirstSync('pc');
      expect(useLanSync.getState().choice).toBeNull();
      expect(
        useApp
          .getState()
          .state.games.map((entry) => entry.id)
          .sort(),
      ).toEqual(['pc-genshin', 'pc-hsr']);
      expect(sent().at(-1)!.sort()).toEqual(['pc-genshin', 'pc-hsr']);
    });

    it('keeps every game from both when asked to combine', async () => {
      await pairWithGames();
      native.post.mockResolvedValueOnce(reply({ state: { ...pc, games: [...pc.games, ...local.games] } }));
      await resolveFirstSync('combine');
      expect(sent().at(-1)).toEqual(['tablet-genshin']);
      expect(useApp.getState().state.games).toHaveLength(3);
    });

    it('disconnects without changing this device when cancelled', async () => {
      await pairWithGames();
      native.post.mockResolvedValue(reply({ ok: true }));
      await resolveFirstSync('cancel');
      expect(useLanSync.getState()).toMatchObject({ choice: null, host: '', status: 'off' });
      expect(useApp.getState().state.games.map((entry) => entry.id)).toEqual(['tablet-genshin']);
    });

    it('does not ask when the PC already knows every game on this device', async () => {
      useApp.setState({ state: { ...emptyState(), games: [game('pc-genshin')] } });
      native.post
        .mockResolvedValueOnce(reply({ token, deviceId: 'tablet' }))
        .mockResolvedValueOnce(reply({ state: pc }))
        .mockResolvedValueOnce(reply({ state: pc }));
      await pairLanDevice('192.168.1.20:17820', '12345678', fingerprint);
      expect(useLanSync.getState().choice).toBeNull();
      expect(useLanSync.getState().status).toBe('ok');
    });
  });
});
