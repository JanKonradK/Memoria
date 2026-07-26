export type StateMigration = (raw: unknown) => unknown;

export const MIGRATIONS: Readonly<Record<number, StateMigration>> = {};

/**
 * Schema versions 1 -> 2 and 2 -> 3 were migrated implicitly by
 * inferLegacyResource and inferLegacyTask during normalization. This stub makes
 * future explicit migrations discoverable without retrofitting a runner today.
 */
export function migrateState(raw: unknown): unknown {
  return raw;
}
