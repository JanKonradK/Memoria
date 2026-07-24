import { useEffect, useState } from 'react';
import type { AlertType, IntegrationKind, IntegrationStatus } from '@technogg/shared';
import { alertTypeLabel, DEFAULT_THRESHOLDS, normalizeState, safeParseAppState } from '@technogg/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { useSession } from '../auth';
import { getSyncConfig, sendTestPing, setSyncConfig, syncNow } from '../sync';
import {
  disconnectIntegration,
  deleteHostedAccount,
  exportHostedAccount,
  getIntegrationStatuses,
  integrationsHosted,
  saveIntegration,
} from '../integrations';
import { readLocalSecrets, updateLocalSecrets, type LocalSecrets } from '../secret-store';
import { fmtClock, intOr, minToTimeInput, timeInputToMin } from '../util';
import { Pill } from './primitives';
import { Btn, Field, GameBadge, NumInput, Page, SectionTitle, Segmented, TextInput, Toggle } from './ui';

const ALERT_TYPES: AlertType[] = ['energy_cap', 'daily_undone', 'weekly_undone', 'monthly_undone', 'event_end'];

export function SettingsPage() {
  const app = useApp();
  const openSheet = useUI((state) => state.openSheet);
  const textSize = useUI((state) => state.textSize);
  const setTextSize = useUI((state) => state.setTextSize);
  const session = useSession();
  const settings = app.state.settings;
  const games = app.state.games.filter((game) => !game.deleted).sort((a, b) => a.sort - b.sort);
  const [syncCfg, setSyncCfgLocal] = useState(getSyncConfig());
  const [pingResult, setPingResult] = useState('');
  const [secrets, setSecrets] = useState<LocalSecrets>(() => readLocalSecrets());
  const [integrationStatuses, setIntegrationStatuses] = useState<IntegrationStatus[]>([]);
  const [importDraft, setImportDraft] = useState<{ text: string; games: number; events: number } | null>(null);

  const refreshStatuses = async () => {
    if (!integrationsHosted()) return;
    setIntegrationStatuses(await getIntegrationStatuses());
  };

  useEffect(() => {
    void refreshStatuses().catch((error) => setPingResult(error instanceof Error ? error.message : String(error)));
  }, []);

  const integrationStatus = (kind: IntegrationKind) => integrationStatuses.find((item) => item.kind === kind);
  const saveSecret = async (kind: IntegrationKind, value: Record<string, string>) => {
    setPingResult('Saving encrypted integration…');
    try {
      if (integrationsHosted()) {
        await saveIntegration(kind, value);
        await refreshStatuses();
      } else {
        const patch =
          kind === 'discord'
            ? { discordWebhook: value.webhook ?? '' }
            : { telegramToken: value.token ?? '', telegramChatId: value.chatId ?? '' };
        setSecrets(updateLocalSecrets(patch));
      }
      setPingResult('Integration saved.');
    } catch (error) {
      setPingResult(error instanceof Error ? error.message : String(error));
    }
  };

  const saveSyncCfg = () => {
    setSyncConfig(syncCfg);
    void syncNow();
  };

  const globalRule = (type: AlertType) =>
    app.state.alertRules.find((r) => r.type === type && r.gameId === null && !r.deleted);

  const exportJson = async () => {
    const data = session.hosted ? await exportHostedAccount() : app.state;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `technogg-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_000_000) {
      setImportDraft(null);
      setPingResult('Import failed — backup exceeds the 1 MB account limit.');
      return;
    }
    void file.text().then((text) => {
      try {
        const raw = JSON.parse(text) as unknown;
        const candidate = raw && typeof raw === 'object' && 'state' in raw ? (raw as { state: unknown }).state : raw;
        if (!candidate || typeof candidate !== 'object' || (!('games' in candidate) && !('settings' in candidate)))
          throw new Error("Not a Techno's Library backup");
        const normalized = normalizeState(candidate);
        const parsed = safeParseAppState(normalized);
        if (!parsed.success) throw new Error(parsed.error);
        const incoming = parsed.data;
        setImportDraft({
          text: JSON.stringify(candidate),
          games: incoming.games.filter((g) => !g.deleted).length,
          events: incoming.events.filter((e) => !e.deleted).length,
        });
        setPingResult('');
      } catch {
        setImportDraft(null);
        setPingResult("Import failed — not a valid Techno's Library backup file.");
      }
    });
  };

  return (
    <Page className="pb-28 pt-5">
      <div className="mx-auto max-w-[1600px]">
        <h2 className="mb-3 text-title font-black tracking-tight text-slate-100">Settings</h2>

        {/* grid-cols-1 (minmax(0,1fr)) caps the single-column track at the viewport
            so wide cards shrink instead of overflowing at small widths / large text. */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          <section className="glass gold-hairline rounded-ui-card p-5 lg:col-span-2 2xl:col-span-3" aria-label="Games">
            <div className="flex items-center justify-between gap-3">
              <SectionTitle>Games</SectionTitle>
              <Btn onClick={() => openSheet({ kind: 'addGame' })}>+ Add game</Btn>
            </div>
            {games.length > 0 ? (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {games.map((game) => (
                  <div
                    key={game.id}
                    className="flex min-h-14 items-center gap-3 rounded-ui-xl bg-white/[0.035] px-3 py-2 ring-1 ring-white/10"
                  >
                    <GameBadge short={game.short} color={game.color} color2={game.color2} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-body font-bold text-fg-soft">{game.name}</span>
                        {game.paused && <Pill variant="paused">paused</Pill>}
                      </div>
                      <span className="text-label text-dim">
                        reset {String(game.dailyResetHour).padStart(2, '0')}:00 server
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openSheet({ kind: 'game', gameId: game.id })}
                      className="min-h-9 shrink-0 rounded-ui-lg bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-fg-soft ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
                      aria-label={`Edit ${game.name}`}
                    >
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-body text-dim">No games yet. Add one to start tracking resources and tasks.</p>
            )}
          </section>

          <section className="glass gold-hairline rounded-ui-card p-5" aria-label="Display and appearance">
            <SectionTitle>Display</SectionTitle>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-body font-semibold text-fg-soft">Text size</p>
                <p className="mt-0.5 text-label text-dim">Scales labels, values, tasks, and navigation.</p>
              </div>
              <Segmented
                options={[
                  { value: 's', label: 'S' },
                  { value: 'm', label: 'M' },
                  { value: 'l', label: 'L' },
                  { value: 'xl', label: 'XL' },
                ]}
                value={textSize}
                onChange={setTextSize}
                ariaLabel="Text size"
              />
            </div>
          </section>

          <section className="glass gold-hairline rounded-ui-card p-5">
            <SectionTitle>{session.hosted ? 'Account and sync' : 'Advanced local sync'}</SectionTitle>
            {session.hosted ? (
              <div className="space-y-3">
                <p className="text-body font-semibold text-fg-soft">{session.displayName}</p>
                <p className="text-xs text-muted">
                  This device remains IndexedDB-first. Changes sync to your private account document whenever you are
                  online.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Btn kind="primary" onClick={() => void syncNow()}>
                    Sync now
                  </Btn>
                  <Btn onClick={session.manageAccount}>Manage devices</Btn>
                  <Btn onClick={() => void session.signOut()}>Sign out</Btn>
                  <span className="text-xs text-muted">
                    {app.syncStatus === 'syncing' && 'Syncing…'}
                    {app.syncStatus === 'ok' && app.lastSyncAt && `✓ Synced ${fmtClock(app.lastSyncAt)}`}
                    {app.syncStatus === 'error' && <span className="text-rose-300">{app.syncError}</span>}
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted">
                  Optional self-host/desktop mode. The public hosted product uses account sessions instead of shared
                  tokens.
                </p>
                <Field label="Server URL">
                  <TextInput
                    placeholder="http://127.0.0.1:17817"
                    value={syncCfg.url}
                    onChange={(e) => setSyncCfgLocal({ ...syncCfg, url: e.target.value })}
                  />
                </Field>
                <Field label="Local sync token">
                  <TextInput
                    type="password"
                    value={syncCfg.token}
                    onChange={(e) => setSyncCfgLocal({ ...syncCfg, token: e.target.value })}
                  />
                </Field>
                <Btn kind="primary" onClick={saveSyncCfg}>
                  Save and sync
                </Btn>
              </div>
            )}
          </section>

          <section className="glass gold-hairline rounded-ui-card p-5">
            <SectionTitle>Notifications</SectionTitle>
            <div className="space-y-3">
              <Field label="Discord webhook URL">
                <TextInput
                  placeholder="https://discord.com/api/webhooks/…"
                  type="password"
                  value={secrets.discordWebhook}
                  onChange={(e) => setSecrets({ ...secrets, discordWebhook: e.target.value.trim() })}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Btn
                  onClick={() => void saveSecret('discord', { webhook: secrets.discordWebhook })}
                  disabled={!secrets.discordWebhook}
                >
                  {integrationStatus('discord')?.connected ? 'Update Discord' : 'Connect Discord'}
                </Btn>
                {integrationStatus('discord')?.connected && (
                  <>
                    <span className="text-xs text-emerald-300">{integrationStatus('discord')?.maskedLabel}</span>
                    <Btn
                      onClick={() =>
                        void disconnectIntegration('discord').then(() => {
                          setSecrets({ ...secrets, discordWebhook: '' });
                          return refreshStatuses();
                        })
                      }
                    >
                      Disconnect
                    </Btn>
                  </>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Telegram bot token">
                  <TextInput
                    type="password"
                    placeholder="123456:ABC-…"
                    value={secrets.telegramToken}
                    onChange={(e) => setSecrets({ ...secrets, telegramToken: e.target.value.trim() })}
                  />
                </Field>
                <Field label="Telegram chat id">
                  <TextInput
                    placeholder="e.g. 123456789"
                    value={secrets.telegramChatId}
                    onChange={(e) => setSecrets({ ...secrets, telegramChatId: e.target.value.trim() })}
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Btn
                  onClick={() =>
                    void saveSecret('telegram', { token: secrets.telegramToken, chatId: secrets.telegramChatId })
                  }
                  disabled={!secrets.telegramToken || !secrets.telegramChatId}
                >
                  {integrationStatus('telegram')?.connected ? 'Update Telegram' : 'Connect Telegram'}
                </Btn>
                {integrationStatus('telegram')?.connected && (
                  <>
                    <span className="text-xs text-emerald-300">{integrationStatus('telegram')?.maskedLabel}</span>
                    <Btn
                      onClick={() =>
                        void disconnectIntegration('telegram').then(() => {
                          setSecrets({ ...secrets, telegramToken: '', telegramChatId: '' });
                          return refreshStatuses();
                        })
                      }
                    >
                      Disconnect
                    </Btn>
                  </>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Quiet hours start">
                  <TextInput
                    type="time"
                    value={minToTimeInput(settings.quietStart)}
                    onChange={(e) => app.updateSettings({ quietStart: timeInputToMin(e.target.value) })}
                  />
                </Field>
                <Field label="Quiet hours end">
                  <TextInput
                    type="time"
                    value={minToTimeInput(settings.quietEnd)}
                    onChange={(e) => app.updateSettings({ quietEnd: timeInputToMin(e.target.value) })}
                  />
                </Field>
              </div>
              <Field label="Your timezone (for alert clock times + quiet hours)">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <TextInput
                    value={settings.localTz}
                    onChange={(e) => app.updateSettings({ localTz: e.target.value })}
                  />
                  <Btn
                    className="shrink-0"
                    onClick={() => app.updateSettings({ localTz: Intl.DateTimeFormat().resolvedOptions().timeZone })}
                  >
                    Use device
                  </Btn>
                </div>
              </Field>
              <Field label="Sleep window (hours)">
                <NumInput
                  min={1}
                  max={12}
                  value={String(settings.sleepHours)}
                  onChange={(e) =>
                    app.updateSettings({
                      sleepHours: Math.min(12, Math.max(1, intOr(e.target.value, settings.sleepHours))),
                    })
                  }
                />
              </Field>
              <p className="text-label text-dim">Used by the evening “sleep safe” check on game cards.</p>
              <div className="flex items-center gap-3">
                <Btn
                  onClick={() => {
                    setPingResult('Sending…');
                    void sendTestPing().then(setPingResult);
                  }}
                >
                  Send test ping
                </Btn>
                {pingResult && <span className="text-xs text-muted">{pingResult}</span>}
              </div>
            </div>
          </section>

          <section className="glass gold-hairline rounded-ui-card p-5">
            <SectionTitle>Alert timing (global defaults)</SectionTitle>
            <div className="space-y-2.5">
              {ALERT_TYPES.map((type) => {
                const rule = globalRule(type);
                const enabled = rule?.enabled ?? true;
                const minutes = rule?.thresholdMinutes ?? DEFAULT_THRESHOLDS[type];
                return (
                  <div key={type} className="grid grid-cols-[44px_minmax(0,1fr)_96px] items-center gap-2">
                    <Toggle
                      checked={enabled}
                      onChange={(v) => app.upsertRule({ type, gameId: null, enabled: v, thresholdMinutes: minutes })}
                      ariaLabel={`${enabled ? 'Disable' : 'Enable'} ${alertTypeLabel(type)}`}
                    />
                    <span className="flex-1 text-body text-fg-soft">{alertTypeLabel(type)}</span>
                    <div>
                      <NumInput
                        className="!w-24"
                        value={String(minutes)}
                        aria-label={`${alertTypeLabel(type)} minutes before`}
                        onChange={(e) =>
                          app.upsertRule({
                            type,
                            gameId: null,
                            enabled,
                            thresholdMinutes: Math.max(5, intOr(e.target.value, minutes)),
                          })
                        }
                      />
                      <span className="mt-1 block text-caption text-dim">minutes before</span>
                    </div>
                  </div>
                );
              })}
              <p className="text-label text-dim">
                e.g. "Energy nearing cap · 120" pings when a resource is within 2 hours of capping.
              </p>
            </div>
          </section>

          <section className="glass gold-hairline rounded-ui-card p-5">
            <SectionTitle>Data</SectionTitle>
            <div className="flex flex-wrap items-center gap-2 pb-1">
              <Btn onClick={() => void exportJson()}>Export backup</Btn>
              <label className="flex min-h-11 cursor-pointer items-center rounded-ui-lg bg-white/5 px-4 py-2 text-body font-semibold text-fg-soft ring-1 ring-white/10 transition hover:bg-white/10 sm:min-h-9">
                Import backup
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => importJson(e.target.files?.[0])}
                />
              </label>
              <span className="text-label text-dim">
                {app.state.games.filter((g) => !g.deleted).length} games ·{' '}
                {app.state.events.filter((e) => !e.deleted).length} events
              </span>
            </div>
            {importDraft && (
              <div className="mt-3 rounded-ui-xl bg-amber-300/10 p-3 ring-1 ring-amber-300/20">
                <p className="text-body font-semibold text-amber-100">
                  Merge backup with {importDraft.games} game{importDraft.games === 1 ? '' : 's'} and{' '}
                  {importDraft.events} event
                  {importDraft.events === 1 ? '' : 's'}?
                </p>
                <p className="mt-1 text-xs text-muted">
                  Newer rows win. Existing local data is not replaced wholesale.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Btn
                    kind="primary"
                    onClick={() => {
                      const ok = app.importJson(importDraft.text);
                      setPingResult(ok ? 'Backup imported and merged.' : 'Import failed.');
                      setImportDraft(null);
                    }}
                  >
                    Merge backup
                  </Btn>
                  <Btn onClick={() => setImportDraft(null)}>Cancel</Btn>
                </div>
              </div>
            )}
            {session.hosted && (
              <div className="mt-5 border-t border-rose-300/15 pt-4">
                <p className="text-xs text-muted">
                  Account deletion permanently removes the cloud document, encrypted integrations, alert ledger and
                  Clerk identity. Export first if you need a copy.
                </p>
                <Btn
                  className="mt-3 text-rose-200 ring-rose-300/25"
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Permanently delete your Techno's Library account and all cloud data? This cannot be undone.",
                      )
                    )
                      return;
                    void deleteHostedAccount().then(async () => {
                      await app.clearLocalData();
                      await session.signOut();
                    });
                  }}
                >
                  Delete account permanently
                </Btn>
              </div>
            )}
          </section>
        </div>
      </div>
    </Page>
  );
}
