import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  GamePitySchema,
  hoyolabErrorGuidance,
  importGachaHistory,
  mapHoyolabNote,
  mapSkportEndfieldCard,
  inferScreenshotGame,
  matchOcrReadings,
  matchScreenshotOcrPasses,
  parseGachaExport,
  presetForGame,
  skportErrorGuidance,
  type GachaImportSummary,
  type GachaPresetKey,
  type Game,
  type HoyolabPresetKey,
  type OcrCapture,
  type OcrPass,
  type OcrScreenshotInput,
  type OcrScreenshotMatches,
  type Resource,
  type SkportPresetKey,
  type Task,
} from '@memoria/shared';
import type {
  BrowserProvider,
  ConnectorStatus,
  DesktopConnectors,
  HoyolabCheckInResult,
  HoyolabRedeemResult,
  HoyolabRefreshResult,
  ScreenshotOcrResult,
} from './desktop-host';
import {
  hasAndroidConnector,
  inBackoff,
  PENDING_SCREENSHOT_EVENT,
  setConnectorNotice,
  useConnectors,
  type PendingScreenshot,
  type ScreenshotSource,
} from './connectors-state';
import { useApp } from './store';
import { useUI } from './ui-store';

export {
  clearConnectorNotice,
  CONNECTOR_NOTICE_EVENT,
  connectorRuntime,
  inBackoff,
  isHoyolabLinked,
  PENDING_SCREENSHOT_EVENT,
  setConnectorNotice,
  useConnectors,
  useHoyolabLinked,
  type ConnectorNotice,
  type PendingScreenshot,
  type ScreenshotSource,
} from './connectors-state';

/**
 * Opt-in live numbers: HoYoLAB Real-Time Notes, the SKPORT Endfield card,
 * pull-history import and the screenshot reader. Loaded on demand, never on the startup path.
 *
 * Sign-in cookies, history links and folder paths live in the native host
 * (DPAPI on Windows, the Keystore on Android). This page only ever sees a
 * status, the numbers that were read and OCR text, and nothing from here is
 * written to app data except the readings themselves.
 */

export const HOYOLAB_PRESETS: readonly HoyolabPresetKey[] = ['genshin', 'hsr', 'zzz'];
export const SKPORT_PRESETS: readonly SkportPresetKey[] = ['endfield'];
export const GACHA_PRESETS: readonly GachaPresetKey[] = ['genshin', 'hsr', 'zzz', 'wuwa'];
/** Screenshots bigger than this are refused before they are read. */
export const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;

/**
 * An image from Android: downscaled, plus what ML Kit read on the phone. `lines`
 * is the reading top to bottom; its one `mlkit` pass carries word boxes as
 * fractions of the image.
 */
interface SharedImage {
  fileName: string;
  observedAt: number;
  dataUrl: string;
  lines?: string[];
  passes?: OcrPass[];
}

type AndroidImageResult = Partial<SharedImage> & { cancelled?: boolean };

interface AndroidConnector {
  status(): Promise<ConnectorStatus>;
  hoyolabLogin(opts?: { fresh?: boolean }): Promise<ConnectorStatus>;
  hoyolabImportBrowser(opts: { raw: string }): Promise<ConnectorStatus>;
  hoyolabDisconnect(): Promise<ConnectorStatus>;
  hoyolabLink(opts: {
    gameId: string;
    presetKey: string;
    uid: string | null;
    region: string | null;
  }): Promise<ConnectorStatus>;
  hoyolabRefresh(opts: { gameId: string; auto?: boolean }): Promise<HoyolabRefreshResult>;
  hoyolabRedeemCode(opts: { gameId: string; code: string }): Promise<HoyolabRedeemResult>;
  hoyolabCheckIn(opts: { gameId: string }): Promise<HoyolabCheckInResult>;
  hoyolabPrefs(opts: { autoRefreshOnExit?: boolean }): Promise<ConnectorStatus>;
  skportLogin(opts?: { fresh?: boolean }): Promise<ConnectorStatus>;
  skportImportBrowser(opts: { raw: string }): Promise<ConnectorStatus>;
  skportDisconnect(): Promise<ConnectorStatus>;
  skportLink(opts: {
    gameId: string;
    presetKey: string;
    uid: string | null;
    region: string | null;
  }): Promise<ConnectorStatus>;
  skportRefresh(opts: { gameId: string; auto?: boolean }): Promise<HoyolabRefreshResult>;
  skportPrefs(opts: { autoRefreshOnExit?: boolean }): Promise<ConnectorStatus>;
  pickScreenshot(): Promise<AndroidImageResult>;
  /** The camera viewfinder (CameraCaptureActivity), read the same way as a picked screenshot. */
  captureScreenshot(): Promise<AndroidImageResult>;
  consumePendingShare(): Promise<{ image: SharedImage | null }>;
  addListener(event: 'statusChanged', listener: (status: ConnectorStatus) => void): Promise<PluginListenerHandle>;
  addListener(
    event: 'screenshotShared',
    listener: (payload: { available: boolean }) => void,
  ): Promise<PluginListenerHandle>;
}

const AndroidConnectorPlugin = registerPlugin<AndroidConnector>('Connector');

function desktop(): DesktopConnectors | undefined {
  return window.memoriaDesktop?.connectors;
}

function android(): AndroidConnector | undefined {
  return hasAndroidConnector() ? AndroidConnectorPlugin : undefined;
}

/** The game's preset key when it is one HoYoLAB can read. */
export function hoyolabPreset(game: Game): HoyolabPresetKey | undefined {
  const key = presetForGame(game)?.key;
  return HOYOLAB_PRESETS.find((preset) => preset === key);
}

/** The game's preset key when SKPORT can read it. */
export function skportPreset(game: Game): SkportPresetKey | undefined {
  const key = presetForGame(game)?.key;
  return SKPORT_PRESETS.find((preset) => preset === key);
}

/** The game's preset key when its pull history can be imported. */
export function gachaPreset(game: Game): GachaPresetKey | undefined {
  const key = presetForGame(game)?.key;
  return GACHA_PRESETS.find((preset) => preset === key);
}

function message(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

function setBusy(key: string, on: boolean): void {
  useConnectors.setState((store) => {
    const busy = { ...store.busy };
    if (on) busy[key] = true;
    else delete busy[key];
    return { busy };
  });
}

function setStatus(status: ConnectorStatus | null | undefined): void {
  if (!status || typeof status !== 'object' || !status.hoyolab) return;
  useConnectors.setState({ status });
  const handoff = useConnectors.getState().activeBrowserHandoff;
  if (handoff) {
    const connected = handoff.provider === 'hoyolab' ? status.hoyolab.connected : status.skport?.connected === true;
    if (connected || status.browserHandoff?.active === false) useConnectors.setState({ activeBrowserHandoff: null });
  }
  // The host repeats its status often; its error stays in Settings rather than announcing each time.
  if (status.error) setConnectorNotice({ tone: 'error', text: status.error }, { announce: false });
}

/** Runs one native call under a busy key; any failure becomes the inline notice. */
async function run<T>(key: string, call: () => Promise<T>, fallback: string): Promise<T | undefined> {
  setBusy(key, true);
  try {
    return await call();
  } catch (error) {
    setConnectorNotice({ tone: 'error', text: message(error, fallback) });
    return undefined;
  } finally {
    setBusy(key, false);
  }
}

export async function loadConnectorStatus(): Promise<ConnectorStatus | null> {
  const host = desktop();
  const native = android();
  if (!host && !native) return null;
  const status = await run('status', () => (host ? host.status() : native!.status()), 'Could not read connections.');
  setStatus(status);
  return status ?? null;
}

/** `fresh` signs in to another account instead of reusing the saved session. */
export async function signInHoyolab(fresh = false): Promise<void> {
  const host = desktop();
  const native = android();
  if (!host && !native) return;
  setConnectorNotice(null);
  const opts = fresh ? { fresh } : undefined;
  setStatus(
    await run(
      'login',
      () => (host ? host.hoyolab.login(opts) : native!.hoyolabLogin(opts)),
      'The HoYoLAB sign-in could not open.',
    ),
  );
}

export async function disconnectHoyolab(): Promise<void> {
  const host = desktop();
  const native = android();
  if (!host && !native) return;
  setConnectorNotice(null);
  const status = await run(
    'disconnect',
    () => (host ? host.hoyolab.disconnect() : native!.hoyolabDisconnect()),
    'Could not sign out of HoYoLAB.',
  );
  setStatus(status);
  if (status) setConnectorNotice({ tone: 'ok', text: 'Signed out. The sign-in was removed from this device.' });
}

/** Links a game to one HoYoLAB role, or unlinks it with a null `uid`. */
export async function linkHoyolabGame(
  gameId: string,
  presetKey: HoyolabPresetKey,
  uid: string | null,
  region: string | null,
): Promise<void> {
  const host = desktop();
  const native = android();
  if (!host && !native) return;
  setStatus(
    await run(
      `link:${gameId}`,
      () =>
        host
          ? host.hoyolab.link(gameId, presetKey, uid, region)
          : native!.hoyolabLink({ gameId, presetKey, uid, region }),
      'Could not link that account.',
    ),
  );
}

export async function setAutoRefreshOnExit(autoRefreshOnExit: boolean): Promise<void> {
  const host = desktop();
  const native = android();
  if (!host && !native) return;
  setStatus(
    await run(
      'prefs',
      () => (host ? host.hoyolab.setPrefs({ autoRefreshOnExit }) : native!.hoyolabPrefs({ autoRefreshOnExit })),
      'Could not change that setting.',
    ),
  );
}

/** Redeems a gift code on the game's linked account. Never throws. */
export async function redeemHoyolabCode(gameId: string, code: string): Promise<HoyolabRedeemResult> {
  const host = desktop();
  const native = android();
  try {
    if (host?.hoyolab.redeem) return await host.hoyolab.redeem(gameId, code);
    if (native) return await native.hoyolabRedeemCode({ gameId, code });
  } catch (error) {
    return { ok: false, status: 'failed', retcode: null, message: message(error, 'HoYoverse could not be reached.') };
  }
  return { ok: false, status: 'failed', retcode: null, message: 'One-tap claiming needs the Windows or Android app.' };
}

/** Claims today's HoYoLAB daily check-in for the game's linked account. Never throws. */
export async function claimHoyolabCheckIn(gameId: string): Promise<HoyolabCheckInResult> {
  const host = desktop();
  const native = android();
  try {
    if (host?.hoyolab.checkin) return await host.hoyolab.checkin(gameId);
    if (native) return await native.hoyolabCheckIn({ gameId });
  } catch (error) {
    return { ok: false, status: 'failed', retcode: null, message: message(error, 'HoYoLAB could not be reached.') };
  }
  return { ok: false, status: 'failed', retcode: null, message: 'One-tap check-in needs the Windows or Android app.' };
}

/**
 * Reads one game's Real-Time Notes and writes them in. A manual refresh offers
 * Undo; an automatic one (a game just closed) stays quiet unless it fails.
 */
export async function refreshHoyolab(gameId: string, auto = false): Promise<number | undefined> {
  const host = desktop();
  const native = android();
  if (!host && !native) return undefined;
  const key = `refresh:${gameId}`;
  if (useConnectors.getState().busy[key]) return undefined;
  if (!auto) setConnectorNotice(null);
  const res = await run(
    key,
    () => (host ? host.hoyolab.refresh(gameId, { auto }) : native!.hoyolabRefresh({ gameId, auto })),
    'HoYoLAB could not be reached. Try again later.',
  );
  if (!res) return undefined;
  const game = useApp.getState().state.games.find((item) => item.id === gameId && !item.deleted);
  const name = game?.name ?? 'this game';

  if (!res.ok || res.raw == null) {
    const guidance = res.retcode != null && res.retcode !== 0 ? hoyolabErrorGuidance(res.retcode).message : undefined;
    setConnectorNotice({
      tone: res.retcode === 1034 || res.retcode === 10102 ? 'warn' : 'error',
      text: guidance ?? res.error ?? 'HoYoLAB did not send any numbers. Try again later.',
    });
    // A verification request starts a pause; read it so every button shows it.
    if (res.retcode === 1034 || res.backoffUntilMs != null) void loadConnectorStatus();
    return undefined;
  }

  const presetKey =
    HOYOLAB_PRESETS.find((preset) => preset === res.presetKey) ??
    (game ? hoyolabPreset(game) : undefined) ??
    useConnectors.getState().status?.hoyolab.gameLinks[gameId]?.presetKey;
  if (!presetKey) {
    setConnectorNotice({ tone: 'error', text: `Memoria cannot read HoYoLAB numbers for ${name}.` });
    return undefined;
  }
  const observation = mapHoyolabNote(presetKey, res.raw, res.observedAt);
  const store = useApp.getState();
  const lastEntry = store.history.journal.at(-1)?.id;
  const applied = store.applyConnectorObservation(gameId, observation);
  if (applied === 0) {
    if (!auto) setConnectorNotice({ tone: 'ok', text: `${name} is already up to date.` });
    return 0;
  }
  if (!auto) {
    const entry = useApp.getState().history.journal.at(-1);
    const entryId = entry && entry.id !== lastEntry ? entry.id : undefined;
    setConnectorNotice(null);
    const details = (observation.events ?? []).slice(0, 2).map((event) => event.detail ?? event.eventName);
    useUI
      .getState()
      .showUndo(details.length ? `Read ${name} · ${details.join(' · ')}` : `Read live numbers for ${name}`, () => {
        if (entryId) useApp.getState().undoActivity(entryId);
      });
  }
  return applied;
}

interface SkportCalls {
  login(opts?: { fresh?: boolean }): Promise<ConnectorStatus>;
  importBrowser?(raw: string): Promise<ConnectorStatus>;
  disconnect(): Promise<ConnectorStatus>;
  link(gameId: string, uid: string | null, region: string | null): Promise<ConnectorStatus>;
  refresh(gameId: string, auto: boolean): Promise<HoyolabRefreshResult>;
  setPrefs(autoRefreshOnExit: boolean): Promise<ConnectorStatus>;
}

/** SKPORT through whichever native host is here; undefined in a browser or an older Windows app. */
function skportCalls(): SkportCalls | undefined {
  const host = desktop();
  if (host) {
    const skport = host.skport;
    if (!skport) return undefined;
    return {
      login: (opts) => skport.login(opts),
      ...(skport.importBrowser ? { importBrowser: (raw: string) => skport.importBrowser!(raw) } : {}),
      disconnect: () => skport.disconnect(),
      link: (gameId, uid, region) => skport.link(gameId, uid, region),
      refresh: (gameId, auto) => skport.refresh(gameId, { auto }),
      setPrefs: (autoRefreshOnExit) => skport.setPrefs({ autoRefreshOnExit }),
    };
  }
  const native = android();
  if (!native) return undefined;
  return {
    login: (opts) => native.skportLogin(opts),
    importBrowser: (raw) => native.skportImportBrowser({ raw }),
    disconnect: () => native.skportDisconnect(),
    link: (gameId, uid, region) => native.skportLink({ gameId, presetKey: 'endfield', uid, region }),
    refresh: (gameId, auto) => native.skportRefresh({ gameId, auto }),
    setPrefs: (autoRefreshOnExit) => native.skportPrefs({ autoRefreshOnExit }),
  };
}

export async function signInSkport(fresh = false): Promise<void> {
  const skport = skportCalls();
  if (!skport) return;
  setConnectorNotice(null);
  const opts = fresh ? { fresh } : undefined;
  setStatus(await run('skport:login', () => skport.login(opts), 'The SKPORT sign-in could not open.'));
}

/** Whether a pasted browser session can be imported here. */
export function canImportBrowser(provider: BrowserProvider): boolean {
  if (provider === 'skport') return Boolean(skportCalls()?.importBrowser);
  const host = desktop();
  if (host) return Boolean(host.hoyolab.importBrowser);
  return Boolean(android());
}

/** Whether this host can hand a one-time code to the browser helper extension. */
export function canStartBrowserConnect(): boolean {
  return Boolean(desktop()?.browser);
}

/** Asks the native host for a one-time code the browser helper pairs with. */
export async function startBrowserConnect(provider: BrowserProvider): Promise<void> {
  const browser = desktop()?.browser;
  if (!browser) return;
  setConnectorNotice(null);
  const result = await run(
    `browser:${provider}`,
    () => browser.start(provider),
    'Could not start the browser connection.',
  );
  if (result) useConnectors.setState({ activeBrowserHandoff: result });
}

export async function cancelBrowserConnect(): Promise<void> {
  const browser = desktop()?.browser;
  useConnectors.setState({ activeBrowserHandoff: null });
  if (browser) await run('browser:cancel', () => browser.cancel(), 'Could not cancel the browser connection.');
}

export async function openBrowserHelper(): Promise<void> {
  const browser = desktop()?.browser;
  if (browser) await run('browser:helper', () => browser.openHelper(), 'Could not open the extension folder.');
}

/** Hands a pasted Cookie header or copied request to the native host. The text is never kept here. */
export async function importHoyolabBrowser(raw: string): Promise<void> {
  const host = desktop();
  const native = android();
  const importBrowser = host?.hoyolab.importBrowser;
  const call = host
    ? importBrowser && (() => importBrowser(raw))
    : native && (() => native.hoyolabImportBrowser({ raw }));
  if (!call) return;
  setConnectorNotice(null);
  setStatus(await run('hoyolab:import', call, 'Could not read a HoYoLAB sign-in from that text.'));
}

export async function importSkportBrowser(raw: string): Promise<void> {
  const importBrowser = skportCalls()?.importBrowser;
  if (!importBrowser) return;
  setConnectorNotice(null);
  setStatus(await run('skport:import', () => importBrowser(raw), 'Could not read a SKPORT sign-in from that text.'));
}

export async function disconnectSkport(): Promise<void> {
  const skport = skportCalls();
  if (!skport) return;
  setConnectorNotice(null);
  const status = await run('skport:disconnect', () => skport.disconnect(), 'Could not sign out of SKPORT.');
  setStatus(status);
  if (status) setConnectorNotice({ tone: 'ok', text: 'Signed out. The sign-in was removed from this device.' });
}

/** Links a game to one SKPORT Endfield account, or unlinks it with a null `uid`. */
export async function linkSkportGame(gameId: string, uid: string | null, region: string | null): Promise<void> {
  const skport = skportCalls();
  if (!skport) return;
  setStatus(await run(`link:${gameId}`, () => skport.link(gameId, uid, region), 'Could not link that account.'));
}

export async function setSkportAutoRefreshOnExit(autoRefreshOnExit: boolean): Promise<void> {
  const skport = skportCalls();
  if (!skport) return;
  setStatus(await run('skport:prefs', () => skport.setPrefs(autoRefreshOnExit), 'Could not change that setting.'));
}

/**
 * Reads one game's SKPORT Endfield card and writes it in. A manual refresh
 * offers Undo; an automatic one (the game just closed) stays quiet unless it fails.
 */
export async function refreshSkport(gameId: string, auto = false): Promise<number | undefined> {
  const skport = skportCalls();
  if (!skport) return undefined;
  const key = `refresh:${gameId}`;
  if (useConnectors.getState().busy[key]) return undefined;
  if (!auto) setConnectorNotice(null);
  const res = await run(key, () => skport.refresh(gameId, auto), 'SKPORT could not be reached. Try again later.');
  if (!res) return undefined;
  const game = useApp.getState().state.games.find((item) => item.id === gameId && !item.deleted);
  const name = game?.name ?? 'this game';

  if (!res.ok || res.raw == null) {
    const guidance = res.retcode != null && res.retcode !== 0 ? skportErrorGuidance(res.retcode) : undefined;
    setConnectorNotice({
      tone: guidance?.kind === 'rate-limit' ? 'warn' : 'error',
      text: guidance?.message ?? res.error ?? 'SKPORT did not send any numbers. Try again later.',
    });
    // A refused sign-in may have been cleared natively; read it so the rows show it.
    if (guidance?.kind === 'auth') void loadConnectorStatus();
    return undefined;
  }

  const observation = mapSkportEndfieldCard(res.raw, res.observedAt);
  const store = useApp.getState();
  const lastEntry = store.history.journal.at(-1)?.id;
  const applied = store.applyConnectorObservation(gameId, observation);
  if (applied === 0) {
    if (!auto) setConnectorNotice({ tone: 'ok', text: `${name} is already up to date.` });
    return 0;
  }
  if (!auto) {
    const entry = useApp.getState().history.journal.at(-1);
    const entryId = entry && entry.id !== lastEntry ? entry.id : undefined;
    setConnectorNotice(null);
    useUI.getState().showUndo(`Read live numbers for ${name}`, () => {
      if (entryId) useApp.getState().undoActivity(entryId);
    });
  }
  return applied;
}

export type GachaImportOutcome =
  | { kind: 'imported'; summary: GachaImportSummary }
  | { kind: 'pick-uid'; availableUids: string[] }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string; folderMissing?: boolean };

function savePity(game: Game, summary: GachaImportSummary): GachaImportOutcome {
  const parsed = GamePitySchema.safeParse(summary.pity);
  if (!parsed.success) return { kind: 'error', message: 'That history is out of range. Nothing was saved.' };
  const fresh = useApp.getState().state.games.find((item) => item.id === game.id && !item.deleted);
  if (!fresh) return { kind: 'error', message: 'This game is no longer tracked.' };
  const previousPity = fresh.pity;
  useApp.getState().updateGame(game.id, { pity: parsed.data });
  const pulls = summary.totalPulls;
  useUI
    .getState()
    .showUndo(`Imported ${pulls} ${pulls === 1 ? 'pull' : 'pulls'} for ${game.name}`, () =>
      useApp.getState().updateGame(game.id, { pity: previousPity }),
    );
  return { kind: 'imported', summary: { ...summary, pity: parsed.data } };
}

/** Reads the pull history the game itself keeps on this PC (Windows app only). */
export async function scanPcGacha(game: Game, pickFolder = false): Promise<GachaImportOutcome> {
  const host = desktop();
  const presetKey = gachaPreset(game);
  if (!host?.gachaScan || !presetKey) return { kind: 'error', message: 'This game has no history scan here.' };
  const key = `gacha:${game.id}`;
  setBusy(key, true);
  try {
    const res = await host.gachaScan(presetKey, { pickFolder });
    if (!res) return { kind: 'cancelled' };
    const fresh = useApp.getState().state.games.find((item) => item.id === game.id && !item.deleted) ?? game;
    const summary = importGachaHistory(presetKey, res.pulls, fresh.tz, fresh.pity, res.uid ?? undefined);
    return savePity(fresh, summary);
  } catch (error) {
    const text = message(error, 'The pull history could not be read.');
    return {
      kind: 'error',
      message: text,
      folderMissing: /find the game|does not hold the game/i.test(text),
    };
  } finally {
    setBusy(key, false);
  }
}

/**
 * Imports a UIGF v4 (or older single-account UIGF, or WuWa) export. A file
 * with several accounts asks which one first and changes nothing until then.
 */
export function importGachaFile(game: Game, text: string, uid?: string): GachaImportOutcome {
  const presetKey = gachaPreset(game);
  if (!presetKey) return { kind: 'error', message: 'Pull history import does not cover this game.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { kind: 'error', message: 'That file is not JSON. Choose a UIGF or pull-history .json export.' };
  }
  try {
    const exported = parseGachaExport(parsed, presetKey, uid);
    if (!uid && exported.availableUids.length > 1) return { kind: 'pick-uid', availableUids: exported.availableUids };
    if (uid && exported.uid !== uid) return { kind: 'error', message: `That file has no account ${uid}.` };
    if (exported.pulls.length === 0) return { kind: 'error', message: 'That file has no pulls for this game.' };
    const fresh = useApp.getState().state.games.find((item) => item.id === game.id && !item.deleted) ?? game;
    const summary = importGachaHistory(presetKey, exported.pulls, fresh.tz, fresh.pity, exported.uid);
    return savePity(fresh, summary);
  } catch (error) {
    return { kind: 'error', message: message(error, 'That file could not be read.') };
  }
}

/** One line for an import: pulls, 5★s and banners left alone. */
export function gachaSummaryText(summary: GachaImportSummary): string {
  const parts = [
    `Imported ${summary.totalPulls} ${summary.totalPulls === 1 ? 'pull' : 'pulls'}`,
    `${summary.fiveStarsImported} 5★ ${summary.fiveStarsImported === 1 ? 'entry' : 'entries'}`,
  ];
  let text = `${parts.join(', ')}.`;
  if (summary.ignoredBannerTypes.length > 0)
    text += ` Banner types left alone: ${summary.ignoredBannerTypes.join(', ')}.`;
  return text;
}

function liveGames(): Game[] {
  return useApp
    .getState()
    .state.games.filter((game) => !game.deleted)
    .sort((a, b) => a.sort - b.sort);
}

export function gameResources(gameId: string): Resource[] {
  return useApp.getState().state.resources.filter((res) => res.gameId === gameId && !res.deleted);
}

function gameTasks(gameId: string): Task[] {
  return useApp.getState().state.tasks.filter((task) => task.gameId === gameId && !task.deleted);
}

/** A screenshot's text as the matcher takes it: the primary lines, every pass, and how each region was read. */
function ocrInput(text: Pick<PendingScreenshot, 'lines' | 'passes' | 'captures'>): OcrScreenshotInput {
  return {
    lines: text.lines ?? [],
    ...(text.passes?.length ? { passes: text.passes } : {}),
    ...(text.captures?.some(Boolean) ? { captures: text.captures } : {}),
  };
}

function screenshotMatches(input: OcrScreenshotInput, gameId: string, observedAt: number): OcrScreenshotMatches {
  const { games, events } = useApp.getState().state;
  const game = games.find((item) => item.id === gameId);
  return matchScreenshotOcrPasses(input, {
    game,
    resources: gameResources(gameId),
    tasks: gameTasks(gameId),
    events,
    observedAt,
  });
}

const RANK = { high: 3, medium: 2, low: 1 } as const;

/** `Wuthering Waves.exe`, `wuthering waves` and `Wuthering Waves` name one program. */
function programKey(name: string): string {
  return name
    .trim()
    .replace(/\.exe$/i, '')
    .trim()
    .toLowerCase();
}

/** The tracked game whose program a capture was taken from, when exactly one claims it. */
function gameForProcess(games: Game[], processName: string | null | undefined): Game | undefined {
  const wanted = processName ? programKey(processName) : '';
  if (!wanted) return undefined;
  const owners = games.filter((game) =>
    [...(game.processNames ?? []), ...(presetForGame(game)?.processNames ?? [])].some(
      (name) => programKey(name) === wanted,
    ),
  );
  // Two copies of one game (two accounts) share a program: let the text and focus decide.
  return owners.length === 1 ? owners[0] : undefined;
}

let captureSeq = 0;

/** A capture's region count: a whole number, at least one. */
function regionsIn(count: number | undefined): number {
  return count != null && Number.isFinite(count) && count >= 1 ? Math.round(count) : 1;
}

/** What each of `count` regions was read from, null where nobody said. */
function regionCaptures(captures: readonly (OcrCapture | null)[] | undefined, count: number): (OcrCapture | null)[] {
  return Array.from({ length: count }, (_, region) => captures?.[region] ?? null);
}

/** Shows a waiting screenshot and asks App to mount the sheet. */
function showPending(pending: PendingScreenshot): PendingScreenshot {
  useConnectors.setState({ pendingScreenshot: pending });
  window.dispatchEvent(new CustomEvent(PENDING_SCREENSHOT_EVENT));
  return pending;
}

/**
 * Adds another capture of the same game to the screenshot already waiting:
 * its text joins as new regions, its passes keep their own regions (moved
 * past the ones already there, never mixed into them), every match is read
 * again, and the sheet's edits stay because `captureKey` does not change.
 */
function mergePending(
  existing: PendingScreenshot,
  payload: Parameters<typeof openScreenshotOcr>[0],
  observedAt: number,
): PendingScreenshot {
  const before = existing.lines ?? [];
  const added = payload.lines ?? [];
  // One empty line between regions, even around one with no text, so region i of the lines is region i of the passes.
  const lines = before.length > 0 || added.length > 0 ? [...before, '', ...added] : [];
  const regionsBefore = regionsIn(existing.regionCount);
  const regionsAdded = regionsIn(payload.regionCount);
  const passes = [
    ...(existing.passes ?? []),
    ...(payload.passes ?? []).map((pass) => ({ ...pass, region: (pass.region ?? 0) + regionsBefore })),
  ];
  const captures = [
    ...regionCaptures(existing.captures, regionsBefore),
    ...Array<OcrCapture | null>(regionsAdded).fill(payload.capture ?? null),
  ];
  const text = {
    ...(existing.lines || payload.lines ? { lines } : {}),
    ...(passes.length > 0 ? { passes } : {}),
    ...(captures.some(Boolean) ? { captures } : {}),
  };
  const mergedAt = Math.max(existing.observedAt, observedAt);
  const matches = screenshotMatches(ocrInput(text), existing.gameId, mergedAt);
  const dataUrl = payload.dataUrl || existing.dataUrl;
  return showPending({
    ...existing,
    ...text,
    revision: existing.revision + 1,
    fileName: payload.fileName || existing.fileName,
    observedAt: mergedAt,
    ...(dataUrl ? { dataUrl } : {}),
    regionCount: regionsBefore + regionsAdded,
    candidates: matches.readings,
    matches,
  });
}

/**
 * Opens the confirmation sheet for a screenshot. Nothing is saved until the
 * player says so. A capture that arrives while the sheet is open for the same
 * game (another snip) merges into it; one that names another game replaces it.
 */
export function openScreenshotOcr(payload: {
  fileName: string;
  observedAt: number;
  lines?: string[];
  dataUrl?: string | null;
  /** The program a Windows capture came from; it names the game outright. */
  processName?: string | null;
  /** How many snipped regions `lines` covers. */
  regionCount?: number;
  /** Every way Windows read each region; `lines` stays the primary reading. */
  passes?: OcrPass[];
  /** What the text was read from: a snip, the game window, an image file. */
  capture?: OcrCapture;
  source: ScreenshotSource;
}): PendingScreenshot | null {
  const games = liveGames();
  if (games.length === 0) {
    setConnectorNotice({ tone: 'warn', text: 'Add a game first, then read a screenshot into it.' });
    return null;
  }
  const lines = payload.lines ?? [];
  const regionCount = regionsIn(payload.regionCount);
  const { capture } = payload;
  const text = {
    ...(payload.lines ? { lines: payload.lines } : {}),
    ...(payload.passes?.length ? { passes: payload.passes } : {}),
    ...(capture ? { captures: Array<OcrCapture>(regionCount).fill(capture) } : {}),
  };
  const input = ocrInput(text);
  const observedAt = Number.isFinite(payload.observedAt) && payload.observedAt > 0 ? payload.observedAt : Date.now();
  const state = useApp.getState().state;
  const resources = state.resources.filter((res) => !res.deleted && games.some((game) => game.id === res.gameId));
  // The program in front beats the text, whose caps (240 for WuWa, ZZZ and NTE) are often shared.
  const named =
    gameForProcess(games, payload.processName)?.id ??
    inferScreenshotGame(
      lines,
      games,
      resources,
      state.tasks.filter((task) => !task.deleted),
      {
        events: state.events,
        observedAt,
        ...(input.passes ? { passes: input.passes } : {}),
        ...(input.captures ? { captures: input.captures } : {}),
      },
    );
  const existing = useConnectors.getState().pendingScreenshot;
  if (existing && games.some((game) => game.id === existing.gameId) && (!named || named === existing.gameId)) {
    return mergePending(existing, payload, observedAt);
  }
  let best: { gameId: string; rank: number } | undefined;
  for (const candidate of matchOcrReadings(lines, resources)) {
    const gameId = resources.find((res) => res.id === candidate.resourceId)?.gameId;
    const rank = RANK[candidate.confidence];
    if (gameId && (!best || rank > best.rank)) best = { gameId, rank };
  }
  const focused = useUI.getState().focusedGameId;
  const gameId =
    named ??
    best?.gameId ??
    (focused && games.some((game) => game.id === focused) ? focused : undefined) ??
    games.find((game) => !game.paused)?.id ??
    games[0]!.id;
  const matches = screenshotMatches(input, gameId, observedAt);
  captureSeq += 1;
  return showPending({
    captureKey: `${gameId}:${observedAt}:${captureSeq}`,
    revision: 0,
    fileName: payload.fileName,
    observedAt,
    ...text,
    ...(payload.dataUrl ? { dataUrl: payload.dataUrl } : {}),
    regionCount,
    source: payload.source,
    candidates: matches.readings,
    matches,
    gameId,
  });
}

/** Points the waiting screenshot at another game and matches its text again. */
export function choosePendingScreenshotGame(gameId: string): void {
  const pending = useConnectors.getState().pendingScreenshot;
  if (!pending) return;
  const matches = screenshotMatches(ocrInput(pending), gameId, pending.observedAt);
  useConnectors.setState({ pendingScreenshot: { ...pending, gameId, candidates: matches.readings, matches } });
}

export function dismissPendingScreenshot(): void {
  useConnectors.setState({ pendingScreenshot: null });
}

/** A browser-picked image as a data URL, dated by the file's own time. */
export function readBrowserImageFile(file: File): Promise<{ fileName: string; observedAt: number; dataUrl: string }> {
  if (!file.type.startsWith('image/')) return Promise.reject(new Error('Choose an image file.'));
  if (file.size > MAX_SCREENSHOT_BYTES) return Promise.reject(new Error('That image is over 15 MB.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string')
        resolve({ fileName: file.name, observedAt: file.lastModified || Date.now(), dataUrl: reader.result });
      else reject(new Error('That image could not be read.'));
    };
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.readAsDataURL(file);
  });
}

/** Opens a browser file as a screenshot to read in by hand. */
export async function openBrowserScreenshot(file: File): Promise<void> {
  try {
    const image = await readBrowserImageFile(file);
    openScreenshotOcr({ ...image, source: 'file' });
  } catch (error) {
    setConnectorNotice({ tone: 'error', text: message(error, 'That image could not be read.') });
  }
}

/** The native picker: Windows reads its text with OCR; Android hands back the image. */
export async function pickScreenshotFile(): Promise<void> {
  const host = desktop();
  const native = android();
  setConnectorNotice(null);
  if (host) {
    const res = await run('screenshot', () => host.screenshot.pick(), 'That screenshot could not be read.');
    if (res) openScreenshotOcr(desktopReading(res));
    return;
  }
  if (native) {
    const res = await run('screenshot', () => native.pickScreenshot(), 'That screenshot could not be opened.');
    if (res && !res.cancelled) openAndroidImage(res, 'file', 'android-share');
  }
}

/** An Android image, with ML Kit's reading when it found text, as the confirmation sheet takes it. */
function openAndroidImage(res: AndroidImageResult, capture: OcrCapture, source: ScreenshotSource): void {
  if (!res.dataUrl) return;
  openScreenshotOcr({
    fileName: res.fileName ?? 'Screenshot',
    observedAt: res.observedAt ?? Date.now(),
    dataUrl: res.dataUrl,
    ...(Array.isArray(res.lines) ? { lines: res.lines.filter((line) => typeof line === 'string') } : {}),
    ...(Array.isArray(res.passes) && res.passes.length > 0 ? { passes: res.passes } : {}),
    capture,
    source,
  });
}

/** Whether this phone can scan with its camera: the Android app only. */
export function canScanWithCamera(): boolean {
  return Boolean(android());
}

/** Android: the camera viewfinder, read on the phone, then the confirmation sheet. */
export async function scanWithCamera(): Promise<void> {
  const native = android();
  if (!native) return;
  setConnectorNotice(null);
  const res = await run('camera', () => native.captureScreenshot(), 'The camera could not take that picture.');
  if (res && !res.cancelled) openAndroidImage(res, 'camera', 'android-camera');
}

/** A Windows OCR reading, with its preview and program, as the confirmation sheet takes it. */
function desktopReading(res: ScreenshotOcrResult): Parameters<typeof openScreenshotOcr>[0] {
  return {
    fileName: res.fileName,
    observedAt: res.observedAt,
    lines: res.lines,
    dataUrl: res.dataUrl ?? null,
    processName: res.processName ?? null,
    ...(res.regionCount != null ? { regionCount: res.regionCount } : {}),
    ...(Array.isArray(res.passes) && res.passes.length > 0 ? { passes: res.passes } : {}),
    ...(res.source ? { capture: res.source } : {}),
    source: 'windows-ocr',
  };
}

/**
 * Reads the screen in the Windows app: `snip` lets the player drag a region,
 * `window` reads the game in front. The host emits every reading through
 * `onScreenshotOcr`, which `initConnectors` already opens; a returned reading
 * opens here only when nothing listens, so the sheet never opens twice.
 */
export async function captureScreenshot(mode: 'snip' | 'window' = 'snip'): Promise<void> {
  const capture = desktop()?.screenshot.capture;
  if (!capture) return;
  setConnectorNotice(null);
  const res = await run(
    'capture',
    () => capture(mode),
    mode === 'window' ? 'The game window could not be read.' : 'The screen could not be read.',
  );
  if (res && !initialized) openScreenshotOcr(desktopReading(res));
}

/** Turns the global screenshot shortcut on or off, or changes its keys; a null accelerator keeps them. */
export async function setScreenshotShortcut(enabled: boolean, accelerator: string | null): Promise<void> {
  const setShortcut = desktop()?.screenshot.setShortcut;
  if (!setShortcut) return;
  setConnectorNotice(null);
  setStatus(await run('shortcut', () => setShortcut(enabled, accelerator), 'Could not change the shortcut.'));
}

export async function chooseScreenshotFolder(): Promise<void> {
  const host = desktop();
  if (!host) return;
  setConnectorNotice(null);
  setStatus(await run('watch', () => host.screenshot.watchChoose(), 'Could not watch that folder.'));
}

export async function clearScreenshotFolder(): Promise<void> {
  const host = desktop();
  if (!host) return;
  setStatus(await run('watch', () => host.screenshot.watchClear(), 'Could not stop watching that folder.'));
}

/** Opens the folder the Windows app saves its captures in. */
export async function openScreenshotCaptures(): Promise<void> {
  const open = desktop()?.screenshot.openCaptures;
  if (!open) return;
  setConnectorNotice(null);
  await run('captures', () => open(), 'The captures folder could not be opened.');
}

/** Deletes the captures the Windows app saved; resolves with the new status, or undefined on failure. */
export async function clearScreenshotCaptures(): Promise<ConnectorStatus | undefined> {
  const clear = desktop()?.screenshot.clearCaptures;
  if (!clear) return undefined;
  setConnectorNotice(null);
  const status = await run('captures', () => clear(), 'The saved captures could not be cleared.');
  setStatus(status);
  return status;
}

async function consumeShare(native: AndroidConnector): Promise<void> {
  try {
    const { image } = await native.consumePendingShare();
    if (image) openAndroidImage(image, 'share', 'android-share');
  } catch (error) {
    setConnectorNotice({ tone: 'error', text: message(error, 'The shared screenshot could not be opened.') });
  }
}

let initialized = false;

/**
 * Starts listening to the native host. A plain browser has nothing to listen
 * to, so this is a no-op there. Returns the matching stop.
 */
export function initConnectors(): () => void {
  const host = desktop();
  const native = android();
  if ((!host && !native) || initialized) return () => undefined;
  initialized = true;
  const stops: Array<() => void> = [];
  void loadConnectorStatus();

  if (host) {
    stops.push(host.onStatusChanged((status) => setStatus(status)));
    stops.push(host.onScreenshotOcr((payload) => openScreenshotOcr(desktopReading(payload))));
    const stopped = window.memoriaDesktop?.presence?.onGameStopped;
    if (stopped) {
      stops.push(
        stopped((gameId) => {
          const status = useConnectors.getState().status;
          if (
            status?.hoyolab.connected &&
            status.hoyolab.autoRefreshOnExit &&
            status.hoyolab.gameLinks[gameId] &&
            !inBackoff(status)
          )
            void refreshHoyolab(gameId, true);
          if (status?.skport?.connected && status.skport.autoRefreshOnExit && status.skport.gameLinks[gameId])
            void refreshSkport(gameId, true);
        }),
      );
    }
  }

  if (native) {
    let active = true;
    const handles: PluginListenerHandle[] = [];
    const keep = (handle: PluginListenerHandle) => {
      if (active) handles.push(handle);
      else void handle.remove();
    };
    void native
      .addListener('statusChanged', (status) => setStatus(status))
      .then(keep)
      .catch(() => undefined);
    void native
      .addListener('screenshotShared', (payload) => {
        if (payload?.available) void consumeShare(native);
      })
      .then(keep)
      .catch(() => undefined);
    // A screenshot shared while Memoria was closed waits here.
    void consumeShare(native);
    stops.push(() => {
      active = false;
      for (const handle of handles) void handle.remove();
    });
  }

  return () => {
    initialized = false;
    for (const stop of stops) stop();
  };
}
