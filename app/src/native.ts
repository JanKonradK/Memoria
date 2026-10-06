import { Capacitor, registerPlugin } from '@capacitor/core';
import { flushPersist } from './store';
import { useUI } from './ui-store';
import { navigateWorkspace } from './workspace-navigation';

export const isNativeApp = Capacitor.isNativePlatform();
let initialized = false;
let exiting = false;
const hasOverlay = () =>
  !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
const NativeBackup = registerPlugin<{ save(options: { text: string; fileName: string }): Promise<void> }>(
  'NativeBackup',
);
const PairingScanner = registerPlugin<{ scan(): Promise<{ text: string }> }>('PairingScanner');

/** Return the exact scan text; pairing validation belongs to the sync client. */
export async function scanPairingCode(): Promise<string> {
  const result = await PairingScanner.scan();
  return result.text;
}

export function exportNativeBackup(text: string, fileName: string): Promise<void> {
  return NativeBackup.save({ text, fileName });
}

/** Keep Android Back on the same dismissal path as the visible controls. */
export async function initNative(): Promise<void> {
  if (!isNativeApp || initialized) return;
  initialized = true;
  const { App } = await import('@capacitor/app');
  await App.addListener('backButton', () => {
    // Radix handles the top overlay and invokes each editor's unsaved-change guard.
    // Calling closeSheet directly would discard drafts in those editors.
    if (hasOverlay()) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return;
    }
    const state = useUI.getState();
    if (state.sheet) {
      state.closeSheet();
    } else if (state.focusedGameId) {
      navigateWorkspace(null, state.focusedGameId, () => state.setFocusedGameId(null));
    } else if (state.tab !== 'today') {
      state.setTab('today');
    } else {
      if (exiting) return;
      exiting = true;
      // Finishing the activity can interrupt the debounced IndexedDB write.
      // A failed save already exposes the store's recovery banner; stay open.
      void flushPersist()
        .then(() => {
          const latest = useUI.getState();
          if (latest.tab === 'today' && !latest.focusedGameId && !latest.sheet && !hasOverlay()) {
            return App.exitApp();
          }
        })
        .catch(() => undefined)
        .finally(() => {
          exiting = false;
        });
    }
  });
}
