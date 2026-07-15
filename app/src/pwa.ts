import { registerSW } from 'virtual:pwa-register';

let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined;

export function initPwa(): void {
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      document.dispatchEvent(new CustomEvent('tg-update-available'));
    },
  });
}

export function applyPwaUpdate(): void {
  void updateServiceWorker?.(true);
}
