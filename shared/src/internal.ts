/**
 * Helpers that more than one module in this package needs and that nothing
 * outside it should see. Deliberately absent from `index.ts`: exporting them
 * would make them part of the app/desktop API surface.
 */

/** A plain object (not an array, not null), or null — the shape every raw-JSON walk starts from. */
export function objectRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

/** Bucket items by key, preserving input order within each bucket. */
export function groupBy<T, K>(items: Iterable<T>, keyOf: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}
