import type { LegacySecretSettings } from '@void/shared';
import { LOCAL_IDENTITY, migrateLegacyStorageKeyForIdentity } from './storage-identity';

const KEY = 'void-local-secrets-v1';
const LEGACY_KEY = 'technogg-local-secrets-v1';
let activeIdentity = LOCAL_IDENTITY;

export interface LocalSecrets {
  discordWebhook: string;
  telegramToken: string;
  telegramChatId: string;
}

const EMPTY: LocalSecrets = {
  discordWebhook: '',
  telegramToken: '',
  telegramChatId: '',
};

export function setLocalSecretsIdentity(identity: string): void {
  activeIdentity = identity;
}

export function readLocalSecrets(identity = activeIdentity): LocalSecrets {
  const key = migrateLegacyStorageKeyForIdentity(KEY, identity, LEGACY_KEY);
  if (!key) return { ...EMPTY };
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<LocalSecrets>;
    return {
      discordWebhook: typeof raw.discordWebhook === 'string' ? raw.discordWebhook : '',
      telegramToken: typeof raw.telegramToken === 'string' ? raw.telegramToken : '',
      telegramChatId: typeof raw.telegramChatId === 'string' ? raw.telegramChatId : '',
    };
  } catch {
    return { ...EMPTY };
  }
}

export function updateLocalSecrets(patch: Partial<LocalSecrets>, identity = activeIdentity): LocalSecrets {
  const next = { ...readLocalSecrets(identity), ...patch };
  const key = migrateLegacyStorageKeyForIdentity(KEY, identity, LEGACY_KEY);
  if (key) localStorage.setItem(key, JSON.stringify(next));
  return next;
}

export function clearLocalSecrets(identity = activeIdentity): void {
  const key = migrateLegacyStorageKeyForIdentity(KEY, identity, LEGACY_KEY);
  if (key) localStorage.removeItem(key);
}

/** Move credentials out of a legacy AppState before normalizeState makes it syncable again. */
export function migrateLegacySecrets(raw: unknown, identity = activeIdentity): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const settings = (raw as { settings?: unknown }).settings;
  if (!settings || typeof settings !== 'object') return false;
  const legacy = settings as LegacySecretSettings;
  const patch: Partial<LocalSecrets> = {};
  if (legacy.discordWebhook) patch.discordWebhook = legacy.discordWebhook;
  if (legacy.telegramToken) patch.telegramToken = legacy.telegramToken;
  if (legacy.telegramChatId) patch.telegramChatId = legacy.telegramChatId;
  if (Object.keys(patch).length === 0) return false;
  updateLocalSecrets(patch, identity);
  return true;
}
