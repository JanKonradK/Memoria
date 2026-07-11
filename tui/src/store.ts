import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import type { AppState, Game, GamePreset, Resource, Task } from '@technogg/shared';
import {
  completionId,
  emptyState,
  latestSnapshots,
  mergeState,
  normalizeState,
  projectEnergy,
} from '@technogg/shared';

/** Matches the merge-side retention in shared/src/merge.ts. */
const SNAPSHOTS_KEPT = 200;

export function dataDir(): string {
  const base = process.env.APPDATA ?? join(os.homedir(), '.config');
  return join(base, 'technogg');
}

const stateFile = (): string => join(dataDir(), 'state.json');
const configFile = (): string => join(dataDir(), 'config.json');

export interface SyncConfig {
  url: string;
  token: string;
}

export function loadConfig(): SyncConfig {
  try {
    const raw = JSON.parse(readFileSync(configFile(), 'utf8')) as Partial<SyncConfig>;
    return { url: raw.url ?? '', token: raw.token ?? '' };
  } catch {
    return { url: '', token: '' };
  }
}

export function saveConfig(cfg: SyncConfig): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(cfg, null, 2));
}

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error';

type Listener = () => void;

class Store {
  state: AppState = emptyState();
  syncStatus: SyncStatus = 'idle';
  syncError = '';
  private listeners = new Set<Listener>();

  private loadFromDisk(): AppState {
    try {
      return normalizeState(JSON.parse(readFileSync(stateFile(), 'utf8')));
    } catch {
      return emptyState();
    }
  }

  load(): void {
    this.state = this.loadFromDisk();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Atomic write: temp file + rename, so a crash never truncates the state. */
  private persist(): void {
    mkdirSync(dataDir(), { recursive: true });
    const tmp = `${stateFile()}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state));
    // Windows: rename-over transiently EPERMs while AV/indexer holds the target.
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(tmp, stateFile());
        break;
      } catch {
        if (attempt >= 4) {
          writeFileSync(stateFile(), JSON.stringify(this.state));
          break;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
    this.lastMtime = this.fileMtime();
  }

  private lastMtime = 0;

  private fileMtime(): number {
    try {
      return statSync(stateFile()).mtimeMs;
    } catch {
      return 0;
    }
  }

  /**
   * Live-follow the state file: when the launcher (PWA sync) writes it, merge
   * the changes in so an open TUI updates within a couple of seconds.
   * persist() records its own mtime above, so our writes don't echo.
   */
  startWatching(intervalMs = 2000): void {
    this.lastMtime = this.fileMtime();
    const timer = setInterval(() => {
      const m = this.fileMtime();
      if (m === this.lastMtime) return;
      this.lastMtime = m;
      this.state = mergeState(this.loadFromDisk(), this.state);
      this.emit();
    }, intervalMs);
    timer.unref();
  }

  mutate(fn: (s: AppState) => AppState): void {
    // The launcher (PWA sync) writes the same file while we're open — pick up
    // its rows before writing, or this save would clobber them.
    this.state = fn(mergeState(this.loadFromDisk(), this.state));
    this.persist();
    this.emit();
  }

  setEnergy(resourceId: string, value: number): void {
    const snap = { id: uid(), resourceId, value: Math.max(0, Math.round(value)), takenAt: Date.now() };
    this.mutate((s) => {
      const mine = s.snapshots.filter((x) => x.resourceId === resourceId);
      mine.sort((a, b) => b.takenAt - a.takenAt);
      const keep = new Set(mine.slice(0, SNAPSHOTS_KEPT - 1).map((x) => x.id));
      return {
        ...s,
        snapshots: [...s.snapshots.filter((x) => x.resourceId !== resourceId || keep.has(x.id)), snap],
      };
    });
  }

  /** Current effective (projected) value of a resource, for stepping and display. */
  projectedValue(res: Resource, now: number): number {
    return projectEnergy(res, latestSnapshots(this.state.snapshots).get(res.id), now).value;
  }

  setTaskDone(taskId: string, periodKey: string, done: boolean): void {
    this.mutate((s) => {
      const id = completionId(taskId, periodKey);
      const rest = s.completions.filter((c) => c.id !== id);
      return { ...s, completions: [...rest, { id, taskId, periodKey, done, updatedAt: Date.now() }] };
    });
  }

  importJson(text: string): boolean {
    try {
      const incoming = normalizeState(JSON.parse(text));
      this.mutate((s) => mergeState(s, incoming));
      return true;
    } catch {
      return false;
    }
  }

  addGameFromPreset(preset: GamePreset): string {
    const gameId = uid();
    const t = Date.now();
    this.mutate((s) => {
      const game: Game = {
        id: gameId,
        name: preset.name,
        short: preset.short,
        color: preset.color,
        icon: preset.icon,
        platform: preset.platform,
        tz: preset.tz,
        dailyResetHour: preset.dailyResetHour,
        weeklyResetDay: preset.weeklyResetDay,
        monthlyResetDay: preset.monthlyResetDay,
        paused: false,
        sort: Math.max(0, ...s.games.map((g) => g.sort + 1)),
        notes: preset.notes,
        processNames: preset.processNames,
        updatedAt: t,
      };
      const resources: Resource[] = preset.resources.map((r, i) => ({
        id: uid(),
        gameId,
        name: r.name,
        icon: r.icon,
        cap: r.cap,
        regenMinutes: r.regenMinutes,
        reserveCap: r.reserveCap,
        sort: i,
        updatedAt: t,
      }));
      const tasks: Task[] = preset.tasks.map((tk, i) => ({
        id: uid(),
        gameId,
        name: tk.name,
        cadence: tk.cadence,
        intervalDays: tk.intervalDays ?? 1,
        anchorAt: t,
        sort: i,
        updatedAt: t,
      }));
      return { ...s, games: [...s.games, game], resources: [...s.resources, ...resources], tasks: [...s.tasks, ...tasks] };
    });
    return gameId;
  }

  /** Push local state, receive the server-merged state, merge it back in. */
  async sync(): Promise<void> {
    const { url, token } = loadConfig();
    if (!url || !token) {
      this.syncStatus = 'idle';
      return;
    }
    this.syncStatus = 'syncing';
    this.emit();
    try {
      const res = await fetch(`${url.replace(/\/+$/, '')}/api/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ state: this.state }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { state: unknown };
      this.state = mergeState(this.state, normalizeState(data.state));
      this.persist();
      this.syncStatus = 'ok';
      this.syncError = '';
    } catch (e) {
      this.syncStatus = 'error';
      this.syncError = e instanceof Error ? e.message : String(e);
    }
    this.emit();
  }
}

export const store = new Store();

export function stateFileExists(): boolean {
  return existsSync(stateFile());
}
