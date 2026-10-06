import { useLayoutEffect } from 'react';
import { flushPersist, useApp } from './store';
import { flushSync } from './sync';
import type { DesktopPlay } from './desktop-play';
import type { HoyoNativeAccount, HoyoNativeReading } from './hoyo-native';
import type { ConnectionResponse } from './game-connections';

export interface DesktopCloseResult {
  allow: boolean;
  error?: string;
}

/** Narrow native actions only, never Node, cookies or arbitrary IPC. */
export interface DesktopHost {
  version: 1;
  play?: DesktopPlay;
  hoyo?: {
    connect(): Promise<{ connected: boolean }>;
    disconnect(): Promise<{ connected: boolean }>;
    listAccounts(options: { provider: HoyoNativeReading['provider'] }): Promise<{ accounts: HoyoNativeAccount[] }>;
    connectAccount(options: {
      gameId: string;
      provider: HoyoNativeReading['provider'];
      uid: string;
      server: string;
      autoRefresh: boolean;
    }): Promise<ConnectionResponse>;
  };
  onCloseRequested(listener: (requestId: string) => void): () => void;
  completeClose(requestId: string, result: DesktopCloseResult): void;
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
