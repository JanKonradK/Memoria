import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { emptyState, PRESETS, type Game } from '@memoria/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const idb = vi.hoisted(() => new Map<string, unknown>());

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idb.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    idb.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    idb.delete(key);
  }),
  keys: vi.fn(async () => [...idb.keys()]),
}));

// The shipped codes change with every build; these tests own the only codes there are.
vi.mock('../src/data/seed-feed', async (original) => ({
  ...(await original<typeof import('../src/data/seed-feed')>()),
  SEED_CODES: [],
}));
vi.mock('../src/data/catch-up', async (original) => ({
  ...(await original<typeof import('../src/data/catch-up')>()),
  VERSION_DIGESTS: [],
}));

import { closeTabSyncForTest, flushPersist, useApp } from '../src/store';
import { useUI } from '../src/ui-store';
import { useConnectors } from '../src/connectors';
import type { ConnectorStatus, DesktopHost, HoyolabRedeemResult } from '../src/desktop-host';
import { codesForGame, liveCodes } from '../src/codes';
import { GameCodes } from '../src/components/GameCodes';
import { TodayCodes } from '../src/components/TodayCodes';

const NOW = Date.now();
const DAY = 86_400_000;

async function freshStore(): Promise<void> {
  closeTabSyncForTest();
  await flushPersist();
  idb.clear();
  useApp.setState({ state: emptyState(), loaded: false, loadError: '', syncStatus: 'idle', syncError: '' });
  await useApp.getState().load();
}

function addPreset(key: string): string {
  return useApp.getState().addGameFromPreset(
    PRESETS.find((preset) => preset.key === key)!,
    {},
  );
}

function gameById(id: string): Game {
  return useApp.getState().state.games.find((game) => game.id === id)!;
}

const savedCodes = (gameId: string) => gameById(gameId).codes ?? [];

function undoLast() {
  const notice = useUI.getState().undoNotice;
  expect(notice).not.toBeNull();
  act(() => notice!.undo());
}

/** Reads the game from the store on every render, as GamePage does. */
function Harness({ gameId }: { gameId: string }) {
  const game = useApp((store) => store.state.games.find((item) => item.id === gameId)!);
  return <GameCodes game={game} now={NOW} />;
}

function TodayHarness({ now = NOW }: { now?: number }) {
  const games = useApp((store) => store.state.games);
  return <TodayCodes games={games} now={now} />;
}

beforeEach(async () => {
  await freshStore();
  useUI.setState({ undoNotice: null });
  useConnectors.setState({ status: null, busy: {}, notice: null, pendingScreenshot: null });
  delete window.memoriaDesktop;
});

afterEach(() => {
  delete window.memoriaDesktop;
  vi.restoreAllMocks();
});

describe('store: saved codes', () => {
  it('adds codes once (any case), fills the official redeem link and records one undoable entry', () => {
    const genshin = addPreset('genshin');
    const hsr = addPreset('hsr');
    const zzz = addPreset('zzz');
    const wuwa = addPreset('wuwa');

    expect(
      useApp
        .getState()
        .addGameCodes(genshin, [
          { code: ' GENSHINGIFT ', rewards: '60 Primogems' },
          { code: 'genshingift' },
          { code: 'SECOND', redeemUrl: 'https://example.com/redeem' },
        ]),
    ).toBe(2);
    expect(useApp.getState().history.journal.at(-1)?.label).toBe('Add codes');
    expect(savedCodes(genshin)).toEqual([
      expect.objectContaining({
        code: 'GENSHINGIFT',
        rewards: '60 Primogems',
        redeemUrl: 'https://genshin.hoyoverse.com/en/gift?code=GENSHINGIFT',
      }),
      expect.objectContaining({ code: 'SECOND', redeemUrl: 'https://example.com/redeem' }),
    ]);
    expect(useApp.getState().addGameCodes(genshin, [{ code: 'GenshinGift' }])).toBe(0);

    useApp.getState().addGameCodes(hsr, [{ code: 'STARRAIL' }]);
    useApp.getState().addGameCodes(zzz, [{ code: 'ZENLESS' }]);
    useApp.getState().addGameCodes(wuwa, [{ code: 'WAVES', redeemUrl: 'http://insecure.example' }]);
    expect(savedCodes(hsr)[0]?.redeemUrl).toBe('https://hsr.hoyoverse.com/gift?code=STARRAIL');
    expect(savedCodes(zzz)[0]?.redeemUrl).toBe('https://zenless.hoyoverse.com/redemption?code=ZENLESS');
    expect(savedCodes(wuwa)[0]?.redeemUrl).toBeUndefined();

    const codeId = savedCodes(genshin)[0]!.id;
    useApp.getState().toggleGameCodeRedeemed(genshin, codeId);
    expect(savedCodes(genshin)[0]?.redeemed).toBe(true);
    expect(useApp.getState().history.journal.at(-1)?.label).toBe('Mark code redeemed');
    useApp.getState().removeGameCode(genshin, codeId);
    expect(savedCodes(genshin).map((item) => item.code)).toEqual(['SECOND']);
    expect(useApp.getState().history.journal.at(-1)?.label).toBe('Remove code');
  });

  it('caps a game at 200 saved codes', () => {
    const gameId = addPreset('wuwa');
    const many = Array.from({ length: 205 }, (_, index) => ({ code: `CODE${index}` }));
    expect(useApp.getState().addGameCodes(gameId, many)).toBe(200);
    expect(useApp.getState().addGameCodes(gameId, [{ code: 'MORE' }])).toBe(0);
  });
});

describe('codes for one game', () => {
  it('splits saved and feed codes into active, redeemed and expired, preferring the saved copy', () => {
    const gameId = addPreset('genshin');
    useApp
      .getState()
      .addGameCodes(gameId, [
        { code: 'NOEXPIRY' },
        { code: 'SOON', expiresAt: NOW + DAY },
        { code: 'OLD', expiresAt: NOW - DAY },
        { code: 'SHARED' },
      ]);
    const feed = [
      { game: 'genshin', code: 'shared', rewards: 'Feed copy', expiresAt: new Date(NOW + 2 * DAY).toISOString() },
      { game: 'genshin', code: 'FEEDLIVE', rewards: '', expiresAt: new Date(NOW + 3 * DAY).toISOString() },
      { game: 'genshin', code: 'FEEDUSED', rewards: '', expiresAt: new Date(NOW + 3 * DAY).toISOString() },
      { game: 'hsr', code: 'OTHERGAME', rewards: '', expiresAt: new Date(NOW + 3 * DAY).toISOString() },
    ];
    const split = codesForGame(gameById(gameId), feed, ['genshin:FEEDUSED'], NOW);
    expect(split.active.map((item) => item.code)).toEqual(['SOON', 'FEEDLIVE', 'NOEXPIRY', 'SHARED']);
    expect(split.active.find((item) => item.code === 'SHARED')?.customId).toBeDefined();
    expect(split.redeemed.map((item) => item.code)).toEqual(['FEEDUSED']);
    expect(split.expired.map((item) => item.code)).toEqual(['OLD']);

    const today = liveCodes(useApp.getState().state.games, feed, [], NOW).map((item) => item.code);
    expect(today.filter((code) => code.toUpperCase() === 'SHARED')).toEqual(['SHARED']);
    expect(today).toContain('NOEXPIRY');
    expect(today).not.toContain('OLD');
  });
});

describe('GameCodes', () => {
  it('adds pasted codes, copies one, marks it redeemed, unmarks it and removes it with Undo', async () => {
    const gameId = addPreset('genshin');
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Harness gameId={gameId} />);

    const add = screen.getByRole('button', { name: 'Add codes for Genshin Impact' });
    expect(add).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(add);
    expect(add).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Redeem links fill in automatically for Genshin, HSR and ZZZ.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Redeem link')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Reward codes'), { target: { value: 'ALPHA1\nbeta2, ALPHA1' } });
    fireEvent.change(screen.getByLabelText('Rewards'), { target: { value: '100 Primogems' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add codes' }));

    expect(screen.getByRole('status')).toHaveTextContent('Added 2 codes');
    expect(useUI.getState().undoNotice?.text).toBe('Added 2 codes to Genshin Impact');
    expect(screen.queryByLabelText('Reward codes')).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Genshin Impact active codes' });
    expect(within(list).getByText('ALPHA1')).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: 'Redeem ALPHA1' })).toHaveAttribute(
      'href',
      'https://genshin.hoyoverse.com/en/gift?code=ALPHA1',
    );

    // The same code again is refused.
    fireEvent.click(add);
    fireEvent.change(screen.getByLabelText('Reward codes'), { target: { value: 'alpha1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add code' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Already added.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Copy ALPHA1' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ALPHA1'));
    expect(await screen.findByRole('button', { name: 'Copy ALPHA1' })).toHaveTextContent('Copied');

    fireEvent.click(screen.getByRole('button', { name: 'Mark ALPHA1 redeemed' }));
    expect(screen.queryByRole('button', { name: 'Mark ALPHA1 redeemed' })).not.toBeInTheDocument();
    expect(screen.getByText('Redeemed & expired (1)')).toBeInTheDocument();
    expect(useUI.getState().undoNotice?.text).toBe('Marked ALPHA1 redeemed');

    fireEvent.click(screen.getByRole('button', { name: 'Unmark ALPHA1' }));
    expect(screen.getByRole('button', { name: 'Mark ALPHA1 redeemed' })).toBeInTheDocument();
    expect(screen.queryByText(/Redeemed & expired/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove ALPHA1' }));
    expect(screen.queryByText('ALPHA1')).not.toBeInTheDocument();
    expect(useUI.getState().undoNotice?.text).toBe('Removed ALPHA1');
    undoLast();
    expect(await screen.findByText('ALPHA1')).toBeInTheDocument();
    expect(savedCodes(gameId).map((item) => item.code)).toEqual(['ALPHA1', 'beta2']);
  });

  it('asks for a redeem link on games without an official page and refuses one that is not https', () => {
    const gameId = addPreset('wuwa');
    render(<Harness gameId={gameId} />);
    expect(screen.queryByRole('link', { name: /Official redeem page/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add codes for Wuthering Waves' }));
    fireEvent.change(screen.getByLabelText('Reward codes'), { target: { value: 'WAVES' } });
    fireEvent.change(screen.getByLabelText('Redeem link'), { target: { value: 'http://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add code' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Redeem links must start with https://.');
    expect(savedCodes(gameId)).toEqual([]);
  });

  it('shows the empty state and official portal link on HoYoverse games', () => {
    const gameId = addPreset('genshin');
    render(<Harness gameId={gameId} />);
    expect(screen.getByText(/No active codes right now/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Official redeem page/ })).toHaveAttribute(
      'href',
      'https://genshin.hoyoverse.com/en/gift',
    );
  });

  it('tracks Worked / Failed after clicking an unlinked redeem link', () => {
    const gameId = addPreset('genshin');
    useApp.getState().addGameCodes(gameId, [{ code: 'ALPHA1' }, { code: 'BETA2' }]);
    render(<Harness gameId={gameId} />);

    fireEvent.click(screen.getByRole('link', { name: 'Redeem ALPHA1' }));
    expect(screen.getByRole('button', { name: 'ALPHA1 worked' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ALPHA1 failed' }));
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('It did not redeem on the site.')).toBeInTheDocument();
    expect(savedCodes(gameId).find((item) => item.code === 'ALPHA1')?.redeemed ?? false).toBe(false);

    fireEvent.click(screen.getByRole('link', { name: 'Redeem BETA2' }));
    fireEvent.click(screen.getByRole('button', { name: 'BETA2 worked' }));
    expect(savedCodes(gameId).find((item) => item.code === 'BETA2')?.redeemed).toBe(true);
    expect(useUI.getState().undoNotice?.text).toBe('Marked BETA2 redeemed');
  });

  it('auto-claims linked codes via HoYoLAB and reports failure statuses', async () => {
    const gameId = addPreset('genshin');
    useApp.getState().addGameCodes(gameId, [{ code: 'GIFT1' }, { code: 'GIFT2' }, { code: 'BAD3' }]);
    const redeem = vi.fn<(id: string, code: string) => Promise<HoyolabRedeemResult>>();
    const status: ConnectorStatus = {
      hoyolab: {
        connected: true,
        maskedUid: '80****01',
        roles: [{ presetKey: 'genshin', uid: '800000001', region: 'os_asia' }],
        gameLinks: { [gameId]: { presetKey: 'genshin', uid: '800000001', region: 'os_asia' } },
        backoffUntilMs: null,
        autoRefreshOnExit: false,
      },
      screenshotWatch: { enabled: false, folderName: null },
    };
    window.memoriaDesktop = {
      version: 1,
      connectors: { hoyolab: { redeem } },
    } as unknown as DesktopHost;
    useConnectors.setState({ status });

    render(<Harness gameId={gameId} />);
    expect(screen.getByRole('button', { name: 'Claim GIFT1' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Redeem GIFT1' })).toHaveTextContent('Open link ↗');

    redeem.mockResolvedValueOnce({ ok: true, status: 'redeemed', retcode: 0, message: 'Code redeemed!' });
    fireEvent.click(screen.getByRole('button', { name: 'Claim GIFT1' }));
    await waitFor(() => expect(savedCodes(gameId).find((item) => item.code === 'GIFT1')?.redeemed).toBe(true));
    expect(redeem).toHaveBeenCalledWith(gameId, 'GIFT1');
    expect(useUI.getState().undoNotice?.text).toBe('Claimed GIFT1');

    redeem.mockResolvedValueOnce({ ok: true, status: 'already', retcode: -2017, message: 'Already redeemed.' });
    fireEvent.click(screen.getByRole('button', { name: 'Claim GIFT2' }));
    await waitFor(() => expect(savedCodes(gameId).find((item) => item.code === 'GIFT2')?.redeemed).toBe(true));
    expect(useUI.getState().undoNotice?.text).toBe('Already claimed GIFT2');

    for (const [errStatus, badge, msg] of [
      ['expired', 'Expired', 'This code has expired.'],
      ['invalid', 'Invalid', 'Invalid redemption code.'],
      ['cooldown', 'Cooldown', 'Cooldown active — wait 5 seconds and try again.'],
      ['auth', 'Sign in needed', 'Sign in to HoYoLAB again in Settings → Connections for 1-click claiming.'],
      ['failed', 'Failed', 'Redemption failed.'],
    ] as const) {
      redeem.mockResolvedValueOnce({ ok: false, status: errStatus, retcode: -1, message: msg });
      fireEvent.click(screen.getByRole('button', { name: 'Claim BAD3' }));
      expect(await screen.findByText(badge)).toBeInTheDocument();
      expect(screen.getByText(msg)).toBeInTheDocument();
      expect(savedCodes(gameId).find((item) => item.code === 'BAD3')?.redeemed ?? false).toBe(false);
    }

    fireEvent.click(screen.getByRole('link', { name: 'Redeem BAD3' }));
    expect(screen.getByRole('button', { name: 'BAD3 worked' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'BAD3 failed' })).toBeInTheDocument();
  });
});

describe('TodayCodes', () => {
  it('lists active saved codes and hides them once redeemed or expired', () => {
    const gameId = addPreset('wuwa');
    useApp.getState().addGameCodes(gameId, [
      { code: 'TODAYCODE', rewards: '50 Astrite' },
      { code: 'TOMORROW', expiresAt: NOW + DAY },
    ]);
    const { rerender } = render(<TodayHarness />);
    expect(screen.getByText('TODAYCODE')).toBeInTheDocument();
    expect(screen.getByText('TOMORROW')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark TODAYCODE redeemed' }));
    expect(screen.queryByText('TODAYCODE')).not.toBeInTheDocument();
    expect(savedCodes(gameId).find((item) => item.code === 'TODAYCODE')?.redeemed).toBe(true);
    expect(useUI.getState().undoNotice?.text).toBe('Marked TODAYCODE redeemed');
    undoLast();
    expect(screen.getByText('TODAYCODE')).toBeInTheDocument();

    rerender(<TodayHarness now={NOW + 2 * DAY} />);
    expect(screen.queryByText('TOMORROW')).not.toBeInTheDocument();
    expect(screen.getByText('TODAYCODE')).toBeInTheDocument();
  });
});
