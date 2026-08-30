type RegisterOptions = {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
};

/**
 * Stands in for `virtual:pwa-register` in the single-file build. A `file://` page
 * cannot register a service worker, and the vite-plugin-pwa virtual module does
 * not exist when the plugin is left out, so `pwa.ts` binds to this instead.
 */
export const registerSW: (options?: RegisterOptions) => (reloadPage?: boolean) => Promise<void> = () => async () =>
  undefined;
