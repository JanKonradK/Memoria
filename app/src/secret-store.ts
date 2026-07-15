import type { LegacySecretSettings } from '@technogg/shared';

const KEY = 'technogg-local-secrets-v1';

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

export function readLocalSecrets(): LocalSecrets {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LocalSecrets>;
    return {
      discordWebhook: typeof raw.discordWebhook === 'string' ? raw.discordWebhook : '',
      telegramToken: typeof raw.telegramToken === 'string' ? raw.telegramToken : '',
      telegramChatId: typeof raw.telegramChatId === 'string' ? raw.telegramChatId : '',
    };
  } catch {
    return { ...EMPTY };
  }
}

export function updateLocalSecrets(patch: Partial<LocalSecrets>): LocalSecrets {
  const next = { ...readLocalSecrets(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearLocalSecrets(): void {
  localStorage.removeItem(KEY);
}

/** Move credentials out of a legacy AppState before normalizeState makes it syncable again. */
export function migrateLegacySecrets(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const settings = (raw as { settings?: unknown }).settings;
  if (!settings || typeof settings !== 'object') return false;
  const legacy = settings as LegacySecretSettings;
  const patch: Partial<LocalSecrets> = {};
  if (legacy.discordWebhook) patch.discordWebhook = legacy.discordWebhook;
  if (legacy.telegramToken) patch.telegramToken = legacy.telegramToken;
  if (legacy.telegramChatId) patch.telegramChatId = legacy.telegramChatId;
  if (Object.keys(patch).length === 0) return false;
  updateLocalSecrets(patch);
  return true;
}
