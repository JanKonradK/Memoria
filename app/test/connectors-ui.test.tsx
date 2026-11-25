import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  emptyState,
  latestSnapshots,
  mapGenshinDailyNote,
  mapHsrDailyNote,
  PRESETS,
  taskPeriodKey,
  type Game,
  type Snapshot,
} from '@memoria/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConnectorStatus,
  DesktopConnectors,
  DesktopHost,
  HoyolabCheckInResult,
  HoyolabRefreshResult,
  ScreenshotOcrResult,
} from '../src/desktop-host';

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

import { closeTabSyncForTest, flushPersist, useApp } from '../src/store';
import { useUI } from '../src/ui-store';
import {
  captureScreenshot,
  CONNECTOR_NOTICE_EVENT,
  initConnectors,
  loadConnectorStatus,
  openScreenshotOcr,
  PENDING_SCREENSHOT_EVENT,
  pickScreenshotFile,
  setConnectorNotice,
  useConnectors,
  type ConnectorNotice,
} from '../src/connectors';
import { useConnectors as useConnectorsState } from '../src/connectors-state';
import { readingSource } from '../src/reading-source';
import { GamePityPanel } from '../src/components/Pity';
import { Connections } from '../src/components/settings/Connections';
import { ScreenshotConfirm } from '../src/components/ScreenshotConfirm';
import { ConfirmHost } from '../src/components/ConfirmDialog';
import { GameControls } from '../src/components/GameCard';
import { TodayPage } from '../src/components/Today';
import { TooltipProvider } from '../src/components/ui';

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

function resourceNamed(gameId: string, name: string) {
  return useApp.getState().state.resources.find((res) => res.gameId === gameId && res.name === name && !res.deleted)!;
}

function latest(resourceId: string): Snapshot | undefined {
  return latestSnapshots(useApp.getState().state.snapshots).get(resourceId);
}

function taskByKey(gameId: string, key: string) {
  return useApp.getState().state.tasks.find((task) => task.gameId === gameId && task.presetTaskKey === key)!;
}

function liveCompletion(taskId: string) {
  return useApp.getState().state.completions.find((row) => row.taskId === taskId && !row.deleted);
}

function undoLast() {
  const notice = useUI.getState().undoNotice;
  expect(notice).not.toBeNull();
  act(() => notice!.undo());
}

const GENSHIN_NOTE = {
  current_resin: 120,
  max_resin: 200,
  resin_recovery_time: '6000',
  current_home_coin: 1500,
  max_home_coin: 2000,
  home_coin_recovery_time: '3600',
  finished_task_num: 4,
  total_task_num: 4,
  is_extra_task_reward_received: true,
  resin_discount_num_limit: 3,
  remain_resin_discount_num: 1,
};

beforeEach(async () => {
  await freshStore();
  useConnectors.setState({
    status: null,
    busy: {},
    notice: null,
    pendingScreenshot: null,
    activeBrowserHandoff: null,
  });
  useUI.setState({ undoNotice: null, focusedGameId: null });
  delete window.memoriaDesktop;
});

afterEach(() => {
  delete window.memoriaDesktop;
  vi.restoreAllMocks();
});

describe('store.applyConnectorObservation', () => {
  it('writes energy, Realm Currency cap, commissions and weekly bosses, and undoes cleanly', () => {
    const gameId = addPreset('genshin');
    const resin = resourceNamed(gameId, 'Original Resin');
    const coin = resourceNamed(gameId, 'Realm Currency');
    const commissions = taskByKey(gameId, 'genshin-commissions');
    const bosses = taskByKey(gameId, 'genshin-weekly-bosses');
    const before = latest(resin.id);
    const observedAt = Date.now();

    const applied = useApp.getState().applyConnectorObservation(gameId, mapGenshinDailyNote(GENSHIN_NOTE, observedAt));

    expect(applied).toBeGreaterThanOrEqual(4);
    const snap = latest(resin.id)!;
    expect(snap.value).toBe(120);
    expect(snap.provenance).toEqual(expect.objectContaining({ kind: 'account', provider: 'hoyolab', observedAt }));
    expect(resourceNamed(gameId, 'Realm Currency').cap).toBe(2000);
    expect(latest(coin.id)?.value).toBe(1500);
    expect(liveCompletion(commissions.id)?.done).toBe(true);
    expect(liveCompletion(bosses.id)?.countDone).toBe(2);
    expect(useApp.getState().history.journal.at(-1)?.label).toBe('Live reading sync');

    act(() => useApp.getState().undoActivity(useApp.getState().history.journal.at(-1)!.id));
    expect(latest(resin.id)?.id).toBe(before?.id);
    expect(resourceNamed(gameId, 'Realm Currency').cap).toBe(2400);
    expect(liveCompletion(commissions.id)?.done ?? false).toBe(false);
    expect(liveCompletion(bosses.id)?.countDone ?? 0).toBe(0);
  });

  it('writes the HSR reserve beside the main bar', () => {
    const gameId = addPreset('hsr');
    const power = resourceNamed(gameId, 'Trailblaze Power');
    const obs = mapHsrDailyNote(
      { current_stamina: 180, max_stamina: 300, stamina_recover_time: 600, current_reserve_stamina: 900 },
      Date.now(),
    );
    expect(useApp.getState().applyConnectorObservation(gameId, obs)).toBe(1);
    expect(latest(power.id)).toEqual(expect.objectContaining({ value: 180, reserve: 900 }));
  });

  it('changes nothing for an unknown game', () => {
    const before = useApp.getState().state;
    expect(useApp.getState().applyConnectorObservation('missing', mapGenshinDailyNote(GENSHIN_NOTE, Date.now()))).toBe(
      0,
    );
    expect(useApp.getState().state).toBe(before);
  });
});

function uigf(accounts: Array<{ uid: string; list: unknown[] }>) {
  return JSON.stringify({
    info: { export_timestamp: 1_700_000_000, export_app: 'test', export_app_version: '1', version: 'v4.0' },
    hk4e: accounts.map((account) => ({ uid: account.uid, timezone: 8, lang: 'en-us', list: account.list })),
  });
}

const pull = (id: string, name: string, rank: number, time: string) => ({
  id,
  gacha_type: '301',
  time,
  name,
  rank_type: String(rank),
  item_type: 'Character',
});

function PityHarness({ gameId }: { gameId: string }) {
  const game = useApp((store) => store.state.games.find((item) => item.id === gameId)!);
  return <GamePityPanel game={game} ink="#fff" tz="UTC" />;
}

function chooseFile(label: string, text: string) {
  fireEvent.change(screen.getByLabelText(label), {
    target: { files: [{ size: text.length, name: 'export.json', text: async () => text }] },
  });
}

describe('Pity import', () => {
  it('imports a single-account UIGF v4 file and Undo restores the earlier pity', async () => {
    const gameId = addPreset('genshin');
    useApp.getState().updateGame(gameId, { pity: { tracks: { character: { count: 7, guaranteed: false, log: [] } } } });
    const previous = gameById(gameId).pity;
    render(<PityHarness gameId={gameId} />);

    chooseFile(
      'Import UIGF / JSON…',
      uigf([
        {
          uid: '800000001',
          list: [
            pull('1001', 'Fischl', 4, '2026-11-01 10:00:00'),
            pull('1002', 'Furina', 5, '2026-11-01 10:00:01'),
            pull('1003', 'Xiangling', 3, '2026-11-01 10:00:02'),
          ],
        },
      ]),
    );

    await screen.findByText('Imported 3 pulls, 1 5★ entry.');
    const track = gameById(gameId).pity!.tracks.character!;
    expect(track.count).toBe(1);
    expect(track.log).toHaveLength(1);
    expect(track.log[0]).toEqual(expect.objectContaining({ name: 'Furina', pity: 2 }));

    undoLast();
    expect(gameById(gameId).pity).toEqual(previous);
  });

  it('asks which account to import from a multi-account file and changes nothing until then', async () => {
    const gameId = addPreset('genshin');
    render(<PityHarness gameId={gameId} />);
    chooseFile(
      'Import UIGF / JSON…',
      uigf([
        { uid: '800000001', list: [pull('1', 'Fischl', 4, '2026-11-01 10:00:00')] },
        {
          uid: '700000002',
          list: [pull('2', 'Diluc', 5, '2026-11-02 10:00:00'), pull('3', 'Amber', 3, '2026-11-02 10:00:01')],
        },
      ]),
    );

    await screen.findByText('This file holds several accounts.');
    expect(gameById(gameId).pity).toBeUndefined();
    fireEvent.click(screen.getByRole('radio', { name: '700000002' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import selected account' }));

    expect(screen.getByText('Imported 2 pulls, 1 5★ entry.')).toBeInTheDocument();
    const track = gameById(gameId).pity!.tracks.character!;
    expect(track.log[0]).toEqual(expect.objectContaining({ name: 'Diluc', outcome: 'lost' }));
    expect(track.guaranteed).toBe(true);
  });

  it('cancelling the account choice imports nothing', async () => {
    const gameId = addPreset('genshin');
    render(<PityHarness gameId={gameId} />);
    chooseFile(
      'Import UIGF / JSON…',
      uigf([
        { uid: '1', list: [pull('1', 'Fischl', 4, '2026-11-01 10:00:00')] },
        { uid: '2', list: [pull('2', 'Diluc', 5, '2026-11-02 10:00:00')] },
      ]),
    );
    await screen.findByText('This file holds several accounts.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('This file holds several accounts.')).not.toBeInTheDocument();
    expect(gameById(gameId).pity).toBeUndefined();
  });

  it('reports a file that is not JSON', async () => {
    const gameId = addPreset('genshin');
    render(<PityHarness gameId={gameId} />);
    chooseFile('Import UIGF / JSON…', 'not json');
    expect(await screen.findByRole('alert')).toHaveTextContent('That file is not JSON');
  });
});

function connectedStatus(over: Partial<ConnectorStatus['hoyolab']> = {}): ConnectorStatus {
  return {
    hoyolab: {
      connected: true,
      maskedUid: '80****01',
      roles: [{ presetKey: 'genshin', uid: '800000001', region: 'os_asia', nickname: 'Traveler', regionName: 'Asia' }],
      gameLinks: {},
      backoffUntilMs: null,
      autoRefreshOnExit: false,
      ...over,
    },
    screenshotWatch: { enabled: false, folderName: null },
  };
}

function mockDesktop(initial: ConnectorStatus) {
  let status = initial;
  const refresh = vi.fn<(gameId: string, options?: { auto?: boolean }) => Promise<HoyolabRefreshResult>>();
  const connectors: DesktopConnectors = {
    status: vi.fn(async () => status),
    hoyolab: {
      login: vi.fn(async () => status),
      disconnect: vi.fn(async () => status),
      link: vi.fn(async (gameId: string, presetKey: string, uid: string | null, region: string | null) => {
        const gameLinks = { ...status.hoyolab.gameLinks };
        if (uid && region) gameLinks[gameId] = { presetKey: presetKey as 'genshin', uid, region };
        else delete gameLinks[gameId];
        status = { ...status, hoyolab: { ...status.hoyolab, gameLinks } };
        return status;
      }),
      refresh,
      setPrefs: vi.fn(async (changes: { autoRefreshOnExit?: boolean }) => {
        status = { ...status, hoyolab: { ...status.hoyolab, ...changes } };
        return status;
      }),
    },
    gachaScan: vi.fn(async () => null),
    screenshot: {
      pick: vi.fn(async () => null),
      watchChoose: vi.fn(async () => {
        status = { ...status, screenshotWatch: { enabled: true, folderName: 'Screenshots' } };
        return status;
      }),
      watchClear: vi.fn(async () => {
        status = { ...status, screenshotWatch: { enabled: false, folderName: null } };
        return status;
      }),
    },
    onStatusChanged: vi.fn(() => () => undefined),
    onScreenshotOcr: vi.fn(() => () => undefined),
  };
  window.memoriaDesktop = { version: 1, connectors } as unknown as DesktopHost;
  return { connectors, refresh };
}

describe('Connections', () => {
  it('explains that live HoYoLAB needs an app in a plain browser and still offers a screenshot', () => {
    addPreset('genshin');
    render(<Connections />);
    expect(screen.getByText(/need the Windows or Android app/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    const pick = screen.getByRole('button', { name: 'Pick a screenshot…' });
    const file = document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!;
    expect(file).toHaveAttribute('tabindex', '-1');
    const click = vi.spyOn(file, 'click').mockImplementation(() => undefined);
    pick.focus();
    expect(pick).toHaveFocus();
    fireEvent.click(pick);
    expect(click).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText('Type the numbers beside your screenshot; nothing is read automatically here.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Genshin Impact pulls' })).toBeInTheDocument();
  });

  it('links a role, refreshes live numbers and shows HoYoLAB guidance', async () => {
    const gameId = addPreset('genshin');
    const resin = resourceNamed(gameId, 'Original Resin');
    const { connectors, refresh } = mockDesktop(connectedStatus());
    render(<Connections />);

    await screen.findByText('Connected · 80****01');
    expect(screen.getByRole('switch', { name: 'Refresh when a game closes' })).toBeInTheDocument();

    const account = screen.getByRole('combobox', { name: 'HoYoLAB account for Genshin Impact' });
    fireEvent.keyDown(account, { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'Traveler · 800000001 · Asia' }));
    await waitFor(() =>
      expect(connectors.hoyolab.link).toHaveBeenCalledWith(gameId, 'genshin', '800000001', 'os_asia'),
    );

    const observedAt = Date.now();
    refresh.mockResolvedValueOnce({
      ok: true,
      retcode: 0,
      backoffUntilMs: null,
      presetKey: 'genshin',
      observedAt,
      raw: GENSHIN_NOTE,
      error: null,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh now: Genshin Impact' }));
    await waitFor(() => expect(latest(resin.id)?.value).toBe(120));
    expect(latest(resin.id)?.provenance?.kind).toBe('account');
    expect(useUI.getState().undoNotice?.text).toBe('Read live numbers for Genshin Impact');
    undoLast();
    expect(latest(resin.id)?.provenance?.kind).not.toBe('account');

    refresh.mockResolvedValueOnce({
      ok: false,
      retcode: 10102,
      backoffUntilMs: null,
      presetKey: 'genshin',
      observedAt,
      raw: null,
      error: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh now: Genshin Impact' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Real-Time Notes are turned off');

    const statusCalls = vi.mocked(connectors.status).mock.calls.length;
    refresh.mockResolvedValueOnce({
      ok: false,
      retcode: 1034,
      backoffUntilMs: Date.now() + 600_000,
      presetKey: 'genshin',
      observedAt,
      raw: null,
      error: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh now: Genshin Impact' }));
    await screen.findByText(/wants a quick verification/);
    await waitFor(() => expect(vi.mocked(connectors.status).mock.calls.length).toBeGreaterThan(statusCalls));
  });

  it('turns the screenshot folder watch on and off', async () => {
    const { connectors } = mockDesktop(connectedStatus());
    render(<Connections />);
    fireEvent.click(await screen.findByRole('button', { name: 'Watch folder…' }));
    await screen.findByText(/Watching Screenshots/);
    expect(connectors.screenshot.watchChoose).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop watching' }));
    await screen.findByRole('button', { name: 'Watch folder…' });
    expect(connectors.screenshot.watchClear).toHaveBeenCalled();
  });

  it('offers sign-in when HoYoLAB is not connected', async () => {
    const { connectors } = mockDesktop(connectedStatus({ connected: false, maskedUid: null, roles: [] }));
    render(<Connections />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(connectors.hoyolab.login).toHaveBeenCalled());
  });

  it('offers Sign in again when HoYoLAB is already connected', async () => {
    const { connectors } = mockDesktop(connectedStatus());
    render(<Connections />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in again' }));
    await waitFor(() => expect(connectors.hoyolab.login).toHaveBeenCalledWith(undefined));
    fireEvent.click(screen.getByRole('button', { name: 'Switch account' }));
    await waitFor(() => expect(connectors.hoyolab.login).toHaveBeenCalledWith({ fresh: true }));
  });

  it('connects HoYoLAB through the browser helper with a one-time code', async () => {
    const { connectors } = mockDesktop(connectedStatus({ connected: false, maskedUid: null, roles: [] }));
    const browser = {
      start: vi.fn(async (provider: 'hoyolab' | 'skport') => ({
        provider,
        code: 'K7Q2XM',
        expiresAtMs: Date.now() + 300_000,
      })),
      cancel: vi.fn(async () => undefined),
      openHelper: vi.fn(async () => undefined),
    };
    connectors.browser = browser;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Connections />);

    fireEvent.click(await screen.findByRole('button', { name: 'Use my browser for HoYoLAB' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open HoYoLAB in browser' }));
    await waitFor(() => expect(browser.start).toHaveBeenCalledWith('hoyolab'));
    expect(await screen.findByText('K7Q2XM')).toHaveClass('font-mono');
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenCalledWith('K7Q2XM');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(screen.getByText('Copied K7Q2XM')).toHaveAttribute('role', 'status');
    fireEvent.click(screen.getByRole('button', { name: 'Open extension folder' }));
    await waitFor(() => expect(browser.openHelper).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(browser.cancel).toHaveBeenCalled());
    expect(screen.queryByText('K7Q2XM')).not.toBeInTheDocument();
    expect(useConnectors.getState().activeBrowserHandoff).toBeNull();
  });

  it('clears the handoff once HoYoLAB reports connected', async () => {
    mockDesktop(connectedStatus({ connected: false, maskedUid: null, roles: [] }));
    await act(async () => {
      await loadConnectorStatus();
    });
    useConnectors.setState({
      activeBrowserHandoff: { provider: 'hoyolab', code: 'ABCDEF', expiresAtMs: Date.now() + 60_000 },
    });
    window.memoriaDesktop!.connectors!.status = vi.fn(async () => connectedStatus());
    await act(async () => {
      await loadConnectorStatus();
    });
    expect(useConnectors.getState().activeBrowserHandoff).toBeNull();
  });

  it('imports a pasted DevTools request and clears the field', async () => {
    const { connectors } = mockDesktop(connectedStatus({ connected: false, maskedUid: null, roles: [] }));
    const importBrowser = vi.fn(async () => connectedStatus());
    connectors.hoyolab.importBrowser = importBrowser;
    render(<Connections />);
    fireEvent.click(await screen.findByRole('button', { name: 'Use my browser for HoYoLAB' }));
    expect(screen.queryByRole('button', { name: 'Open HoYoLAB in browser' })).not.toBeInTheDocument();
    const field = screen.getByLabelText('Paste HoYoLAB request');
    expect(field).toHaveAttribute('type', 'password');
    fireEvent.change(field, { target: { value: 'Cookie: ltoken_v2=secret; ltuid_v2=1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect HoYoLAB from pasted request' }));
    await waitFor(() => expect(importBrowser).toHaveBeenCalledWith('Cookie: ltoken_v2=secret; ltuid_v2=1'));
    expect(field).toHaveValue('');
    await screen.findByText('Connected · 80****01');
  });
});

const GENSHIN_SCREEN = [
  'Original Resin 145/200',
  'Condensed Resin 4/5',
  'Daily Commissions 4/4',
  'Weekly Boss Half-Cost Remaining 1/3',
  'Primogems 14,250',
  'Intertwined Fate 23',
];

describe('ScreenshotConfirm · every field at once', () => {
  function openGenshinScreen() {
    const gameId = addPreset('genshin');
    const resin = resourceNamed(gameId, 'Original Resin');
    const condensed = resourceNamed(gameId, 'Condensed Resin');
    const commissions = taskByKey(gameId, 'genshin-commissions');
    const bosses = taskByKey(gameId, 'genshin-weekly-bosses');
    const observedAt = Date.now() - 60_000;
    act(() => {
      openScreenshotOcr({ fileName: 'paimon.png', observedAt, lines: GENSHIN_SCREEN, source: 'windows-ocr' });
    });
    render(<ScreenshotConfirm />);
    return { gameId, resin, condensed, commissions, bosses, observedAt };
  }

  it('saves bars, tasks and savings in one press, and one Undo reverts them all', () => {
    const { gameId, resin, condensed, commissions, bosses, observedAt } = openGenshinScreen();
    const before = {
      resin: latest(resin.id)?.id,
      condensed: latest(condensed.id)?.id,
      savings: gameById(gameId).savings,
    };
    const journal = useApp.getState().history.journal.length;

    expect(screen.getByLabelText('Original Resin value')).toHaveValue(145);
    expect(screen.getByLabelText('Condensed Resin value')).toHaveValue(4);
    expect(screen.getByLabelText(`${bosses.name} done`)).toHaveValue(2);
    expect(screen.getByLabelText('Primogems value')).toHaveValue(14250);
    expect(screen.getByLabelText('Intertwined Fate value')).toHaveValue(23);

    fireEvent.click(screen.getByRole('button', { name: 'Save 6 updates' }));

    expect(useApp.getState().history.journal.length).toBe(journal + 1);
    expect(latest(resin.id)).toEqual(
      expect.objectContaining({ value: 145, provenance: expect.objectContaining({ kind: 'screenshot', observedAt }) }),
    );
    expect(latest(condensed.id)?.value).toBe(4);
    expect(liveCompletion(commissions.id)?.done).toBe(true);
    expect(liveCompletion(bosses.id)).toEqual(expect.objectContaining({ countDone: 2, done: false }));
    expect(gameById(gameId).savings).toEqual(
      expect.objectContaining({ currency: 14250, tickets: 23, participation: 1, goals: [] }),
    );
    expect(useConnectors.getState().pendingScreenshot).toBeNull();
    expect(useUI.getState().undoNotice?.text).toBe('Saved 6 updates from a screenshot');

    undoLast();
    expect(latest(resin.id)?.id).toBe(before.resin);
    expect(latest(condensed.id)?.id).toBe(before.condensed);
    expect(liveCompletion(commissions.id)?.done ?? false).toBe(false);
    expect(liveCompletion(bosses.id)?.countDone ?? 0).toBe(0);
    expect(gameById(gameId).savings).toEqual(before.savings);
  });

  it('skips only what was unchecked', () => {
    const { gameId, resin, condensed, commissions } = openGenshinScreen();
    const before = latest(condensed.id)?.id;
    fireEvent.click(screen.getByLabelText('Include Condensed Resin'));
    fireEvent.click(screen.getByLabelText('Include Intertwined Fate'));
    fireEvent.click(screen.getByRole('button', { name: 'Save 4 updates' }));
    expect(latest(resin.id)?.value).toBe(145);
    expect(latest(condensed.id)?.id).toBe(before);
    expect(liveCompletion(commissions.id)?.done).toBe(true);
    expect(gameById(gameId).savings).toEqual(expect.objectContaining({ currency: 14250, tickets: 0 }));
  });

  it('keeps the rest of an existing savings entry', () => {
    const gameId = addPreset('genshin');
    act(() =>
      useApp.getState().updateGame(gameId, {
        savings: { currency: 1, tickets: 2, takenAt: 1, participation: 0.5, goals: [], monthlyPass: true },
      }),
    );
    act(() =>
      useApp.getState().applyScreenshotReadings({
        gameId,
        observedAt: Date.now(),
        provider: 'file',
        readings: [],
        tasks: [],
        savings: { tickets: 999_999_999 },
      }),
    );
    expect(gameById(gameId).savings).toEqual(
      expect.objectContaining({ currency: 1, tickets: 100_000_000, participation: 0.5, monthlyPass: true }),
    );
  });
});

describe('ScreenshotConfirm', () => {
  it('offers another bar the screenshot did not show', () => {
    const gameId = addPreset('genshin');
    const condensed = resourceNamed(gameId, 'Condensed Resin');
    act(() => {
      openScreenshotOcr({
        fileName: 'shot.png',
        observedAt: Date.now(),
        lines: ['Original Resin 120/200'],
        source: 'file',
      });
    });
    render(<ScreenshotConfirm />);
    expect(screen.queryByLabelText('Condensed Resin value')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Include another bar' }));
    expect(screen.getByLabelText('Include Condensed Resin')).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Condensed Resin value'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save 2 updates' }));
    expect(latest(condensed.id)?.value).toBe(3);
  });

  it('suggests the OCR reading, saves the edited value as a screenshot reading, and undoes', () => {
    const gameId = addPreset('genshin');
    const resin = resourceNamed(gameId, 'Original Resin');
    const before = latest(resin.id);
    const observedAt = Date.now() - 5 * 60_000;
    act(() => {
      openScreenshotOcr({
        fileName: 'shot.png',
        observedAt,
        lines: ['Original Resin 120/200'],
        source: 'windows-ocr',
      });
    });
    render(<ScreenshotConfirm />);

    expect(screen.getByText(/shot\.png/)).toBeInTheDocument();
    expect(screen.getByText('Clear match')).toBeInTheDocument();
    expect(screen.getByText('Read “Original Resin 120/200”')).toBeInTheDocument();
    const input = screen.getByLabelText('Original Resin value');
    expect(input).toHaveValue(120);

    fireEvent.change(input, { target: { value: '130' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reading' }));

    const snap = latest(resin.id)!;
    expect(snap.value).toBe(130);
    expect(snap.provenance).toEqual(
      expect.objectContaining({ kind: 'screenshot', provider: 'windows-ocr', observedAt }),
    );
    expect(useConnectors.getState().pendingScreenshot).toBeNull();
    undoLast();
    expect(latest(resin.id)?.id).toBe(before?.id);
  });

  it('saves nothing when dismissed', () => {
    const gameId = addPreset('genshin');
    const count = useApp.getState().state.snapshots.length;
    act(() => {
      openScreenshotOcr({ fileName: 'shot.png', observedAt: Date.now(), lines: ['120/200'], source: 'file' });
    });
    render(<ScreenshotConfirm />);
    expect(useConnectors.getState().pendingScreenshot?.gameId).toBe(gameId);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(useConnectors.getState().pendingScreenshot).toBeNull();
    expect(useApp.getState().state.snapshots).toHaveLength(count);
  });

  it('matches the text again when another game is chosen', () => {
    const genshin = addPreset('genshin');
    const hsr = addPreset('hsr');
    act(() => {
      openScreenshotOcr({ fileName: 'shot.png', observedAt: Date.now(), lines: ['180/300'], source: 'file' });
    });
    expect(useConnectors.getState().pendingScreenshot?.gameId).toBe(hsr);
    render(<ScreenshotConfirm />);
    expect(screen.getByLabelText('Trailblaze Power value')).toHaveValue(180);

    const select = screen.getByRole('combobox', { name: 'Game' });
    fireEvent.keyDown(select, { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'Genshin Impact' }));
    expect(useConnectors.getState().pendingScreenshot?.gameId).toBe(genshin);
    expect(screen.getByLabelText('Original Resin value')).toHaveValue(null);
  });
});

const ENDFIELD_CARD = {
  detail: {
    dungeon: { curStamina: 150, maxStamina: 300 },
    dailyMission: { dailyActivation: 100, maxDailyActivation: 100 },
  },
};

const SKPORT_ROLE = {
  presetKey: 'endfield' as const,
  uid: '1234567890',
  region: '2',
  nickname: 'Endmin',
  level: 40,
  regionName: 'Americas/Europe',
};

function fullStatus(over: Partial<ConnectorStatus> = {}): ConnectorStatus {
  return {
    ...connectedStatus(),
    skport: { connected: true, maskedUid: '12****90', roles: [SKPORT_ROLE], gameLinks: {}, autoRefreshOnExit: false },
    screenshotShortcut: { enabled: false, accelerator: 'Ctrl+Shift+M', registered: false, error: null },
    ...over,
  };
}

/** A Windows host with SKPORT, screen capture and the global shortcut. */
function mockFullDesktop(initial: ConnectorStatus) {
  const base = mockDesktop(initial);
  let status = initial;
  let ocrListener: ((payload: ScreenshotOcrResult) => void) | undefined;
  let stoppedListener: ((gameId: string) => void) | undefined;
  const skportRefresh = vi.fn<(gameId: string, options?: { auto?: boolean }) => Promise<HoyolabRefreshResult>>();
  const capture = vi.fn<(mode?: 'snip' | 'window') => Promise<ScreenshotOcrResult | null>>();
  const connectors: DesktopConnectors = {
    ...base.connectors,
    status: vi.fn(async () => status),
    skport: {
      login: vi.fn(async () => status),
      disconnect: vi.fn(async () => status),
      link: vi.fn(async (gameId: string, uid: string | null, region: string | null) => {
        const gameLinks = { ...status.skport!.gameLinks };
        if (uid && region) gameLinks[gameId] = { presetKey: 'endfield', uid, region };
        else delete gameLinks[gameId];
        status = { ...status, skport: { ...status.skport!, gameLinks } };
        return status;
      }),
      refresh: skportRefresh,
      setPrefs: vi.fn(async (changes: { autoRefreshOnExit?: boolean }) => {
        status = { ...status, skport: { ...status.skport!, ...changes } };
        return status;
      }),
    },
    screenshot: {
      ...base.connectors.screenshot,
      capture,
      setShortcut: vi.fn(async (enabled: boolean, accelerator: string | null) => {
        status = {
          ...status,
          screenshotShortcut: {
            ...status.screenshotShortcut!,
            enabled,
            accelerator: accelerator ?? status.screenshotShortcut!.accelerator,
          },
        };
        return status;
      }),
    },
    onScreenshotOcr: vi.fn((listener: (payload: ScreenshotOcrResult) => void) => {
      ocrListener = listener;
      return () => {
        ocrListener = undefined;
      };
    }),
  };
  window.memoriaDesktop = {
    version: 1,
    connectors,
    presence: {
      onGameStopped: (listener: (gameId: string) => void) => {
        stoppedListener = listener;
        return () => undefined;
      },
    },
  } as unknown as DesktopHost;
  return {
    connectors,
    skportRefresh,
    capture,
    emitOcr: (payload: ScreenshotOcrResult) => ocrListener?.(payload),
    stopGame: (gameId: string) => stoppedListener?.(gameId),
  };
}

/** Counts how often the confirmation sheet is asked to open. */
function countPendingOpens() {
  let count = 0;
  const onOpen = () => count++;
  window.addEventListener(PENDING_SCREENSHOT_EVENT, onOpen);
  return {
    get count() {
      return count;
    },
    stop: () => window.removeEventListener(PENDING_SCREENSHOT_EVENT, onOpen),
  };
}

describe('SKPORT · Arknights: Endfield', () => {
  it('explains that SKPORT needs an app in a plain browser', () => {
    addPreset('endfield');
    render(<Connections />);
    expect(screen.getByText(/through SKPORT work only in the Windows or Android app/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in to SKPORT' })).not.toBeInTheDocument();
  });

  it('offers sign-in when SKPORT is not connected', async () => {
    const { connectors } = mockFullDesktop(
      fullStatus({
        skport: { connected: false, maskedUid: null, roles: [], gameLinks: {}, autoRefreshOnExit: false },
      }),
    );
    render(<Connections />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to SKPORT' }));
    await waitFor(() => expect(connectors.skport!.login).toHaveBeenCalled());
  });

  it('links an Endfield account, reads Sanity and Daily Activity, and shows SKPORT as the source', async () => {
    const gameId = addPreset('endfield');
    const sanity = resourceNamed(gameId, 'Sanity');
    const daily = taskByKey(gameId, 'endfield-daily-activity');
    const { connectors, skportRefresh } = mockFullDesktop(fullStatus());
    render(<Connections />);

    await screen.findByText('Connected · 12****90');
    fireEvent.click(screen.getByRole('switch', { name: 'Refresh when Endfield closes' }));
    await waitFor(() => expect(connectors.skport!.setPrefs).toHaveBeenCalledWith({ autoRefreshOnExit: true }));

    const account = screen.getByRole('combobox', { name: 'SKPORT account for Arknights: Endfield' });
    fireEvent.keyDown(account, { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'Endmin · Lv. 40 · 1234567890 · Americas/Europe' }));
    await waitFor(() => expect(connectors.skport!.link).toHaveBeenCalledWith(gameId, '1234567890', '2'));

    const observedAt = Date.now();
    skportRefresh.mockResolvedValueOnce({
      ok: true,
      retcode: 0,
      backoffUntilMs: null,
      presetKey: 'endfield',
      observedAt,
      raw: ENDFIELD_CARD,
      error: null,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh now: Arknights: Endfield' }));
    await waitFor(() => expect(latest(sanity.id)?.value).toBe(150));
    expect(skportRefresh).toHaveBeenCalledWith(gameId, { auto: false });
    expect(latest(sanity.id)?.provenance).toEqual(
      expect.objectContaining({ kind: 'account', provider: 'skport', observedAt }),
    );
    expect(liveCompletion(daily.id)?.done).toBe(true);
    const source = readingSource(latest(sanity.id), observedAt + 2 * 60_000)!;
    expect(`${source.label} · ${source.age}`).toBe('SKPORT · 2m ago');
    expect(useUI.getState().undoNotice?.text).toBe('Read live numbers for Arknights: Endfield');

    skportRefresh.mockResolvedValueOnce({
      ok: false,
      retcode: 10001,
      backoffUntilMs: null,
      presetKey: 'endfield',
      observedAt,
      raw: null,
      error: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh now: Arknights: Endfield' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('SKPORT no longer accepts this sign-in');
  });

  it('reads a linked Endfield once when the game closes, if asked to', async () => {
    const gameId = addPreset('endfield');
    const sanity = resourceNamed(gameId, 'Sanity');
    const { skportRefresh, stopGame } = mockFullDesktop(
      fullStatus({
        skport: {
          connected: true,
          maskedUid: '12****90',
          roles: [SKPORT_ROLE],
          gameLinks: { [gameId]: { presetKey: 'endfield', uid: '1234567890', region: '2' } },
          autoRefreshOnExit: true,
        },
      }),
    );
    skportRefresh.mockResolvedValue({
      ok: true,
      retcode: 0,
      backoffUntilMs: null,
      presetKey: 'endfield',
      observedAt: Date.now(),
      raw: ENDFIELD_CARD,
      error: null,
    });
    const stop = initConnectors();
    try {
      await waitFor(() => expect(useConnectors.getState().status?.skport?.autoRefreshOnExit).toBe(true));
      stopGame(gameId);
      await waitFor(() => expect(latest(sanity.id)?.value).toBe(150));
      expect(skportRefresh).toHaveBeenCalledWith(gameId, { auto: true });
      expect(useUI.getState().undoNotice).toBeNull();
    } finally {
      stop();
    }
  });
});

describe('Screen capture and the global shortcut', () => {
  it('turns the shortcut on, records new keys, resets them and warns about a conflict', async () => {
    const { connectors } = mockFullDesktop(fullStatus());
    const setShortcut = vi.mocked(connectors.screenshot.setShortcut!);
    render(<Connections />);

    fireEvent.click(await screen.findByRole('switch', { name: 'Global screenshot shortcut' }));
    await waitFor(() => expect(setShortcut).toHaveBeenCalledWith(true, 'Ctrl+Shift+M'));
    expect(screen.queryByRole('button', { name: /^Reset shortcut/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Change shortcut, now Ctrl+Shift+M' }));
    const recorder = screen.getByRole('button', { name: 'Press shortcut… (Esc cancels)' });
    // A bare letter needs a modifier.
    fireEvent.keyDown(recorder, { key: 'k', code: 'KeyK' });
    expect(screen.getByText('Add Ctrl, Alt or Shift to that key.')).toBeInTheDocument();
    expect(setShortcut).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(recorder, { key: 'K', code: 'KeyK', ctrlKey: true, altKey: true });
    await waitFor(() => expect(setShortcut).toHaveBeenLastCalledWith(true, 'Ctrl+Alt+K'));
    await screen.findByRole('button', { name: 'Change shortcut, now Ctrl+Alt+K' });

    // Esc cancels without a change.
    fireEvent.click(screen.getByRole('button', { name: 'Change shortcut, now Ctrl+Alt+K' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Press shortcut… (Esc cancels)' }), {
      key: 'Escape',
      code: 'Escape',
    });
    expect(setShortcut).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Reset shortcut to Ctrl+Shift+M' }));
    await waitFor(() => expect(setShortcut).toHaveBeenLastCalledWith(true, 'Ctrl+Shift+M'));

    act(() => {
      useConnectors.setState({
        status: fullStatus({
          screenshotShortcut: {
            enabled: true,
            accelerator: 'Ctrl+Shift+M',
            registered: false,
            error: 'Another program already uses it.',
          },
        }),
      });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Another program already uses it.');
  });

  it('snips and captures the window from Settings', async () => {
    const { capture } = mockFullDesktop(fullStatus());
    capture.mockResolvedValue(null);
    render(<Connections />);
    fireEvent.click(await screen.findByRole('button', { name: 'Snip screen' }));
    await waitFor(() => expect(capture).toHaveBeenCalledWith('snip'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Capture window' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Capture window' }));
    await waitFor(() => expect(capture).toHaveBeenCalledWith('window'));
    expect(screen.getByRole('button', { name: 'Read a screenshot…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Watch folder…' })).toBeInTheDocument();
  });

  it('opens the confirmation once for a window capture while the host is listening', async () => {
    const gameId = addPreset('genshin');
    const { capture, emitOcr } = mockFullDesktop(fullStatus());
    const reading: ScreenshotOcrResult = {
      fileName: 'Screen capture',
      observedAt: Date.now(),
      lines: ['Original Resin 120/200'],
      dataUrl: 'data:image/jpeg;base64,AA',
      processName: 'GenshinImpact',
    };
    // The host both emits the reading and, for a window, resolves with it.
    capture.mockImplementation(async (mode) => {
      emitOcr(reading);
      return mode === 'window' ? reading : null;
    });
    const opens = countPendingOpens();
    const stop = initConnectors();
    try {
      await captureScreenshot('window');
      expect(opens.count).toBe(1);
      expect(useConnectors.getState().pendingScreenshot).toEqual(
        expect.objectContaining({ gameId, source: 'windows-ocr', dataUrl: reading.dataUrl }),
      );
      await captureScreenshot('snip');
      expect(opens.count).toBe(2);
    } finally {
      stop();
      opens.stop();
    }
  });

  it('opens a returned window reading itself when nothing is listening', async () => {
    addPreset('genshin');
    const { capture } = mockFullDesktop(fullStatus());
    capture.mockResolvedValue({ fileName: 'Screen capture', observedAt: Date.now(), lines: ['120/200'] });
    const opens = countPendingOpens();
    try {
      await captureScreenshot('window');
      expect(opens.count).toBe(1);
    } finally {
      opens.stop();
    }
  });

  it('forwards the preview of a picked screenshot', async () => {
    addPreset('genshin');
    const { connectors } = mockFullDesktop(fullStatus());
    vi.mocked(connectors.screenshot.pick).mockResolvedValueOnce({
      fileName: 'shot.png',
      observedAt: Date.now(),
      lines: ['120/200'],
      dataUrl: 'data:image/jpeg;base64,BB',
    });
    await pickScreenshotFile();
    expect(useConnectors.getState().pendingScreenshot?.dataUrl).toBe('data:image/jpeg;base64,BB');
  });
});

describe('Screenshot game choice', () => {
  it('picks the game whose program was captured, even when caps are shared', () => {
    addPreset('zzz');
    const wuwa = addPreset('wuwa');
    const nte = addPreset('nte');
    const open = (processName: string | null) =>
      act(() => {
        openScreenshotOcr({
          fileName: 'Screen capture',
          observedAt: Date.now(),
          lines: ['120/240'],
          processName,
          source: 'windows-ocr',
        });
      });

    open('Wuthering Waves');
    expect(useConnectors.getState().pendingScreenshot?.gameId).toBe(wuwa);
    expect(useConnectors.getState().pendingScreenshot?.candidates[0]).toEqual(
      expect.objectContaining({ resourceName: 'Waveplates', value: 120 }),
    );
    open('NTE.exe');
    expect(useConnectors.getState().pendingScreenshot?.gameId).toBe(nte);
    open('nte');
    expect(useConnectors.getState().pendingScreenshot?.gameId).toBe(nte);
  });

  it('shows the capture preview in the confirmation sheet', () => {
    addPreset('genshin');
    act(() => {
      openScreenshotOcr({
        fileName: 'Screen capture',
        observedAt: Date.now(),
        lines: ['Original Resin 120/200'],
        dataUrl: 'data:image/jpeg;base64,AA',
        source: 'windows-ocr',
      });
    });
    render(<ScreenshotConfirm />);
    // The sheet renders in a portal, outside the render container.
    expect(document.querySelector('img[src="data:image/jpeg;base64,AA"]')).toBeInTheDocument();
  });
});

describe('Saved captures', () => {
  function mockCaptures(captures: { count: number; bytes: number }) {
    const status: ConnectorStatus = { ...connectedStatus(), screenshotCaptures: captures };
    const { connectors } = mockDesktop(status);
    const openCaptures = vi.fn(async () => undefined);
    const clearCaptures = vi.fn(async () => ({ ...status, screenshotCaptures: { count: 0, bytes: 0 } }));
    connectors.status = vi.fn(async () => status);
    connectors.screenshot = { ...connectors.screenshot, openCaptures, clearCaptures };
    return { openCaptures, clearCaptures };
  }

  it('explains the folder and keeps Clear off while it is empty', async () => {
    const { openCaptures } = mockCaptures({ count: 0, bytes: 0 });
    render(<Connections />);
    expect(await screen.findByText(/saved to their own folder so you can clear them anytime/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear captures' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    await waitFor(() => expect(openCaptures).toHaveBeenCalled());
  });

  it('shows the count and size, and clears after a confirmation', async () => {
    const { clearCaptures } = mockCaptures({ count: 3, bytes: 5_452_595 });
    render(
      <>
        <Connections />
        <ConfirmHost />
      </>,
    );
    const hint = await screen.findByText(/in Memoria’s captures folder/);
    expect(hint).toHaveTextContent('3 saved captures · 5.2 MB in Memoria’s captures folder.');

    fireEvent.click(screen.getByRole('button', { name: 'Clear captures' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Clear saved captures?');
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear captures' }).at(-1)!);
    await waitFor(() => expect(clearCaptures).toHaveBeenCalled());
    expect(await screen.findByText('Cleared 3 saved captures.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clear captures' })).toBeDisabled());
  });

  it('formats a single small capture in KB', async () => {
    mockCaptures({ count: 1, bytes: 2048 });
    render(<Connections />);
    expect(await screen.findByText(/in Memoria’s captures folder/)).toHaveTextContent(
      '1 saved capture · 2.0 KB in Memoria’s captures folder.',
    );
  });

  it('names the endgame cycles a manual HoYoLAB refresh read', async () => {
    const gameId = addPreset('genshin');
    const { refresh } = mockDesktop(
      connectedStatus({ gameLinks: { [gameId]: { presetKey: 'genshin', uid: '800000001', region: 'os_asia' } } }),
    );
    refresh.mockResolvedValueOnce({
      ok: true,
      retcode: 0,
      backoffUntilMs: null,
      presetKey: 'genshin',
      observedAt: Date.now(),
      raw: { ...GENSHIN_NOTE, _endgame: { spiralAbyss: { is_unlock: true, total_star: 36 } } },
      error: null,
    });
    render(<Connections />);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh now: Genshin Impact' }));
    await waitFor(() => expect(useUI.getState().undoNotice?.text).toBe('Read Genshin Impact · Spiral Abyss 36/36★'));
  });
});

function TrackCheckInHarness({ gameId }: { gameId: string }) {
  const game = useApp((store) => store.state.games.find((item) => item.id === gameId)!);
  return <GameControls entry={{ game, next: null, actions: [] }} now={Date.now()} />;
}

describe('HoYoLAB daily check-in claiming', () => {
  it('claims HoYoLAB check-in from Track and offers Retry + Open on verification failure', async () => {
    const gameId = addPreset('genshin');
    const checkinTask = taskByKey(gameId, 'genshin-hoyolab');
    const checkin = vi.fn<(id: string) => Promise<HoyolabCheckInResult>>();
    const status = connectedStatus({
      gameLinks: { [gameId]: { presetKey: 'genshin', uid: '800000001', region: 'os_asia' } },
    });
    const { connectors } = mockDesktop(status);
    connectors.hoyolab.checkin = checkin;
    useConnectors.setState({ status });

    render(
      <TooltipProvider>
        <TrackCheckInHarness gameId={gameId} />
      </TooltipProvider>,
    );

    const claim = screen.getByRole('button', { name: 'Claim HoYoLAB daily check-in' });
    checkin.mockResolvedValueOnce({
      ok: false,
      status: 'captcha',
      retcode: 5001,
      message: 'HoYoLAB asked for verification. Open the check-in page to claim.',
    });
    fireEvent.click(claim);
    expect(await screen.findByText('Verify')).toBeInTheDocument();
    expect(screen.getByText('HoYoLAB asked for verification. Open the check-in page to claim.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open HoYoLAB daily check-in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Claim HoYoLAB daily check-in' })).toHaveTextContent('Retry');
    expect(liveCompletion(checkinTask.id)?.done ?? false).toBe(false);

    checkin.mockResolvedValueOnce({
      ok: true,
      status: 'claimed',
      retcode: 0,
      message: 'Claimed HoYoLAB daily check-in.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Claim HoYoLAB daily check-in' }));
    await waitFor(() => expect(liveCompletion(checkinTask.id)?.done).toBe(true));
    expect(useUI.getState().undoNotice?.text).toBe('Claimed HoYoLAB daily check-in');
  });

  it('claims HoYoLAB check-in from Today steps and exposes Open fallback on captcha', async () => {
    const gameId = addPreset('genshin');
    const checkinTask = taskByKey(gameId, 'genshin-hoyolab');
    const checkin = vi.fn<(id: string) => Promise<HoyolabCheckInResult>>();
    const status = connectedStatus({
      gameLinks: { [gameId]: { presetKey: 'genshin', uid: '800000001', region: 'os_asia' } },
    });
    const { connectors } = mockDesktop(status);
    connectors.hoyolab.checkin = checkin;
    useConnectors.setState({ status });
    useUI.setState({ todayView: 'steps' });

    render(
      <TooltipProvider>
        <TodayPage now={Date.now()} />
      </TooltipProvider>,
    );

    const more = screen.queryByRole('button', { name: /Show \d+ more/ });
    if (more) fireEvent.click(more);

    checkin.mockResolvedValueOnce({
      ok: false,
      status: 'captcha',
      retcode: 5001,
      message: 'HoYoLAB asked for verification. Open the check-in page to claim.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Claim HoYoLAB daily check-in' }));
    expect(await screen.findByText('Verify')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open HoYoLAB daily check-in' })).toBeInTheDocument();
    expect(liveCompletion(checkinTask.id)?.done ?? false).toBe(false);

    checkin.mockResolvedValueOnce({
      ok: true,
      status: 'already',
      retcode: -5003,
      message: 'Already checked in on HoYoLAB today.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Claim HoYoLAB daily check-in' }));
    await waitFor(() => expect(liveCompletion(checkinTask.id)?.done).toBe(true));
    expect(useUI.getState().undoNotice?.text).toBe('Already checked in on HoYoLAB today');
  });
});

const DAY = 86_400_000;

/** One open endgame cycle for the game, alone on its timeline so the matcher cannot pick a seeded one. */
function cycleEvent(gameId: string, name: string, over: { done?: boolean; partsDone?: number } = {}): string {
  const id = `cycle-${name.toLowerCase().replace(/\W+/g, '-')}`;
  act(() => {
    for (const event of useApp.getState().state.events) {
      if (event.gameId === gameId && event.type === 'cycle' && !event.deleted) useApp.getState().deleteEvent(event.id);
    }
    useApp.getState().upsertEvent({
      id,
      gameId,
      name,
      type: 'cycle',
      start: Date.now() - 3 * DAY,
      end: Date.now() + 10 * DAY,
      ...over,
    });
  });
  return id;
}

function eventById(id: string) {
  return useApp.getState().state.events.find((event) => event.id === id)!;
}

describe('store.applyScreenshotReadings', () => {
  it('ticks the task period the screenshot was taken in, not the one open now', () => {
    const gameId = addPreset('genshin');
    const commissions = taskByKey(gameId, 'genshin-commissions');
    const observedAt = Date.now() - 3 * DAY;
    act(() =>
      useApp.getState().applyScreenshotReadings({
        gameId,
        observedAt,
        provider: 'file',
        readings: [],
        tasks: [{ taskId: commissions.id, action: 'done' }],
      }),
    );
    const game = gameById(gameId);
    const row = liveCompletion(commissions.id)!;
    expect(row.periodKey).toBe(taskPeriodKey(game, commissions, observedAt));
    expect(row.periodKey).not.toBe(taskPeriodKey(game, commissions, Date.now()));
    expect(row.provenance).toEqual(expect.objectContaining({ kind: 'screenshot', observedAt }));
  });

  it('saves endgame progress in the same batch as bars, tasks and savings, under one Undo', () => {
    const gameId = addPreset('genshin');
    const resin = resourceNamed(gameId, 'Original Resin');
    const commissions = taskByKey(gameId, 'genshin-commissions');
    const abyss = cycleEvent(gameId, 'Spiral Abyss');
    const journal = useApp.getState().history.journal.length;
    act(() =>
      useApp.getState().applyScreenshotReadings({
        gameId,
        observedAt: Date.now(),
        provider: 'windows-ocr',
        readings: [{ resourceId: resin.id, value: 90 }],
        tasks: [{ taskId: commissions.id, action: 'done' }],
        savings: { currency: 1600 },
        events: [
          { eventId: abyss, progress: 'done' },
          { eventId: 'missing', progress: 'done' },
        ],
      }),
    );
    expect(useApp.getState().history.journal.length).toBe(journal + 1);
    expect(eventById(abyss).done).toBe(true);
    expect(latest(resin.id)?.value).toBe(90);

    act(() => useApp.getState().undoActivity(useApp.getState().history.journal.at(-1)!.id));
    expect(eventById(abyss).done ?? false).toBe(false);
    expect(latest(resin.id)?.value).not.toBe(90);
    expect(liveCompletion(commissions.id)?.done ?? false).toBe(false);
    expect(gameById(gameId).savings?.currency ?? 0).not.toBe(1600);
  });
});

describe('ScreenshotConfirm · bars, tasks, endgame cycles and savings', () => {
  it('saves all four together with one Undo', () => {
    const gameId = addPreset('genshin');
    const resin = resourceNamed(gameId, 'Original Resin');
    const commissions = taskByKey(gameId, 'genshin-commissions');
    const abyss = cycleEvent(gameId, 'Spiral Abyss');
    act(() => {
      openScreenshotOcr({
        fileName: 'all.png',
        observedAt: Date.now(),
        lines: ['Original Resin 145/200', 'Daily Commissions 4/4', 'Primogems 14,250', 'Spiral Abyss 36/36 ★'],
        source: 'windows-ocr',
      });
    });
    render(<ScreenshotConfirm />);
    const cycles = screen.getByRole('region', { name: 'Endgame cycles' });
    expect(within(cycles).getByText('36/36 ★')).toBeInTheDocument();
    expect(within(cycles).getByLabelText('Include Spiral Abyss')).toBeChecked();
    expect(within(cycles).getByRole('radio', { name: 'Done' })).toBeChecked();

    const journal = useApp.getState().history.journal.length;
    fireEvent.click(screen.getByRole('button', { name: 'Save 4 updates' }));
    expect(useApp.getState().history.journal.length).toBe(journal + 1);
    expect(latest(resin.id)?.value).toBe(145);
    expect(liveCompletion(commissions.id)?.done).toBe(true);
    expect(gameById(gameId).savings?.currency).toBe(14250);
    expect(eventById(abyss).done).toBe(true);
    expect(useUI.getState().undoNotice?.text).toBe('Saved 4 updates from a screenshot');
    undoLast();
    expect(eventById(abyss).done ?? false).toBe(false);
    expect(liveCompletion(commissions.id)?.done ?? false).toBe(false);
  });

  it('starts a cycle that is already done unticked, with a note, so OCR never lowers it', () => {
    const gameId = addPreset('genshin');
    cycleEvent(gameId, 'Spiral Abyss', { done: true });
    act(() => {
      openScreenshotOcr({
        fileName: 'abyss.png',
        observedAt: Date.now(),
        lines: ['Spiral Abyss 30/36 ★'],
        source: 'windows-ocr',
      });
    });
    render(<ScreenshotConfirm />);
    const cycles = screen.getByRole('region', { name: 'Endgame cycles' });
    expect(within(cycles).getByLabelText('Include Spiral Abyss')).not.toBeChecked();
    expect(within(cycles).getByText('Already marked done')).toBeInTheDocument();
  });

  it('types everything in by hand with no OCR text, as on Android or the web', () => {
    const gameId = addPreset('genshin');
    const resin = resourceNamed(gameId, 'Original Resin');
    const commissions = taskByKey(gameId, 'genshin-commissions');
    const abyss = cycleEvent(gameId, 'Spiral Abyss');
    act(() => {
      openScreenshotOcr({
        fileName: 'shared.png',
        observedAt: Date.now(),
        dataUrl: 'data:image/png;base64,AA',
        source: 'android-share',
      });
    });
    render(<ScreenshotConfirm />);
    expect(screen.queryByText(/Recognised text/)).not.toBeInTheDocument();
    // The fallback bar waits for a number and says so, instead of a silently disabled Save.
    expect(screen.getByText('Type a number from 0 to 200, or untick this bar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save reading' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Original Resin value'), { target: { value: '100' } });

    fireEvent.click(screen.getByRole('button', { name: 'Include a task' }));
    fireEvent.click(screen.getByLabelText(`Include ${commissions.name}`));
    fireEvent.click(screen.getByRole('button', { name: 'Include an endgame cycle' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Partly done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Include savings' }));
    fireEvent.change(screen.getByLabelText('Premium currency value'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Pull tickets value'), { target: { value: '7' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save 5 updates' }));
    expect(latest(resin.id)).toEqual(
      expect.objectContaining({ value: 100, provenance: expect.objectContaining({ provider: 'android-share' }) }),
    );
    expect(liveCompletion(commissions.id)?.done).toBe(true);
    expect(eventById(abyss)).toEqual(expect.objectContaining({ done: false, partsDone: 1 }));
    expect(gameById(gameId).savings).toEqual(expect.objectContaining({ currency: 500, tickets: 7 }));
  });

  it('saves savings for a game with no bars at all', () => {
    const gameId = useApp.getState().addBlankGame('Side Game');
    for (const res of useApp.getState().state.resources.filter((item) => item.gameId === gameId)) {
      act(() => useApp.getState().deleteResource(res.id));
    }
    act(() => {
      openScreenshotOcr({ fileName: 'side.png', observedAt: Date.now(), source: 'file' });
    });
    render(<ScreenshotConfirm />);
    expect(screen.queryByText('This game has no bar to read into.')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Bars & reserves' })).not.toBeInTheDocument();
    expect(screen.getByText('Tick at least one row to save.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Include savings' }));
    fireEvent.change(screen.getByLabelText('Premium currency value'), { target: { value: '320' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reading' }));
    expect(gameById(gameId).savings?.currency).toBe(320);
    expect(useUI.getState().undoNotice?.text).toBe('Saved Premium currency from a screenshot');
  });

  it('starts the fallback bar unticked for a tasks-only snip, so Save is ready at once', () => {
    const gameId = addPreset('genshin');
    const resin = resourceNamed(gameId, 'Original Resin');
    const commissions = taskByKey(gameId, 'genshin-commissions');
    const before = latest(resin.id)?.id;
    act(() => {
      openScreenshotOcr({
        fileName: 'tasks.png',
        observedAt: Date.now(),
        lines: ['Daily Commissions 4/4'],
        source: 'windows-ocr',
      });
    });
    render(<ScreenshotConfirm />);
    expect(screen.getByLabelText('Include Original Resin')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save reading' }));
    expect(liveCompletion(commissions.id)?.done).toBe(true);
    expect(latest(resin.id)?.id).toBe(before);
  });

  it('ties an out-of-range or empty value to an inline error', () => {
    addPreset('genshin');
    act(() => {
      openScreenshotOcr({
        fileName: 'resin.png',
        observedAt: Date.now(),
        lines: ['Original Resin 145/200'],
        source: 'windows-ocr',
      });
    });
    render(<ScreenshotConfirm />);
    const input = screen.getByLabelText('Original Resin value');
    expect(input).not.toHaveAttribute('aria-invalid');

    fireEvent.change(input, { target: { value: '999' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)).toHaveTextContent(
      'Use a number from 0 to 200.',
    );
    expect(screen.getByRole('button', { name: 'Save reading' })).toBeDisabled();

    fireEvent.change(input, { target: { value: '' } });
    expect(document.getElementById(input.getAttribute('aria-describedby')!)).toHaveTextContent(
      'Type a number from 0 to 200, or untick this bar.',
    );

    fireEvent.change(input, { target: { value: '150' } });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('button', { name: 'Save reading' })).toBeEnabled();
  });

  it('starts a bar unticked when the screenshot is older than its last reading', () => {
    const gameId = addPreset('genshin');
    const resin = resourceNamed(gameId, 'Original Resin');
    act(() => useApp.getState().setEnergy(resin.id, 50));
    act(() => {
      openScreenshotOcr({
        fileName: 'old.png',
        observedAt: Date.now() - 10 * 60_000,
        lines: ['Original Resin 120/200'],
        source: 'file',
      });
    });
    render(<ScreenshotConfirm />);
    expect(screen.getByLabelText('Include Original Resin')).not.toBeChecked();
    expect(screen.getByText('Older than your last reading')).toBeInTheDocument();
    expect(screen.getByLabelText('Original Resin value')).toHaveValue(120);
  });

  it('asks before Escape or Dismiss drop edits, and closes at once without them', async () => {
    addPreset('genshin');
    const open = () =>
      act(() => {
        openScreenshotOcr({
          fileName: 'resin.png',
          observedAt: Date.now(),
          lines: ['Original Resin 145/200'],
          source: 'windows-ocr',
        });
      });
    open();
    render(
      <>
        <ScreenshotConfirm />
        <ConfirmHost />
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(useConnectors.getState().pendingScreenshot).toBeNull());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    open();
    fireEvent.change(await screen.findByLabelText('Original Resin value'), { target: { value: '150' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    let question = await screen.findByRole('alertdialog', { name: 'Discard your unsaved changes?' });
    fireEvent.click(within(question).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(useConnectors.getState().pendingScreenshot).not.toBeNull();
    expect(screen.getByLabelText('Original Resin value')).toHaveValue(150);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    question = await screen.findByRole('alertdialog', { name: 'Discard your unsaved changes?' });
    fireEvent.click(within(question).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(useConnectors.getState().pendingScreenshot).toBeNull());
  });

  it('expands the preview on a tap and lists what was recognised, region by region', () => {
    addPreset('genshin');
    act(() => {
      openScreenshotOcr({
        fileName: 'Screen capture',
        observedAt: Date.now(),
        lines: ['Original Resin 145/200', '', 'Primogems 14,250'],
        regionCount: 2,
        dataUrl: 'data:image/jpeg;base64,AA',
        source: 'windows-ocr',
      });
    });
    render(<ScreenshotConfirm />);
    const preview = screen.getByRole('button', { name: 'Expand screenshot' });
    expect(preview).toHaveAttribute('aria-expanded', 'false');
    expect(preview.querySelector('img')).toHaveClass('max-h-56');
    fireEvent.click(preview);
    expect(screen.getByRole('button', { name: 'Shrink screenshot' })).toHaveAttribute('aria-expanded', 'true');
    expect(preview.querySelector('img')).toHaveClass('max-h-none');

    expect(screen.getByText('2 regions captured')).toBeInTheDocument();
    expect(screen.getByText('Recognised text (2 lines)')).toBeInTheDocument();
    expect(screen.getByText('Region 1')).toBeInTheDocument();
    expect(screen.getByText('Region 2')).toBeInTheDocument();
  });
});

describe('ScreenshotConfirm · more captures while it is open', () => {
  it('merges a second snip of the same game, keeps edits and adds its new matches', () => {
    const gameId = addPreset('genshin');
    const resin = resourceNamed(gameId, 'Original Resin');
    const abyss = cycleEvent(gameId, 'Spiral Abyss');
    act(() => {
      openScreenshotOcr({
        fileName: 'snip-1',
        observedAt: Date.now() - 60_000,
        lines: ['Original Resin 145/200'],
        source: 'windows-ocr',
      });
    });
    render(<ScreenshotConfirm />);
    const first = useConnectors.getState().pendingScreenshot!;
    fireEvent.change(screen.getByLabelText('Original Resin value'), { target: { value: '150' } });

    act(() => {
      openScreenshotOcr({
        fileName: 'snip-2',
        observedAt: Date.now(),
        lines: ['Primogems 14,250', 'Spiral Abyss 36/36 ★'],
        regionCount: 2,
        source: 'windows-ocr',
      });
    });

    const merged = useConnectors.getState().pendingScreenshot!;
    expect(merged).toEqual(
      expect.objectContaining({ captureKey: first.captureKey, revision: 1, regionCount: 3, gameId }),
    );
    expect(merged.lines).toEqual(['Original Resin 145/200', '', 'Primogems 14,250', 'Spiral Abyss 36/36 ★']);
    expect(merged.observedAt).toBeGreaterThan(first.observedAt);
    expect(screen.getByLabelText('Original Resin value')).toHaveValue(150);
    expect(screen.getByLabelText('Primogems value')).toHaveValue(14250);
    expect(screen.getByText('36/36 ★')).toBeInTheDocument();
    expect(screen.getByText('3 regions captured')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save 3 updates' }));
    expect(latest(resin.id)?.value).toBe(150);
    expect(gameById(gameId).savings?.currency).toBe(14250);
    expect(eventById(abyss).done).toBe(true);
  });

  it('replaces the waiting screenshot when a capture names another game', () => {
    addPreset('genshin');
    const hsr = addPreset('hsr');
    act(() => {
      openScreenshotOcr({
        fileName: 'genshin',
        observedAt: Date.now(),
        lines: ['Original Resin 145/200'],
        source: 'windows-ocr',
      });
    });
    const first = useConnectors.getState().pendingScreenshot!;
    render(<ScreenshotConfirm />);
    act(() => {
      openScreenshotOcr({
        fileName: 'hsr',
        observedAt: Date.now(),
        lines: ['Trailblaze Power 180/300'],
        source: 'windows-ocr',
      });
    });
    const next = useConnectors.getState().pendingScreenshot!;
    expect(next).toEqual(expect.objectContaining({ gameId: hsr, revision: 0, regionCount: 1 }));
    expect(next.captureKey).not.toBe(first.captureKey);
    expect(next.lines).toEqual(['Trailblaze Power 180/300']);
    expect(screen.getByLabelText('Trailblaze Power value')).toHaveValue(180);
  });

  it('snips another area from the sheet in the Windows app and merges it in', async () => {
    addPreset('genshin');
    const { capture, emitOcr } = mockFullDesktop(fullStatus());
    const stop = initConnectors();
    try {
      act(() =>
        emitOcr({
          fileName: 'Screen capture',
          observedAt: Date.now(),
          lines: ['Original Resin 145/200'],
          processName: 'GenshinImpact',
        }),
      );
      render(<ScreenshotConfirm />);
      capture.mockImplementation(async () => {
        emitOcr({
          fileName: 'Screen capture',
          observedAt: Date.now(),
          lines: ['Primogems 14,250'],
          processName: 'GenshinImpact',
          regionCount: 1,
        });
        return null;
      });
      fireEvent.click(screen.getByRole('button', { name: 'Snip another area' }));
      await waitFor(() => expect(capture).toHaveBeenCalledWith('snip'));
      expect(await screen.findByLabelText('Primogems value')).toHaveValue(14250);
      expect(screen.getByText('2 regions captured')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Read whole window' })).toBeInTheDocument();
    } finally {
      stop();
    }
  });
});

describe('Connector notices', () => {
  it('announces warnings and errors beyond Settings, but not a routine status', () => {
    const heard: ConnectorNotice[] = [];
    const listen = (event: Event) => heard.push((event as CustomEvent<ConnectorNotice>).detail);
    window.addEventListener(CONNECTOR_NOTICE_EVENT, listen);
    try {
      setConnectorNotice({ tone: 'ok', text: 'Fine.' });
      setConnectorNotice({ tone: 'error', text: 'The screen could not be read.' });
      setConnectorNotice({ tone: 'warn', text: 'Wait a moment.' }, { announce: false });
      setConnectorNotice(null);
      expect(heard).toEqual([{ tone: 'error', text: 'The screen could not be read.' }]);
    } finally {
      window.removeEventListener(CONNECTOR_NOTICE_EVENT, listen);
    }
  });

  it('shares one store with the light state module', () => {
    expect(useConnectorsState).toBe(useConnectors);
  });

  it('drops a stale notice when Connections opens, but keeps a fresh one', () => {
    setConnectorNotice({ tone: 'error', text: 'An old failure.' });
    useConnectors.setState({ noticeAt: Date.now() - 60_000 });
    const { unmount } = render(<Connections />);
    expect(screen.queryByText('An old failure.')).not.toBeInTheDocument();
    unmount();

    setConnectorNotice({ tone: 'error', text: 'A new failure.' });
    render(<Connections />);
    expect(screen.getByRole('alert')).toHaveTextContent('A new failure.');
  });
});
