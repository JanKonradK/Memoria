import { create } from 'zustand';
import { isDesktopApp, type ReleaseInfo } from './desktop-host';
import { useEntitlements } from './entitlements';
import { servedByLauncher } from './launcher';
import { isNativeApp } from './native';

/*
 * What screens read about updates. The checks, downloads and the signature
 * verifier live in app-update.ts and load after the first screen.
 */

export const APP_VERSION = __APP_VERSION__;

/** How a version reads to people: the real number, as a beta. 0.1.0 shows as "Beta 0.1.0". */
export function displayVersion(version: string): string {
  return `Beta ${version.replace(/^v/, '')}`;
}

/**
 * Versions restarted at 0.1.0 in November 2026. Releases since then are tagged
 * with the bare number (`0.1.0`); the earlier line was tagged `v2.0.0` to
 * `v4.0.3`. Those old numbers are higher, so they must never count as updates.
 */
export function isCurrentLine(tag: string): boolean {
  return /^\d+\.\d+\.\d+/.test(tag);
}
const AUTO_KEY = 'memoria-update-auto';
export const CHECKED_KEY = 'memoria-update-checked-at';

/**
 * How this copy installs a new version: the Windows app swaps its own files,
 * Android hands a verified APK to the system installer, and the browser copies
 * open the download page. A browser tab served by the PC app updates with it.
 * The Google Play build is updated by Play, so it has no updater of its own;
 * neither does an Android copy that has not yet said which build it is.
 */
export type UpdateTarget = 'desktop' | 'android' | 'download' | 'none';

export function updateTarget(): UpdateTarget {
  if (isDesktopApp()) return window.memoriaDesktop?.update ? 'desktop' : 'none';
  if (isNativeApp) return useEntitlements.getState().distribution === 'direct' ? 'android' : 'none';
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
  /** A version closed with Later stays closed until the next launch. */
  dismissed: string | null;
  /** The full-screen update view is showing. */
  open: boolean;
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
  open: false,
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

/**
 * A release earns the full-screen page when it changes the major or minor
 * number. A patch is fixes: it waits quietly in Settings → Activity & About.
 */
export function worthAScreen(version: string, current = APP_VERSION): boolean {
  const head = (value: string) =>
    value
      .replace(/^v/, '')
      .split(/[.-]/, 2)
      .map((part) => Number.parseInt(part, 10) || 0);
  const [major, minor] = head(version);
  const [currentMajor, currentMinor] = head(current);
  return major !== currentMajor || minor !== currentMinor;
}

/** The release notes above the download table the release workflow appends. */
export function releaseNotes(release: Pick<ReleaseInfo, 'notes'>): string {
  return release.notes.split(/^##\s+Downloads?\b/im)[0]?.trim() ?? '';
}

/** What changed in every version newer than this copy, newest first. */
export function releaseChanges(release: ReleaseInfo): { version: string; notes: string; publishedAt: string | null }[] {
  const changes = release.changes?.length ? release.changes : [release];
  return changes.map((change) => ({ ...change, notes: releaseNotes(change) }));
}

export function setAutoUpdateCheck(auto: boolean): void {
  localStorage.setItem(AUTO_KEY, auto ? 'on' : 'off');
  useAppUpdate.setState({ auto });
}

/** Close the update screen until the next launch. */
export function dismissUpdateNotice(): void {
  useAppUpdate.setState((state) => ({ dismissed: state.release?.version ?? null, open: false }));
}

export function showUpdate(): void {
  if (useAppUpdate.getState().release) useAppUpdate.setState({ open: true });
}
