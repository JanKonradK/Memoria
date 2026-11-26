import { create } from 'zustand';
import { isNativeApp, nativeAutoBackup, type AutoBackupStatus } from './native';
import { useApp } from './store';

/**
 * Automatic backups on Android. Once the player picks a folder through the
 * system picker, the app keeps one file there (`memoria-auto-backup.json`) up
 * to date: at most every ten minutes while it is open, and whenever it goes to
 * the background with unsaved changes. The write runs off the main thread in
 * NativeBackupPlugin; a failure shows in Settings and never interrupts play.
 */

/** No more than one automatic write in this long while the app stays open. */
export const AUTO_BACKUP_GAP_MS = 10 * 60_000;

interface AutoBackupStore {
  status: AutoBackupStatus | null;
  busy: boolean;
  error: string;
}

export const useAutoBackup = create<AutoBackupStore>(() => ({ status: null, busy: false, error: '' }));

function message(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message)
    return error.message;
  return fallback;
}

function cancelled(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'CANCELLED';
}

async function guarded(run: () => Promise<AutoBackupStatus>, fallback: string): Promise<void> {
  useAutoBackup.setState({ busy: true, error: '' });
  try {
    useAutoBackup.setState({ status: await run() });
  } catch (error) {
    if (!cancelled(error)) useAutoBackup.setState({ error: message(error, fallback) });
  } finally {
    useAutoBackup.setState({ busy: false });
  }
}

export function refreshAutoBackup(): Promise<void> {
  if (!isNativeApp) return Promise.resolve();
  return guarded(() => nativeAutoBackup.status(), 'Automatic backups could not be checked.');
}

/** Opens the system folder picker; a picked folder gets a backup straight away. */
export async function chooseAutoBackupFolder(): Promise<void> {
  if (!isNativeApp) return;
  await guarded(() => nativeAutoBackup.pickFolder(), 'That folder could not be used.');
  if (useAutoBackup.getState().status?.enabled) await writeAutoBackupNow();
}

export function stopAutoBackup(): Promise<void> {
  if (!isNativeApp) return Promise.resolve();
  return guarded(() => nativeAutoBackup.clear(), 'Automatic backups could not be stopped.');
}

let writing: Promise<void> | undefined;
let lastWriteAt = 0;
let dirty = false;

/** Writes the current data to the chosen folder now. One write at a time. */
export function writeAutoBackupNow(): Promise<void> {
  writing ??= (async () => {
    dirty = false;
    lastWriteAt = Date.now();
    try {
      const text = JSON.stringify(useApp.getState().state);
      useAutoBackup.setState({ status: await nativeAutoBackup.write(text), error: '' });
    } catch (error) {
      // Kept dirty, so the next save or trip to the background tries again.
      dirty = true;
      useAutoBackup.setState({ error: message(error, 'The automatic backup could not be saved.') });
    } finally {
      writing = undefined;
    }
  })();
  return writing;
}

/** Watches local saves and keeps the folder's copy current. Android only. */
export function initAutoBackup(): () => void {
  if (!isNativeApp) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const enabled = () => useAutoBackup.getState().status?.enabled === true;
  const schedule = () => {
    if (!enabled() || timer) return;
    const wait = Math.max(0, lastWriteAt + AUTO_BACKUP_GAP_MS - Date.now());
    timer = setTimeout(() => {
      timer = undefined;
      if (dirty && enabled()) void writeAutoBackupNow();
    }, wait);
  };
  const stopApp = useApp.subscribe((next, prior) => {
    if (next.state === prior.state || !next.loaded) return;
    dirty = true;
    schedule();
  });
  const hidden = () => {
    if (document.visibilityState !== 'hidden' || !dirty || !enabled()) return;
    clearTimeout(timer);
    timer = undefined;
    void writeAutoBackupNow();
  };
  document.addEventListener('visibilitychange', hidden);
  void refreshAutoBackup().then(() => {
    // A folder whose last backup is older than the gap is brought up to date once at start.
    const status = useAutoBackup.getState().status;
    if (status?.enabled) {
      lastWriteAt = status.lastBackupAt ?? 0;
      dirty = dirty || !status.lastBackupAt || Date.now() - status.lastBackupAt >= AUTO_BACKUP_GAP_MS;
      if (dirty) schedule();
    }
  });
  return () => {
    clearTimeout(timer);
    stopApp();
    document.removeEventListener('visibilitychange', hidden);
  };
}
