import { emptyState, mergeState, normalizeState, safeParseAppState, type AppState } from '@memoria/shared';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { useApp } from './store';

/**
 * Sync across devices through a file in a folder that something else already
 * syncs — Google Drive, OneDrive, Proton Drive, Dropbox, Syncthing, a network
 * share. Memoria never talks to any of them. It writes one JSON file where you
 * point it, and the folder's own client carries that file between machines.
 *
 * This exists for the browser builds, above all the single-file `Memoria.html`,
 * which has no launcher behind it and therefore no `%APPDATA%\memoria\state.json`
 * for two windows to agree through (see sync.ts). Point every device at the same
 * file inside the same synced folder and they converge.
 *
 * WHY A FILE AND NOT AN ACCOUNT. Every one of those providers has an API, and
 * every one of them would mean an OAuth client, a redirect URI, a token to
 * store, and a server to hold the secret. The whole product is "runs on your own
 * machine, no account, no server". A file handle keeps that promise and works
 * for providers this file has never heard of, because the sync is somebody
 * else's problem by design.
 *
 * CONVERGENCE. Nothing here resolves conflicts, because mergeState already does:
 * last write wins per ROW on `updatedAt`, with soft-delete tombstones. Two
 * devices editing different games while both offline both land. Two devices
 * editing the SAME row keeps the later one. That is the same rule the launcher
 * sync and backup import run on, so a document that has been through this file
 * is not special in any way.
 *
 * WHAT THIS CANNOT DO. If two devices write the file while the provider's client
 * has not reconciled them, the provider — not Memoria — may keep both as
 * "memoria-sync (1).json" or similar. Nothing is lost: import the extra copy from
 * Settings → Data and the same merge absorbs it. Rare in practice, because a
 * write happens seconds after an edit and both devices re-read before writing.
 */

/** Where the picked handle lives. Handles are structured-cloneable; localStorage is not an option. */
const HANDLE_KEY = 'memoria-cloud-file';
/** Quiet period after the last edit before writing, so a burst of typing is one write. */
const WRITE_DEBOUNCE_MS = 4000;
/**
 * How often a foreground tab re-reads the file. The provider's client drops the
 * other device's bytes in without telling the page, so a poll is the only signal
 * there is — there is no equivalent of the launcher's `/api/events` push. Only
 * `lastModified` is read on a tick; the parse and merge run when it moves.
 */
const POLL_MS = 20_000;

export const CLOUD_FILE_SUGGESTED_NAME = 'memoria-sync.json';

export type CloudStatus = 'unsupported' | 'off' | 'needs-permission' | 'idle' | 'syncing' | 'ok' | 'error';

/**
 * The parts of the File System Access API this uses that TypeScript's lib.dom
 * does not declare yet. `FileSystemFileHandle` itself is standard and comes from
 * lib.dom; the picker entry points and the permission methods are not.
 */
interface FilePickerType {
  description: string;
  accept: Record<string, string[]>;
}
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerType[];
  id?: string;
  startIn?: string;
}
interface OpenFilePickerOptions {
  types?: FilePickerType[];
  multiple?: boolean;
  id?: string;
  startIn?: string;
}
type PermissionDescriptor = { mode: 'read' | 'readwrite' };
type PermissionOutcome = 'granted' | 'denied' | 'prompt';
type CloudFileHandle = FileSystemFileHandle & {
  queryPermission?: (descriptor: PermissionDescriptor) => Promise<PermissionOutcome>;
  requestPermission?: (descriptor: PermissionDescriptor) => Promise<PermissionOutcome>;
};
type FilePickerWindow = Window & {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<CloudFileHandle>;
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<CloudFileHandle[]>;
};

const JSON_TYPE: FilePickerType = {
  description: 'Memoria sync file',
  accept: { 'application/json': ['.json'] },
};

/**
 * Verified present on `file://` in Chromium, which is the case that matters:
 * the single-file build is opened by double-clicking it. Firefox and Safari ship
 * neither picker, and there is no polyfill that can hold a handle across a
 * reload — those browsers get told to use Export/Import instead.
 */
export function cloudSyncSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as FilePickerWindow;
  return typeof w.showSaveFilePicker === 'function' && typeof w.showOpenFilePicker === 'function';
}

let handle: CloudFileHandle | null = null;
let syncing = false;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let initialized = false;
/**
 * The `lastModified` of the file as this tab last saw it. A poll that finds the
 * same value does no work at all, which is what keeps a 20-second timer free.
 */
let seenModified = 0;
/**
 * The exact bytes this tab last wrote. If a merge produces the same document
 * again there is nothing to say, and skipping the write keeps the provider's
 * client from re-uploading an identical file every few seconds.
 */
let lastWritten = '';

function setStatus(status: CloudStatus, error = ''): void {
  useApp.getState().setCloudStatus(status, error);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The user dismissed the picker. Not a failure, and must not be shown as one. */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Read the file and fold it into the local document.
 *
 * A file that will not parse, or that fails the schema, is REFUSED rather than
 * repaired. Anything else would mean overwriting a good remote document with the
 * salvage of a broken one, and this file is the only copy on some other device.
 * An empty file is the normal state of a freshly created one and merges as
 * nothing.
 */
export function mergeCloudDocument(local: AppState, remoteText: string): { next: AppState; changed: boolean } {
  const trimmed = remoteText.trim();
  if (trimmed === '') return { next: local, changed: false };
  const raw = JSON.parse(trimmed) as unknown;
  // Backups are written as the bare state; accept a wrapper too, because the
  // launcher's /api/state answers `{ state, version }` and somebody will paste one.
  const candidate = raw && typeof raw === 'object' && 'state' in raw ? (raw as { state: unknown }).state : raw;
  // Shape first, and this guard is the important one. `normalizeState` SALVAGES:
  // hand it somebody else's JSON and it politely answers an empty document, the
  // merge adds nothing, and the next write replaces their file with Memoria's
  // data. A picker makes that a single misclick. Nothing is written unless the
  // file already looks like a Memoria document — the same test the backup import
  // applies, for the same reason.
  if (!candidate || typeof candidate !== 'object' || (!('games' in candidate) && !('settings' in candidate))) {
    throw new Error('That file is not a Memoria document — nothing was written to it.');
  }
  const parsed = safeParseAppState(normalizeState(candidate));
  if (!parsed.success) throw new Error(`The sync file is not a valid Memoria document: ${parsed.error}`);
  const next = mergeState(local, parsed.data);
  return { next, changed: JSON.stringify(next) !== JSON.stringify(local) };
}

/**
 * Write the document in the shape a MERGE produces, never the in-memory one.
 *
 * Anything read back out of this file has been through mergeState, and mergeState
 * does more than normalize: among other things it materialises the per-field
 * settings clocks that an untouched document leaves implicit. Write the raw store
 * state and the very next sync reads it back, merges, gets something spelled
 * differently, calls that a change, and writes again — a loop with a provider
 * upload and every other device's download attached to each turn of it.
 * `mergeState(state, emptyState())` is that same shape and is a fixed point, so
 * one write settles.
 */
function serialize(state: AppState): string {
  return `${JSON.stringify(mergeState(state, emptyState()), null, 2)}\n`;
}

async function write(text: string): Promise<void> {
  if (!handle) return;
  // createWritable() stages into a swap file and commits on close(), so a crash
  // or a pulled USB stick leaves the previous document rather than half of one.
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
  await writable.close();
  lastWritten = text;
  const file = await handle.getFile();
  seenModified = file.lastModified;
}

async function permissionFor(target: CloudFileHandle, request: boolean): Promise<PermissionOutcome> {
  const descriptor: PermissionDescriptor = { mode: 'readwrite' };
  // Older Chromium exposed neither method on the handle. Treat that as granted:
  // the picker had just returned it, so the grant is implied for this session.
  const query = target.queryPermission ? await target.queryPermission(descriptor) : 'granted';
  if (query === 'granted' || !request) return query;
  return target.requestPermission ? await target.requestPermission(descriptor) : 'granted';
}

/**
 * Read, merge, write back if the merge changed anything.
 *
 * Read-before-write is what makes this safe with more than two devices: whatever
 * another machine put in the file is folded in before this one's version of the
 * document replaces it, so a write can only ever add.
 */
export async function cloudSyncNow(): Promise<void> {
  if (!handle || syncing) return;
  syncing = true;
  setStatus('syncing');
  try {
    const file = await handle.getFile();
    const remoteText = await file.text();
    const { next, changed } = mergeCloudDocument(useApp.getState().state, remoteText);
    if (changed) useApp.getState().replaceState(next);
    seenModified = file.lastModified;

    const outgoing = serialize(useApp.getState().state);
    // The remote already says exactly this. Writing it again would only give the
    // provider's client another upload to do and every other device another
    // download, so the quiet case stays quiet.
    if (outgoing !== remoteText && outgoing !== lastWritten) await write(outgoing);
    else lastWritten = outgoing;
    setStatus('ok');
  } catch (error) {
    // A handle whose grant lapsed — the folder moved, the file was deleted, the
    // browser dropped the permission — is recoverable, but only from a click.
    if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
      setStatus('needs-permission', 'Memoria needs permission to read the sync file again.');
    } else if (error instanceof DOMException && error.name === 'NotFoundError') {
      setStatus('error', 'The sync file is gone — reconnect to pick it again.');
    } else {
      setStatus('error', message(error));
    }
  } finally {
    syncing = false;
  }
}

function scheduleWrite(delay = WRITE_DEBOUNCE_MS): void {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => void cloudSyncNow(), delay);
}

/** Cheap tick: only the file's timestamp is read unless it actually moved. */
async function pollForRemoteChange(): Promise<void> {
  if (!handle || syncing || document.hidden) return;
  try {
    const file = await handle.getFile();
    if (file.lastModified > seenModified) await cloudSyncNow();
  } catch {
    // A transient read failure while the provider's client swaps the file is
    // normal. The next tick, or the next edit, retries.
  }
}

function startTimers(): void {
  if (pollTimer !== undefined) return;
  pollTimer = setInterval(() => void pollForRemoteChange(), POLL_MS);
}

function stopTimers(): void {
  clearTimeout(writeTimer);
  writeTimer = undefined;
  clearInterval(pollTimer);
  pollTimer = undefined;
}

async function adopt(next: CloudFileHandle): Promise<void> {
  handle = next;
  seenModified = 0;
  lastWritten = '';
  await idbSet(HANDLE_KEY, next);
  useApp.getState().setCloudFileName(next.name);
  startTimers();
  await cloudSyncNow();
}

/**
 * Create (or overwrite) a sync file. The save picker is the right one even
 * though nothing is being "saved" yet: it is the only picker that lets the user
 * name a new file, and it happily returns an existing one if they pick it.
 */
export async function connectNewCloudFile(): Promise<boolean> {
  const w = window as FilePickerWindow;
  if (!w.showSaveFilePicker) return false;
  try {
    const picked = await w.showSaveFilePicker({
      suggestedName: CLOUD_FILE_SUGGESTED_NAME,
      types: [JSON_TYPE],
      // `id` makes the browser reopen at the folder last used for this purpose,
      // which for almost everyone is the cloud folder they just chose.
      id: 'memoria-cloud-sync',
      startIn: 'documents',
    });
    await adopt(picked);
    return true;
  } catch (error) {
    if (!isAbort(error)) setStatus('error', message(error));
    return false;
  }
}

/** Join a file another device already created. This is the second-device path. */
export async function connectExistingCloudFile(): Promise<boolean> {
  const w = window as FilePickerWindow;
  if (!w.showOpenFilePicker) return false;
  try {
    const [picked] = await w.showOpenFilePicker({
      types: [JSON_TYPE],
      multiple: false,
      id: 'memoria-cloud-sync',
      startIn: 'documents',
    });
    if (!picked) return false;
    // The open picker grants read only. Ask for write before anything is merged,
    // so a device cannot silently end up reading forever and never contributing.
    if ((await permissionFor(picked, true)) !== 'granted') {
      setStatus('needs-permission', 'Memoria can read that file but not write to it.');
      return false;
    }
    await adopt(picked);
    return true;
  } catch (error) {
    if (!isAbort(error)) setStatus('error', message(error));
    return false;
  }
}

/**
 * Re-grant a stored handle. Chromium drops the write grant on some restarts and
 * will only restore it from inside a user gesture, which is why this is a button
 * in Settings and not something the boot path can do for you.
 */
export async function reconnectCloudFile(): Promise<boolean> {
  if (!handle) return false;
  try {
    if ((await permissionFor(handle, true)) !== 'granted') {
      setStatus('needs-permission', 'Permission was not granted.');
      return false;
    }
    startTimers();
    await cloudSyncNow();
    return true;
  } catch (error) {
    setStatus('error', message(error));
    return false;
  }
}

/**
 * Stop syncing on THIS device. The file is left exactly as it is: it is the
 * other devices' document too, and deleting it here would be a data loss dressed
 * up as a settings change.
 */
export async function disconnectCloudFile(): Promise<void> {
  stopTimers();
  handle = null;
  seenModified = 0;
  lastWritten = '';
  await idbDel(HANDLE_KEY).catch(() => undefined);
  useApp.getState().setCloudFileName('');
  setStatus('off');
}

/**
 * Wire the listeners and pick up a handle from a previous session.
 *
 * Safe to call in any build. With no stored handle it settles on 'off' (or
 * 'unsupported') and costs nothing; the launcher build can run it alongside
 * sync.ts, because the two write to different places and both go through the
 * same merge.
 */
export function initCloudSync(): void {
  if (initialized) return;
  initialized = true;
  if (!cloudSyncSupported()) {
    setStatus('unsupported');
    return;
  }

  document.addEventListener('tg-mutated', () => {
    if (handle) scheduleWrite();
  });
  document.addEventListener('visibilitychange', () => {
    // Coming back to the tab is the likeliest moment for the file to have moved
    // under it, and the likeliest moment for the user to be about to read it.
    if (!document.hidden && handle) void cloudSyncNow();
  });

  void (async () => {
    try {
      const stored = (await idbGet(HANDLE_KEY)) as CloudFileHandle | undefined;
      if (!stored) {
        setStatus('off');
        return;
      }
      handle = stored;
      useApp.getState().setCloudFileName(stored.name);
      if ((await permissionFor(stored, false)) === 'granted') {
        startTimers();
        await cloudSyncNow();
        return;
      }
      setStatus('needs-permission', 'Memoria needs permission to open the sync file again.');
    } catch (error) {
      setStatus('error', message(error));
    }
  })();
}

/** Test seam: drop every timer, listener state and handle held by this module. */
export function resetCloudSyncState(): void {
  stopTimers();
  handle = null;
  syncing = false;
  initialized = false;
  seenModified = 0;
  lastWritten = '';
}
