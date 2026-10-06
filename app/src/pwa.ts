import { registerSW } from 'virtual:pwa-register';
import { flushPersist } from './store';

let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined;

export function initPwa(): void {
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      document.dispatchEvent(new CustomEvent('tg-update-available'));
    },
  });
}

export async function applyPwaUpdate(): Promise<void> {
  try {
    // Reloading must wait for the last local edit. A failed save leaves the
    // current app and its recovery controls available.
    await flushPersist();
  } catch {
    return;
  }
  await updateServiceWorker?.(true);
}
