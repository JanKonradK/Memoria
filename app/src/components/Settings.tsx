import { useRef, useState, type ReactNode } from 'react';
import { detectLocalTz, normalizeState, safeParseAppState } from '@memoria/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { servedByLauncher } from '../launcher';
import { syncNow } from '../sync';
import { deviceSyncAvailable, DeviceSync } from './settings/DeviceSync';
import { SettingRow, SettingsGroup } from './settings/SettingRow';
import { usePresence } from '../presence';
import { APP_VERSION, updateTarget, useAppUpdate } from '../app-update';
import { useMediaQuery } from '../hooks';
import type { SettingsSection } from '../ui-store';
import { DeviceNotifications } from './settings/DeviceNotifications';
import { AppUpdates } from './settings/AppUpdates';
import { DesktopPresence } from './settings/DesktopPresence';
import { GameLogo } from './GameLogo';
import { disconnectLanSync } from '../lan-sync';
import { exportNativeBackup, isNativeApp } from '../native';
import { useUnsavedDraft } from '../desktop-host';
import {
  CLOUD_FILE_SUGGESTED_NAME,
  cloudSyncNow,
  cloudSyncSupported,
  connectExistingCloudFile,
  connectNewCloudFile,
  disconnectCloudFile,
  reconnectCloudFile,
} from '../cloud-sync';
import { resolveHomeTimeZone, SYSTEM_TIMEZONE_VALUE } from '../timezone';
import { fmtClock, intOr, localResetLabel } from '../util';
import { HomeTimeZoneField } from './HomeTimeZoneField';
import { Pill } from './primitives';
import { rosterGames, useIdentityColors } from './roster';
import { Btn, NumInput, Page, TOUCH_BUTTON } from './ui';
// Today is lazy-loaded, so its heading rule is brought in here as well.
import '../today.css';
import '../settings.css';

export function SettingsPage() {
  const state = useApp((store) => store.state);
  const syncStatus = useApp((store) => store.syncStatus);
  const syncError = useApp((store) => store.syncError);
  const cloudStatus = useApp((store) => store.cloudStatus);
  const cloudError = useApp((store) => store.cloudError);
  const cloudFileName = useApp((store) => store.cloudFileName);
  const lastCloudSyncAt = useApp((store) => store.lastCloudSyncAt);
  const lastSyncAt = useApp((store) => store.lastSyncAt);
  const updateSettings = useApp((store) => store.updateSettings);
  const importStateJson = useApp((store) => store.importJson);
  const clearLocalData = useApp((store) => store.clearLocalData);
  const openSheet = useUI((state) => state.openSheet);
  const requestedSection = useUI((state) => state.settingsSection);
  const openSettings = useUI((state) => state.openSettings);
  const split = useMediaQuery('(min-width: 900px)');
  const presence = usePresence((store) => store.presence);
  const update = useAppUpdate();
  const launcher = servedByLauncher();
  const settings = state.settings;
  const focusedGameId = useUI((s) => s.focusedGameId);
  const detectedTz = detectLocalTz();
  const games = rosterGames(state.games);
  const identityColors = useIdentityColors(state.games);
  // A focused game narrows this page too, so the roster shows the one game the
  // rest of the app is showing. A focus on a game that is gone narrows nothing.
  const listedGames = games.some((game) => game.id === focusedGameId)
    ? games.filter((game) => game.id === focusedGameId)
    : games;
  const [statusMessage, setStatusMessage] = useState('');
  const [importDraft, setImportDraft] = useState<{ text: string; games: number; events: number } | null>(null);
  useUnsavedDraft(importDraft !== null);
  const importRequest = useRef(0);
  const cloudSupported = cloudSyncSupported();
  const cloudConnected = cloudFileName !== '' && cloudStatus !== 'off' && cloudStatus !== 'unsupported';
  const reportError = (error: unknown) => setStatusMessage(error instanceof Error ? error.message : String(error));
  const syncSizeWarning = syncStatus === 'error' && syncError.startsWith('Local data is ');

  const exportJson = () => {
    const text = JSON.stringify(state, null, 2);
    const fileName = `memoria-backup-${new Date().toISOString().slice(0, 10)}.json`;
    if (isNativeApp) {
      void exportNativeBackup(text, fileName).catch((error: unknown) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'CANCELLED') return;
        reportError(error);
      });
      return;
    }
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = (file: File | undefined) => {
    if (!file) return;
    const request = ++importRequest.current;
    setImportDraft(null);
    setStatusMessage('');
    if (file.size > 1_000_000) {
      setStatusMessage('Import failed: backup is over 1 MB.');
      return;
    }
    void file
      .text()
      .then((text) => {
        if (request !== importRequest.current) return;
        try {
          const raw = JSON.parse(text) as unknown;
          const candidate = raw && typeof raw === 'object' && 'state' in raw ? (raw as { state: unknown }).state : raw;
          if (!candidate || typeof candidate !== 'object' || (!('games' in candidate) && !('settings' in candidate)))
            throw new Error('Not a Memoria backup');
          const parsed = safeParseAppState(candidate);
          if (!parsed.success) throw new Error(parsed.error);
          const incoming = normalizeState(candidate);
          setImportDraft({
            text: JSON.stringify(candidate),
            games: incoming.games.filter((g) => !g.deleted).length,
            events: incoming.events.filter((e) => !e.deleted).length,
          });
          setStatusMessage('');
        } catch {
          setImportDraft(null);
          setStatusMessage('Import failed: not a Memoria backup.');
        }
      })
      .catch((error: unknown) => {
        if (request === importRequest.current) reportError(error);
      });
  };

  const syncBadge = cloudConnected && cloudStatus === 'ok' ? cloudFileName : undefined;
  const sections: Array<{ key: SettingsSection; label: string; badge?: ReactNode }> = [
    { key: 'games', label: 'Games', badge: <span className="numeral">{games.length}</span> },
    { key: 'sync', label: 'Device sync', badge: syncBadge },
  ];
  if (presence || isNativeApp) sections.push({ key: 'device', label: isNativeApp ? 'On this device' : 'On this PC' });
  if (updateTarget() !== 'none')
    sections.push({
      key: 'updates',
      label: 'Updates',
      badge: update.release ? <span className="settings-nav-new">New</span> : APP_VERSION,
    });
  sections.push({ key: 'data', label: 'Data' });
  const active = sections.some((section) => section.key === requestedSection) ? requestedSection : 'games';
  // A wide window shows one pane beside the menu; a narrow one is one page of every section.
  const pane = (key: SettingsSection) => ({
    id: key,
    title: sections.find((section) => section.key === key)?.label ?? '',
    hidden: split && key !== active,
  });
  const syncAvailable = deviceSyncAvailable();

  return (
    <Page className="settings-page">
      <div data-tour="settings" className="settings-shell">
        <div className="settings-heading">
          <h1 className="text-title font-semibold tracking-[-0.02em] text-fg">Settings</h1>
          <Btn onClick={() => openSheet({ kind: 'guide' })}>User guide</Btn>
        </div>

        <div className="settings-layout">
          {split && (
            <nav className="settings-nav" aria-label="Settings sections">
              <ul>
                {sections.map((section) => (
                  <li key={section.key}>
                    <button
                      type="button"
                      className="settings-nav-item"
                      aria-current={section.key === active ? 'page' : undefined}
                      onClick={() => openSettings(section.key)}
                    >
                      <span className="min-w-0 truncate text-body font-semibold">{section.label}</span>
                      {section.badge !== undefined && (
                        <span className="settings-nav-badge aside truncate text-caption">{section.badge}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <div className="settings-panes">
            <SettingsPane {...pane('games')}>
              <div className="settings-rows">
                <SettingRow
                  label="Sleep window"
                  hint="How long you are away overnight. Today checks what caps in that time."
                >
                  <div className="flex items-center gap-2">
                    <NumInput
                      className="!min-h-11 !w-24 sm:!min-h-8 sm:!py-1"
                      min={1}
                      max={12}
                      value={String(settings.sleepHours)}
                      aria-label="Sleep window (hours)"
                      onChange={(e) =>
                        updateSettings({
                          sleepHours: Math.min(12, Math.max(1, intOr(e.target.value, settings.sleepHours))),
                        })
                      }
                    />
                    <span className="text-label text-dim">hours</span>
                  </div>
                </SettingRow>
                <SettingRow label="Home timezone" hint="Resets and countdowns are shown on this clock.">
                  <HomeTimeZoneField
                    value={settings.localTz === detectedTz ? SYSTEM_TIMEZONE_VALUE : settings.localTz}
                    resolvedTz={settings.localTz}
                    detectedTz={detectedTz}
                    onChange={(value) => updateSettings({ localTz: resolveHomeTimeZone(value) })}
                  />
                </SettingRow>
              </div>

              <SettingsGroup
                title="Your games"
                action={
                  <Btn className={TOUCH_BUTTON} onClick={() => openSheet({ kind: 'addGame' })}>
                    Add a game
                  </Btn>
                }
              >
                {games.length > 0 ? (
                  <div className="settings-game-list">
                    {listedGames.map((game) => {
                      const colors = identityColors[game.id] ?? game;
                      const resources = state.resources.filter((r) => r.gameId === game.id && !r.deleted).length;
                      const tasks = state.tasks.filter((t) => t.gameId === game.id && !t.deleted).length;
                      return (
                        // One button, one destination: the game's full editor.
                        <button
                          key={game.id}
                          type="button"
                          aria-label={`Game settings for ${game.name}${game.accountLabel ? `, ${game.accountLabel}` : ''}`}
                          onClick={() => openSheet({ kind: 'game', gameId: game.id })}
                          className="settings-game-row group flex min-h-14 w-full items-center rounded-ui-lg text-left transition duration-(--dur-fast) hover:bg-fill-1"
                        >
                          {/* The identity trio is merged in so two accounts of one game draw one ring. */}
                          <GameLogo game={{ ...game, ...colors }} size={52} className="shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="min-w-0 text-body font-semibold text-fg [overflow-wrap:anywhere]">
                                {game.name}
                              </span>
                              {game.paused && <Pill variant="paused">paused</Pill>}
                            </div>
                            <span className="aside block text-label text-muted [overflow-wrap:anywhere]">
                              {game.accountLabel ? `${game.accountLabel} · ` : ''}reset{' '}
                              {localResetLabel(game, settings.localTz, Date.now())}
                            </span>
                            <p className="aside numeral text-label text-muted">
                              {resources} resource{resources === 1 ? '' : 's'} · {tasks} task{tasks === 1 ? '' : 's'}
                            </p>
                          </div>
                          {/* The row's own pressed state made visible, not a second control. */}
                          <span
                            aria-hidden="true"
                            className="settings-game-action btn-compact flex min-h-11 shrink-0 items-center gap-1.5 rounded-ui-md bg-fill-2 px-3 text-meta font-semibold text-muted ring-1 ring-line-hairline transition duration-(--dur-fast) group-hover:bg-fill-3 group-hover:text-fg-soft group-hover:ring-line-strong group-focus-visible:bg-fill-3 group-focus-visible:text-fg-soft group-focus-visible:ring-line-strong group-active:scale-[0.97] sm:min-h-8"
                          >
                            <svg
                              viewBox="0 0 20 20"
                              fill="none"
                              stroke="currentColor"
                              className="icon h-4 w-4"
                              aria-hidden
                            >
                              <path
                                d="M13.4 3.3a1.8 1.8 0 0 1 2.5 2.5l-8.2 8.2-3.3.8.8-3.3 8.2-8.2z"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <path d="M12.6 4.6l2.5 2.5" strokeLinecap="round" />
                            </svg>
                            Edit
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="settings-note text-body text-dim">No games yet.</p>
                )}
              </SettingsGroup>
            </SettingsPane>

            <SettingsPane {...pane('sync')}>
              <div className="settings-sync-grid">
                {syncAvailable && (
                  <SettingsGroup title="Wi-Fi sync">
                    <div className="settings-note">
                      <DeviceSync />
                    </div>
                  </SettingsGroup>
                )}
                {!isNativeApp && (
                  <SettingsGroup title="Shared-folder sync">
                    <div className="settings-note space-y-3">
                      <p className="aside text-meta text-muted">
                        One file in a synced folder, such as Google Drive or OneDrive, shared by every device.
                      </p>
                      {!cloudSupported && (
                        <p className="text-meta text-muted">Needs Chrome or Edge. Use Export and Import instead.</p>
                      )}
                      {cloudSupported && !cloudConnected && (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <Btn
                              kind={syncAvailable ? 'ghost' : 'primary'}
                              className={TOUCH_BUTTON}
                              onClick={() => {
                                setStatusMessage('');
                                void connectNewCloudFile()
                                  .then((ok) => ok && setStatusMessage('Syncing.'))
                                  .catch(reportError);
                              }}
                            >
                              Create sync file…
                            </Btn>
                            <Btn
                              className={TOUCH_BUTTON}
                              onClick={() => {
                                setStatusMessage('');
                                void connectExistingCloudFile()
                                  .then((ok) => ok && setStatusMessage('Syncing.'))
                                  .catch(reportError);
                              }}
                            >
                              Use existing file…
                            </Btn>
                          </div>
                          <p className="aside text-label text-muted">
                            Create <code className="text-fg-soft">{CLOUD_FILE_SUGGESTED_NAME}</code> on the first
                            device. Pick it on the others.
                          </p>
                        </>
                      )}
                      {cloudSupported && cloudConnected && (
                        <div className="flex flex-wrap items-center gap-3">
                          {cloudStatus === 'needs-permission' ? (
                            <Btn
                              kind="primary"
                              className={TOUCH_BUTTON}
                              onClick={() => void reconnectCloudFile().catch(reportError)}
                            >
                              Reconnect
                            </Btn>
                          ) : (
                            <Btn
                              kind="primary"
                              className={TOUCH_BUTTON}
                              onClick={() => void cloudSyncNow().catch(reportError)}
                            >
                              Sync now
                            </Btn>
                          )}
                          <Btn
                            className={TOUCH_BUTTON}
                            onClick={() => {
                              void disconnectCloudFile()
                                .then(() => setStatusMessage('Stopped syncing.'))
                                .catch(reportError);
                            }}
                          >
                            Stop syncing
                          </Btn>
                          <span className="text-meta text-muted">
                            <span className="text-fg-soft">{cloudFileName}</span>
                            {cloudStatus === 'syncing' && ' · syncing…'}
                            {cloudStatus === 'ok' &&
                              lastCloudSyncAt !== null &&
                              ` · ✓ ${fmtClock(lastCloudSyncAt, settings.localTz)}`}
                          </span>
                        </div>
                      )}
                      {(cloudStatus === 'error' || cloudStatus === 'needs-permission') && cloudError && (
                        <p className="border-l-2 border-warn/60 pl-3 text-meta text-warn-fg" role="status">
                          {cloudError}
                        </p>
                      )}
                    </div>
                  </SettingsGroup>
                )}
              </div>
            </SettingsPane>

            {(presence || isNativeApp) && (
              <SettingsPane {...pane('device')}>
                <div className="settings-rows">
                  <DesktopPresence />
                  <DeviceNotifications />
                </div>
              </SettingsPane>
            )}

            {updateTarget() !== 'none' && (
              <SettingsPane {...pane('updates')}>
                <div className="settings-rows">
                  <AppUpdates />
                </div>
              </SettingsPane>
            )}

            <SettingsPane {...pane('data')}>
              <div className="settings-rows">
                {launcher && (
                  <SettingRow
                    label="Save to this PC"
                    hint={
                      <span role="status">
                        {syncStatus === 'syncing'
                          ? 'Saving…'
                          : syncStatus === 'ok' && lastSyncAt
                            ? `✓ Saved ${fmtClock(lastSyncAt, settings.localTz)}. Changes save on their own.`
                            : 'Changes save on their own.'}
                      </span>
                    }
                  >
                    <Btn className={TOUCH_BUTTON} onClick={() => void syncNow().catch(reportError)}>
                      Save now
                    </Btn>
                  </SettingRow>
                )}
                {syncStatus === 'error' && (
                  <p
                    className={`settings-note border-l-2 pl-3 text-meta ${syncSizeWarning ? 'border-warn/60 text-warn-fg' : 'border-danger/60 text-danger-fg'}`}
                    role="status"
                  >
                    {syncError}
                  </p>
                )}
                <SettingRow
                  label="Backup"
                  hint={
                    <span className="numeral">
                      {games.length} games · {state.events.filter((e) => !e.deleted).length} events
                    </span>
                  }
                >
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Btn className={TOUCH_BUTTON} onClick={exportJson}>
                      Export backup
                    </Btn>
                    <label className="focus-ring-group btn-compact flex min-h-11 cursor-pointer items-center rounded-ui-md bg-fill-2 px-3 py-1 text-caption font-semibold text-fg-soft ring-1 ring-line-hairline transition hover:bg-fill-3 sm:min-h-8">
                      Import backup
                      {/* sr-only, never `hidden`: display:none drops the input out of the
                          tab order and the wrapping label is not focusable. */}
                      <input
                        type="file"
                        accept="application/json"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          importJson(file);
                        }}
                      />
                    </label>
                  </div>
                </SettingRow>
                {importDraft && (
                  <div className="settings-note my-3 border-l-2 border-warn/60 pl-3">
                    <p className="text-body font-semibold text-warn-fg">
                      Merge backup with {importDraft.games} game{importDraft.games === 1 ? '' : 's'} and{' '}
                      {importDraft.events} event
                      {importDraft.events === 1 ? '' : 's'}?
                    </p>
                    <p className="mt-1 text-meta text-muted">Where both changed an item, the newer edit wins.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Btn
                        kind="primary"
                        className={TOUCH_BUTTON}
                        onClick={() => {
                          const ok = importStateJson(importDraft.text);
                          setStatusMessage(ok ? 'Backup merged.' : 'Import failed.');
                          setImportDraft(null);
                        }}
                      >
                        Merge backup
                      </Btn>
                      <Btn className={TOUCH_BUTTON} onClick={() => setImportDraft(null)}>
                        Cancel
                      </Btn>
                    </div>
                  </div>
                )}
                <SettingRow label="Clear local data" hint="Deletes every game, reading and event on this device.">
                  <Btn
                    kind="danger"
                    className={TOUCH_BUTTON}
                    onClick={() => {
                      if (
                        !window.confirm(
                          'Delete all Memoria data in this browser? Export a backup first if you need one.',
                        )
                      )
                        return;
                      void disconnectLanSync()
                        .then(clearLocalData)
                        .then(() => {
                          if (!useApp.getState().loadError) setStatusMessage('Local data cleared.');
                        })
                        .catch(reportError);
                    }}
                  >
                    Clear local data
                  </Btn>
                </SettingRow>
              </div>
            </SettingsPane>

            {/* One status line for actions in any pane: backups, shared-folder sync, clearing data. */}
            {statusMessage && (
              <p className="settings-status text-meta text-muted" role="status">
                {statusMessage}
              </p>
            )}
          </div>
        </div>
      </div>
    </Page>
  );
}

/** One section of Settings. Beside the menu only the chosen one is shown; on a phone, all are. */
function SettingsPane({
  id,
  title,
  hidden,
  children,
}: {
  id: SettingsSection;
  title: string;
  hidden: boolean;
  children: ReactNode;
}) {
  if (hidden) return null;
  return (
    <section id={`settings-pane-${id}`} className="settings-pane min-w-0" aria-labelledby={`settings-${id}-heading`}>
      <div className="settings-pane-heading">
        <h2 id={`settings-${id}-heading`} className="font-semibold text-fg-soft">
          {title}
        </h2>
        <span aria-hidden />
      </div>
      {children}
    </section>
  );
}
