import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { create } from 'zustand';
import { isDesktopApp, type ReleaseInfo } from './desktop-host';
import { servedByLauncher } from './launcher';
import { isNativeApp } from './native';
import { flushPersist } from './store';

export const APP_VERSION = __APP_VERSION__;
const RELEASES_API = 'https://api.github.com/repos/JanKonradK/Memoria/releases/latest';
const RELEASES_PAGE = 'https://github.com/JanKonradK/Memoria/releases/latest';
const APK_ASSET = 'Memoria-android.apk';
const CHECKSUM_ASSET = 'SHA256SUMS.txt';
const RATE_LIMITED = 'GitHub is limiting update checks from this network. Try again in an hour.';
const AUTO_KEY = 'memoria-update-auto';
const CHECKED_KEY = 'memoria-update-checked-at';
/** A window left open checks again this often. */
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

const AppUpdater = registerPlugin<{
  install(options: { apkUrl: string; checksumUrl: string; version: string }): Promise<void>;
  addListener(
    event: 'progress',
    listener: (progress: { received: number; total: number }) => void,
  ): Promise<PluginListenerHandle>;
}>('AppUpdater');

/**
 * How this copy installs a new version: the Windows app swaps its own files,
 * Android hands a verified APK to the system installer, and the browser copies
 * open the download page. A browser tab served by the PC app updates with it.
 */
export type UpdateTarget = 'desktop' | 'android' | 'download' | 'none';

export function updateTarget(): UpdateTarget {
  if (isDesktopApp()) return window.memoriaDesktop?.update ? 'desktop' : 'none';
  if (isNativeApp) return 'android';
  return servedByLauncher() ? 'none' : 'download';
}

export type UpdateStatus = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';

interface UpdateState {
  status: UpdateStatus;
  release: ReleaseInfo | null;
  /** 0–1 while a download reports its size. */
  progress: number | null;
  error: string;
  checkedAt: number | null;
  auto: boolean;
  /** A notice closed with Later stays closed for that version until the next launch. */
  dismissed: string | null;
}

function readCheckedAt(): number | null {
  const value = Number(localStorage.getItem(CHECKED_KEY));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export const useAppUpdate = create<UpdateState>(() => ({
  status: 'idle',
  release: null,
  progress: null,
  error: '',
  checkedAt: readCheckedAt(),
  auto: localStorage.getItem(AUTO_KEY) !== 'off',
  dismissed: null,
}));

/** Numeric `1.2.3` ordering. A prerelease sorts below the same finished version. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const [core = '', prerelease = ''] = value.replace(/^v/, '').split('-', 2);
    return { parts: core.split('.').map((part) => Number.parseInt(part, 10) || 0), prerelease };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

/** The release notes above the download table the release workflow appends. */
export function releaseNotes(release: ReleaseInfo): string {
  return release.notes.split(/^##\s+Downloads?\b/im)[0]?.trim() ?? '';
}

/** Electron prefixes errors from the main process with the IPC channel; people need only the reason. */
function message(error: unknown, fallback: string): string {
  const text =
    error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '';
  return text || fallback;
}

async function fetchRelease(): Promise<{ release: ReleaseInfo | null; staged: string | null }> {
  const host = window.memoriaDesktop?.update;
  if (host) {
    const result = await host.check();
    return { release: result.release, staged: result.staged };
  }
  const response = await fetch(RELEASES_API, { headers: { accept: 'application/vnd.github+json' } });
  if (response.status === 403 || response.status === 429) throw new Error(RATE_LIMITED);
  if (!response.ok) throw new Error(`GitHub responded ${response.status}. Try again later.`);
  const raw = (await response.json()) as Record<string, unknown>;
  if (raw['draft'] || raw['prerelease']) return { release: null, staged: null };
  const tag = String(raw['tag_name'] ?? '');
  const assets = Array.isArray(raw['assets']) ? (raw['assets'] as Record<string, unknown>[]) : [];
  return {
    release: {
      version: tag.replace(/^v/, ''),
      tag,
      name: String(raw['name'] ?? tag),
      notes: String(raw['body'] ?? ''),
      url: String(raw['html_url'] ?? RELEASES_PAGE),
      publishedAt: typeof raw['published_at'] === 'string' ? raw['published_at'] : null,
      assets: assets.map((asset) => ({
        name: String(asset['name']),
        url: String(asset['browser_download_url']),
        size: Number(asset['size']) || 0,
      })),
    },
    staged: null,
  };
}

let checking: Promise<void> | undefined;

/** Ask GitHub for the latest release. A quiet check never shows an error. */
export function checkForUpdates({ quiet = false } = {}): Promise<void> {
  const { status } = useAppUpdate.getState();
  if (updateTarget() === 'none' || status === 'downloading') return Promise.resolve();
  checking ??= (async () => {
    useAppUpdate.setState({ status: 'checking', error: '' });
    try {
      const { release, staged } = await fetchRelease();
      const checkedAt = Date.now();
      localStorage.setItem(CHECKED_KEY, String(checkedAt));
      const newer = release && release.version && compareVersions(release.version, APP_VERSION) > 0;
      useAppUpdate.setState({
        status: !newer ? 'current' : staged === release.version ? 'ready' : 'available',
        release: newer ? release : null,
        checkedAt,
        progress: null,
      });
    } catch (error) {
      useAppUpdate.setState(
        quiet
          ? { status: 'idle' }
          : { status: 'error', error: message(error, 'Memoria could not reach GitHub. Try again later.') },
      );
    } finally {
      checking = undefined;
    }
  })();
  return checking;
}

/**
 * Start the update for this platform. Windows downloads and stages the new
 * build; Android downloads, verifies and opens the system installer.
 */
export async function downloadUpdate(): Promise<void> {
  const { release, status } = useAppUpdate.getState();
  if (!release || status === 'downloading') return;
  const target = updateTarget();
  if (target === 'download') {
    window.open(release.url, '_blank', 'noopener');
    return;
  }
  useAppUpdate.setState({ status: 'downloading', progress: null, error: '' });
  try {
    if (target === 'desktop') {
      await window.memoriaDesktop?.update?.download();
      useAppUpdate.setState({ status: 'ready', progress: null });
      return;
    }
    const apk = release.assets.find((asset) => asset.name === APK_ASSET);
    const sums = release.assets.find((asset) => asset.name === CHECKSUM_ASSET);
    if (!apk || !sums) throw new Error(`Memoria ${release.version} has no Android download.`);
    // Android stops this app while it installs. Save the last edit first.
    await flushPersist();
    await AppUpdater.install({ apkUrl: apk.url, checksumUrl: sums.url, version: release.version });
    useAppUpdate.setState({ status: 'available', progress: null });
  } catch (error) {
    useAppUpdate.setState({
      status: 'available',
      progress: null,
      error: message(error, 'The update could not be downloaded. Try again.'),
    });
  }
}

/** Windows only: close through the normal save path, install, and reopen. */
export async function installUpdate(): Promise<void> {
  try {
    await window.memoriaDesktop?.update?.install();
  } catch (error) {
    useAppUpdate.setState({ error: message(error, 'The update could not start. Try again.') });
  }
}

export function setAutoUpdateCheck(auto: boolean): void {
  localStorage.setItem(AUTO_KEY, auto ? 'on' : 'off');
  useAppUpdate.setState({ auto });
}

export function dismissUpdateNotice(): void {
  useAppUpdate.setState((state) => ({ dismissed: state.release?.version ?? null }));
}

function trackProgress({ received, total }: { received: number; total: number }) {
  if (useAppUpdate.getState().status !== 'downloading') return;
  useAppUpdate.setState({ progress: total > 0 ? Math.min(1, received / total) : null });
}

/** Wire progress and menu events, and check on launch and twice a day while open. */
export function initAppUpdates(onShowRequested: () => void): () => void {
  const cleanups: (() => void)[] = [];
  const host = window.memoriaDesktop?.update;
  if (host) {
    cleanups.push(host.onProgress(trackProgress));
    cleanups.push(
      host.onShowRequested(() => {
        onShowRequested();
        void checkForUpdates();
      }),
    );
  }
  if (isNativeApp) {
    const listener = AppUpdater.addListener('progress', trackProgress);
    cleanups.push(() => void listener.then((handle) => handle.remove()));
  }
  // The downloadable standalone file makes no network requests on its own, and
  // development servers (and the browser tests run against them) leave
  // GitHub's shared hourly limit to installed copies.
  if (window.location.protocol === 'file:' || import.meta.env.DEV)
    return () => cleanups.forEach((cleanup) => cleanup());
  const automaticCheck = () => {
    if (useAppUpdate.getState().auto) void checkForUpdates({ quiet: true });
  };
  automaticCheck();
  const timer = window.setInterval(automaticCheck, CHECK_INTERVAL_MS);
  cleanups.push(() => window.clearInterval(timer));
  return () => cleanups.forEach((cleanup) => cleanup());
}
