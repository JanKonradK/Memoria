type RegisterOptions = {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
};

/**
 * Stands in for `virtual:pwa-register` under Vitest, where the vite-plugin-pwa
 * virtual module does not exist, so `pwa.ts` binds to this instead.
 */
export const registerSW: (options?: RegisterOptions) => (reloadPage?: boolean) => Promise<void> = () => async () =>
  undefined;
