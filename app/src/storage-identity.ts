export const LOCAL_IDENTITY = 'local';
export const ANONYMOUS_IDENTITY = 'anonymous';
/** Fixed desktop-launcher origins (see desktop/technogg.mjs). */
export const DESKTOP_LAUNCHER_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):1781[789]$/;

/** Anonymous sessions are memory-only; local mode retains its legacy unsuffixed key. */
export function storageKeyForIdentity(legacyKey: string, identity: string): string | null {
  if (identity === ANONYMOUS_IDENTITY) return null;
  return identity === LOCAL_IDENTITY ? legacyKey : `${legacyKey}::${identity}`;
}
