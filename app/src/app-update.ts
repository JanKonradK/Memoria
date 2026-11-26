import type { ReleaseManifest, TrustStamp } from '@memoria/shared/publisher';
import { CapacitorHttp, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  APP_VERSION,
  CHECKED_KEY,
  compareVersions,
  isCurrentLine,
  updateTarget,
  useAppUpdate,
  worthAScreen,
} from './app-update-state';
import type { ReleaseInfo } from './desktop-host';
import { initEntitlements } from './entitlements';
import { isNativeApp } from './native';
import { flushPersist } from './store';

export {
  APP_VERSION,
  compareVersions,
  dismissUpdateNotice,
  displayVersion,
  isCurrentLine,
  releaseChanges,
  releaseNotes,
  setAutoUpdateCheck,
  showUpdate,
  updateTarget,
  useAppUpdate,
  worthAScreen,
  type UpdateStatus,
  type UpdateTarget,
} from './app-update-state';

const RELEASES_API = 'https://api.github.com/repos/JanKonradK/Memoria/releases?per_page=30';
const RELEASES_PAGE = 'https://github.com/JanKonradK/Memoria/releases/latest';
const APK_ASSET = 'Memoria-android.apk';
const MANIFEST_ASSET = 'release-manifest.json';
const TRUST_KEY = 'memoria-release-trust';
async function verifiedManifest(release: ReleaseInfo): Promise<ReleaseManifest> {
  const asset = release.assets.find((a) => a.name === MANIFEST_ASSET);
  if (!asset) throw new Error('This release has no publisher signature.');
  // GitHub release downloads have no browser CORS headers. The REST release
  // body carries the same signed envelope for web readers.
  const embedded = /<!-- memoria-signed-release (.+?) -->/.exec(release.notes)?.[1];
  const text =
    embedded ??
    (isNativeApp
      ? await CapacitorHttp.get({
          url: asset.url,
          responseType: 'text',
          connectTimeout: 8000,
          readTimeout: 15000,
        }).then((response) => {
          if (response.status !== 200) throw new Error('The signed release manifest could not be downloaded.');
          return String(response.data);
        })
      : await fetch(asset.url).then((response) => {
          if (!response.ok) throw new Error('The signed release manifest could not be downloaded.');
          return response.text();
        }));
  if (typeof text !== 'string') throw new Error('The signed release manifest is missing.');
  if (text.length > 2_000_000) throw new Error('The release manifest is too large.');
  const previous = JSON.parse(localStorage.getItem(TRUST_KEY) ?? 'null') as TrustStamp | null;
  // The signature check is the heaviest code here; it loads only for a newer release.
  const { verifyPublished, RELEASE_CONTEXT } = await import('@memoria/shared/publisher');
  const { data, stamp } = verifyPublished<ReleaseManifest>(JSON.parse(text), RELEASE_CONTEXT, previous);
  if (data.version !== release.version || data.tag !== release.tag)
    throw new Error('The signed release does not match this version.');
  localStorage.setItem(TRUST_KEY, JSON.stringify(stamp));
  return data;
}
const RATE_LIMITED = 'GitHub limits update checks. Try again in an hour.';
/** A window left open checks again this often. */
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

const AppUpdater = registerPlugin<{
  install(options: { apkUrl: string; expectedSha256: string; version: string }): Promise<void>;
  addListener(
    event: 'progress',
    listener: (progress: { received: number; total: number }) => void,
  ): Promise<PluginListenerHandle>;
}>('AppUpdater');

/** The Electron build prefixed errors with the IPC channel; people need only the reason. */
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
  const body = (await response.json()) as unknown;
  const releases = (Array.isArray(body) ? (body as Record<string, unknown>[]) : [])
    .filter((raw) => !raw['draft'] && !raw['prerelease'] && isCurrentLine(String(raw['tag_name'] ?? '')))
    .map((raw): ReleaseInfo => {
      const tag = String(raw['tag_name']);
      const assets = Array.isArray(raw['assets']) ? (raw['assets'] as Record<string, unknown>[]) : [];
      return {
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
      };
    })
    .sort((a, b) => compareVersions(b.version, a.version));
  const latest = releases[0];
  if (!latest) return { release: null, staged: null };
  if (compareVersions(latest.version, APP_VERSION) > 0) await verifiedManifest(latest);
  const newer = releases.filter((release) => compareVersions(release.version, APP_VERSION) > 0);
  return {
    release: {
      ...latest,
      changes: newer.map(({ version, notes, publishedAt }) => ({ version, notes, publishedAt })),
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
      useAppUpdate.setState((state) => ({
        status: !newer ? 'current' : staged === release.version ? 'ready' : 'available',
        release: newer ? release : null,
        checkedAt,
        progress: null,
        // An automatic check opens the update screen once per launch, and only for a
        // release with something to say; Later keeps it closed. Asking always opens it.
        open:
          Boolean(newer) &&
          (!quiet || state.open || (state.dismissed !== release?.version && worthAScreen(release!.version))),
      }));
    } catch (error) {
      useAppUpdate.setState(
        quiet
          ? { status: 'idle' }
          : { status: 'error', error: message(error, 'Could not reach GitHub. Try again later.') },
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
    const manifest = await verifiedManifest(release);
    const expectedSha256 = manifest.files[APK_ASSET];
    if (!apk || !/^[a-f0-9]{64}$/.test(expectedSha256 ?? ''))
      throw new Error(`Version ${release.version} has no Android download.`);
    // Android stops this app while it installs. Save the last edit first.
    await flushPersist();
    await AppUpdater.install({ apkUrl: apk.url, expectedSha256: expectedSha256!, version: release.version });
    useAppUpdate.setState({ status: 'available', progress: null });
  } catch (error) {
    useAppUpdate.setState({
      status: 'available',
      progress: null,
      error: message(error, 'Download failed. Try again.'),
    });
  }
}

/** Windows only: close through the normal save path, install, and reopen. */
export async function installUpdate(): Promise<void> {
  try {
    await window.memoriaDesktop?.update?.install();
  } catch (error) {
    useAppUpdate.setState({ error: message(error, 'Update failed to start. Try again.') });
  }
}

function trackProgress({ received, total }: { received: number; total: number }) {
  if (useAppUpdate.getState().status !== 'downloading') return;
  useAppUpdate.setState({ progress: total > 0 ? Math.min(1, received / total) : null });
}

/**
 * Wire progress and menu events, and check on launch and twice a day while open.
 * Android first learns which build it is: the Google Play build never asks GitHub.
 */
export function initAppUpdates(onShowRequested: () => void): () => void {
  const cleanups: (() => void)[] = [];
  let stopped = false;
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
  const start = () => {
    if (stopped || updateTarget() === 'none') return;
    if (isNativeApp) {
      const listener = AppUpdater.addListener('progress', trackProgress);
      cleanups.push(() => void listener.then((handle) => handle.remove()).catch(() => undefined));
    }
    // Development servers (and the browser tests run against them) leave
    // GitHub's shared hourly limit to installed copies.
    if (import.meta.env.DEV) return;
    const automaticCheck = () => {
      if (useAppUpdate.getState().auto) void checkForUpdates({ quiet: true });
    };
    automaticCheck();
    const timer = window.setInterval(automaticCheck, CHECK_INTERVAL_MS);
    cleanups.push(() => window.clearInterval(timer));
  };
  if (isNativeApp) void initEntitlements().then(start);
  else start();
  return () => {
    stopped = true;
    cleanups.forEach((cleanup) => cleanup());
  };
}
