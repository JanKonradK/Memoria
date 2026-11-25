import { useLayoutEffect } from 'react';
import type { GachaPresetKey, HoyolabPresetKey, RawGachaPull, SkportPresetKey } from '@memoria/shared';
import { confirmDialog } from './components/ConfirmDialog';
import { flushPersist, useApp } from './store';
import { flushSync } from './sync';

export interface DesktopCloseResult {
  allow: boolean;
  error?: string;
}

/** Narrow native actions only, never Node, cookies or arbitrary IPC. */
export interface DesktopHost {
  version: 1;
  /** Start a tracked game. Targets are picked in a native dialog and never leave this PC. */
  launch?: {
    list(): Promise<LaunchTargets>;
    choose(gameId: string): Promise<LaunchTargets>;
    clear(gameId: string): Promise<LaunchTargets>;
    start(gameId: string): Promise<{ started: string }>;
  };
  update?: {
    check(): Promise<{ installed: string | null; release: ReleaseInfo | null; staged: string | null }>;
    download(): Promise<{ version: string }>;
    install(): Promise<boolean>;
    onProgress(listener: (progress: { received: number; total: number }) => void): () => void;
    onShowRequested(listener: () => void): () => void;
  };
  /** Start with Windows, the tray, and notices when a tracked game starts. */
  presence?: {
    get(): Promise<DesktopPresence>;
    set(changes: Partial<DesktopPreferences>): Promise<DesktopPresence>;
    /** Program names per game id, e.g. `{ genshin: ['GenshinImpact'] }`. */
    watch(games: Record<string, string[]>): Promise<boolean>;
    notify(notice: { gameId: string; title: string; body: string }): Promise<boolean>;
    /** Whether Windows lets Memoria's toasts through. Older hosts lack these three. */
    notificationStatus?(): Promise<{ windows: WindowsToastSetting }>;
    testNotification?(style: string, tone: string): Promise<{ windows: WindowsToastSetting }>;
    openNotificationSettings?(): Promise<void>;
    onChanged(listener: (presence: DesktopPresence) => void): () => void;
    onGameStarted(listener: (gameId: string) => void): () => void;
    /** A watched game closed after a real session. Older hosts lack it. */
    onGameStopped?(listener: (gameId: string) => void): () => void;
    onOpenGame(listener: (gameId: string) => void): () => void;
  };
  /**
   * Opt-in live numbers. Sign-in cookies, history links and folder paths stay
   * in the native host: the page only ever sees status, numbers and text.
   */
  connectors?: DesktopConnectors;
  onCloseRequested(listener: (requestId: string) => void): () => void;
  completeClose(requestId: string, result: DesktopCloseResult): void;
}

/** enabled; app: off for Memoria; user: all notifications off; policy: set by an administrator. */
export type WindowsToastSetting = 'enabled' | 'app' | 'user' | 'policy' | 'unknown';

export interface DesktopPreferences {
  openAtLogin: boolean;
  closeToTray: boolean;
  gameStartNotices: boolean;
  remindersOnPc: boolean;
}

export interface DesktopPresence extends DesktopPreferences {
  /** False in a development checkout, which never registers itself with Windows. */
  canStartWithWindows: boolean;
  gameWatch: boolean;
}

/** A published GitHub release, as both the desktop host and the app read it. */
export interface ReleaseInfo {
  version: string;
  tag: string;
  name: string;
  notes: string;
  url: string;
  publishedAt: string | null;
  assets: { name: string; url: string; size: number }[];
  /** Notes of every release newer than this copy, newest first. */
  changes?: { version: string; notes: string; publishedAt: string | null }[];
}

/** Game id to the file name of what starts it. */
export interface LaunchTargets {
  targets: Record<string, string>;
}

export interface HoyolabRole {
  presetKey: HoyolabPresetKey;
  uid: string;
  region: string;
  nickname?: string | null;
  level?: number | null;
  regionName?: string | null;
}

export interface HoyolabGameLink {
  presetKey: HoyolabPresetKey;
  uid: string;
  region: string;
}

export interface SkportRole {
  presetKey: SkportPresetKey;
  uid: string;
  region: string;
  nickname?: string | null;
  level?: number | null;
  regionName?: string | null;
}

export interface SkportGameLink {
  presetKey: SkportPresetKey;
  uid: string;
  region: string;
}

/** The Windows app's global screenshot shortcut. `registered` is false when another program holds it. */
export interface ScreenshotShortcutStatus {
  enabled: boolean;
  /** `Ctrl+Shift+M`-style: Ctrl, Alt, Shift or Win with A-Z, 0-9, F1-F12 or PrintScreen. */
  accelerator: string;
  registered: boolean;
  error?: string | null;
}

/** Captures Memoria saved in its own folder. Older hosts lack it. */
export interface ScreenshotCapturesStatus {
  count: number;
  bytes: number;
}

/** What the native host says about its connectors. Never carries a cookie, link or full path. */
export interface ConnectorStatus {
  hoyolab: {
    connected: boolean;
    maskedUid: string | null;
    roles: HoyolabRole[];
    /** Memoria game id to the HoYoLAB account it reads. */
    gameLinks: Record<string, HoyolabGameLink>;
    backoffUntilMs: number | null;
    autoRefreshOnExit: boolean;
  };
  /** Arknights: Endfield through SKPORT. Older hosts lack it. */
  skport?: {
    connected: boolean;
    maskedUid: string | null;
    roles: SkportRole[];
    /** Memoria game id to the SKPORT account it reads. */
    gameLinks: Record<string, SkportGameLink>;
    autoRefreshOnExit: boolean;
  };
  screenshotWatch: {
    enabled: boolean;
    folderName: string | null;
  };
  /** Windows only; older hosts lack it. */
  screenshotShortcut?: ScreenshotShortcutStatus;
  /** Windows only; older hosts lack it. */
  screenshotCaptures?: ScreenshotCapturesStatus;
  /** A pending browser-helper handoff. Older hosts lack it. */
  browserHandoff?: BrowserHandoffStatus;
  error?: string;
}

export type BrowserProvider = 'hoyolab' | 'skport';

export interface BrowserHandoffStatus {
  active: boolean;
  provider: BrowserProvider | null;
  expiresAtMs: number | null;
}

/** A one-time code the Memoria Browser Helper extension pairs with. */
export interface BrowserStartResult {
  provider: BrowserProvider;
  code: string;
  expiresAtMs: number;
}

export interface HoyolabRefreshResult {
  ok: boolean;
  retcode: number | null;
  backoffUntilMs: number | null;
  presetKey: string | null;
  observedAt: number;
  /** The Real-Time Notes `data` object, mapped in the page. */
  raw: unknown;
  error: string | null;
}

/** What a one-tap HoYoverse code redemption came to. `message` is a fixed sentence. */
export interface HoyolabRedeemResult {
  ok: boolean;
  status: 'redeemed' | 'already' | 'expired' | 'invalid' | 'cooldown' | 'auth' | 'failed';
  retcode: number | null;
  message: string;
}

/** What a one-tap HoYoLAB daily check-in came to. `message` is a fixed sentence. */
export interface HoyolabCheckInResult {
  ok: boolean;
  status: 'claimed' | 'already' | 'captcha' | 'auth' | 'failed';
  retcode: number | null;
  message: string;
}

export interface GachaScanResult {
  presetKey: GachaPresetKey;
  uid?: string | null;
  pulls: RawGachaPull[];
}

export interface ScreenshotOcrResult {
  fileName: string;
  observedAt: number;
  lines: string[];
  /** A downscaled JPEG of what was read, for the confirmation sheet. */
  dataUrl?: string | null;
  /** The program a capture was taken from, without `.exe`. */
  processName?: string | null;
  /**
   * How many snipped regions `lines` and `dataUrl` cover. Each region's lines
   * are set apart by one empty line. Missing means one.
   */
  regionCount?: number;
}

export interface DesktopConnectors {
  status(): Promise<ConnectorStatus>;
  hoyolab: {
    /** Opens the sign-in window and returns at once; the outcome arrives through `onStatusChanged`. */
    login(options?: { fresh?: boolean }): Promise<ConnectorStatus>;
    /** A pasted `Cookie:` header, `Copy as cURL` or `Copy as fetch`. Older hosts lack it. */
    importBrowser?(raw: string): Promise<ConnectorStatus>;
    disconnect(): Promise<ConnectorStatus>;
    link(gameId: string, presetKey: string, uid: string | null, region: string | null): Promise<ConnectorStatus>;
    refresh(gameId: string, options?: { auto?: boolean }): Promise<HoyolabRefreshResult>;
    /** Older hosts lack it. */
    redeem?(gameId: string, code: string): Promise<HoyolabRedeemResult>;
    /** Older hosts lack it. */
    checkin?(gameId: string): Promise<HoyolabCheckInResult>;
    setPrefs(changes: { autoRefreshOnExit?: boolean }): Promise<ConnectorStatus>;
  };
  /** Arknights: Endfield through SKPORT. Older hosts lack it. */
  skport?: {
    /** Opens the sign-in window; the outcome arrives through `onStatusChanged`. */
    login(options?: { fresh?: boolean }): Promise<ConnectorStatus>;
    importBrowser?(raw: string): Promise<ConnectorStatus>;
    disconnect(): Promise<ConnectorStatus>;
    link(gameId: string, uid: string | null, region: string | null): Promise<ConnectorStatus>;
    refresh(gameId: string, options?: { auto?: boolean }): Promise<HoyolabRefreshResult>;
    setPrefs(changes: { autoRefreshOnExit?: boolean }): Promise<ConnectorStatus>;
  };
  /** Connecting from the player's own browser. Older hosts lack it. */
  browser?: {
    start(provider: BrowserProvider): Promise<BrowserStartResult>;
    cancel(): Promise<void>;
    openHelper(): Promise<void>;
  };
  /** Null when the folder picker is cancelled. */
  gachaScan(game: GachaPresetKey, options?: { pickFolder?: boolean }): Promise<GachaScanResult | null>;
  screenshot: {
    /** Null when the picker is cancelled. */
    pick(): Promise<ScreenshotOcrResult | null>;
    watchChoose(): Promise<ConnectorStatus>;
    watchClear(): Promise<ConnectorStatus>;
    /**
     * `window` reads the game in front and resolves with the reading (and also
     * emits it through `onScreenshotOcr`); `snip` resolves with null and the
     * reading arrives only through `onScreenshotOcr`. Older hosts lack it.
     */
    capture?(mode?: 'snip' | 'window'): Promise<ScreenshotOcrResult | null>;
    setShortcut?(enabled: boolean, accelerator: string | null): Promise<ConnectorStatus>;
    /** Opens Memoria's captures folder in Explorer. Older hosts lack it. */
    openCaptures?(): Promise<void>;
    /** Deletes every saved capture. Older hosts lack it. */
    clearCaptures?(): Promise<ConnectorStatus>;
  };
  onStatusChanged(listener: (status: ConnectorStatus) => void): () => void;
  onScreenshotOcr(listener: (payload: ScreenshotOcrResult) => void): () => void;
}

declare global {
  interface Window {
    memoriaDesktop?: DesktopHost;
  }
}

const drafts = new Set<symbol>();

/** Shared editors keep their existing dismissal guard and also guard app exit. */
export function useUnsavedDraft(dirty: boolean): void {
  useLayoutEffect(() => {
    if (!dirty) return;
    const token = Symbol('draft');
    drafts.add(token);
    const protectReload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectReload);
    return () => {
      drafts.delete(token);
      window.removeEventListener('beforeunload', protectReload);
    };
  }, [dirty]);
}

export function isDesktopApp(): boolean {
  return window.memoriaDesktop?.version === 1;
}

/** Keep the renderer alive until both local stores acknowledge the final edit. */
export function initDesktopHost(): (() => void) | undefined {
  const host = window.memoriaDesktop;
  if (host?.version !== 1) return;
  let active = true;
  let closing = false;
  let allowUnload = false;
  let edits = 0;
  let openedData = useApp.getState().loaded;
  const stopStore = useApp.subscribe((store) => {
    openedData ||= store.loaded;
  });
  const changed = () => edits++;
  const preventUnload = (event: BeforeUnloadEvent) => {
    if (allowUnload) return;
    event.preventDefault();
    event.returnValue = '';
  };
  document.addEventListener('tg-mutated', changed);
  document.addEventListener('input', changed, true);
  document.addEventListener('change', changed, true);
  window.addEventListener('beforeunload', preventUnload);

  const unsubscribe = host.onCloseRequested((requestId) => {
    if (!active || closing) return;
    closing = true;
    void (async (): Promise<DesktopCloseResult> => {
      try {
        const store = useApp.getState();
        if (!store.loaded || store.loadError) {
          // A failed first read has not exposed any editable app data. Do not
          // trap this window or send fresh defaults back to an unreadable PC file.
          if (!openedData && store.loadError && edits === 0 && drafts.size === 0) {
            await flushPersist();
            return { allow: true };
          }
          return { allow: false, error: 'Wait for Memoria to open its data.' };
        }
        // Inline energy editors commit on blur, before the save boundary below.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        if (
          drafts.size > 0 &&
          !(await confirmDialog({
            title: 'Close Memoria and discard your unsaved changes?',
            confirmLabel: 'Discard and close',
            danger: true,
          }))
        ) {
          return { allow: false };
        }
        const startedAt = edits;
        const openDrafts = [...drafts];
        await flushPersist();
        await flushSync();
        const syncedState = useApp.getState().state;
        await flushPersist();
        if (
          useApp.getState().state !== syncedState ||
          edits !== startedAt ||
          [...drafts].some((draft) => !openDrafts.includes(draft))
        ) {
          return { allow: false, error: 'Changes arrived while Memoria was closing. Close it again after they save.' };
        }
        return { allow: true };
      } catch (error) {
        return {
          allow: false,
          error: error instanceof Error ? error.message : 'Your changes could not be saved. Keep Memoria open.',
        };
      }
    })()
      .then((result) => {
        if (!active) return;
        allowUnload = result.allow;
        host.completeClose(requestId, result);
      })
      .finally(() => {
        closing = false;
      });
  });
  return () => {
    active = false;
    unsubscribe();
    stopStore();
    document.removeEventListener('tg-mutated', changed);
    document.removeEventListener('input', changed, true);
    document.removeEventListener('change', changed, true);
    window.removeEventListener('beforeunload', preventUnload);
  };
}
