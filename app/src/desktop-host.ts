import { useLayoutEffect } from 'react';
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
  onCloseRequested(listener: (requestId: string) => void): () => void;
  completeClose(requestId: string, result: DesktopCloseResult): void;
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
        if (drafts.size > 0 && !window.confirm('Close Memoria and discard your unsaved changes?')) {
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
