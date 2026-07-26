export const LOCAL_IDENTITY = 'local';
export const ANONYMOUS_IDENTITY = 'anonymous';
/** Fixed desktop-launcher origins (see desktop/void.mjs). */
export const DESKTOP_LAUNCHER_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):1781[789]$/;

/** Anonymous sessions are memory-only; local mode retains its legacy unsuffixed key. */
export function storageKeyForIdentity(key: string, identity: string): string | null {
  if (identity === ANONYMOUS_IDENTITY) return null;
  return identity === LOCAL_IDENTITY ? key : `${key}::${identity}`;
}

/**
 * Move a same-identity product-prefix key, then any older pre-namespacing key,
 * to the current key. A completed migration is never overwritten or replayed.
 */
export function migrateLegacyStorageKeyForIdentity(
  key: string,
  identity: string,
  legacyKey: string,
  previousKey = legacyKey,
): string | null {
  const scopedKey = storageKeyForIdentity(key, identity);
  if (!scopedKey || localStorage.getItem(scopedKey) !== null) return scopedKey;

  const candidates = [storageKeyForIdentity(legacyKey, identity), previousKey, legacyKey];
  for (const candidate of candidates) {
    if (!candidate || candidate === scopedKey || localStorage.getItem(scopedKey) !== null) continue;
    const legacyValue = localStorage.getItem(candidate);
    if (legacyValue !== null) {
      try {
        localStorage.setItem(scopedKey, legacyValue);
        if (localStorage.getItem(scopedKey) === legacyValue) {
          localStorage.removeItem(candidate);
        }
      } catch {
        // Keep the source intact so a later load can retry the migration.
      }
    }
  }
  return scopedKey;
}
