import { Activity } from './settings/Activity';
import { lazy, Suspense, useRef, useState, type ReactNode } from 'react';
import { detectLocalTz, normalizeState, safeParseAppState } from '@memoria/shared';
import { useApp } from '../store';
import { PageBar, PageTitle } from './shell/PageBar';
import { useUI, type ThemePreference } from '../ui-store';
import { servedByLauncher } from '../launcher';
import { syncNow } from '../sync';
import { deviceSyncAvailable, DeviceSync } from './settings/DeviceSync';
import { PaletteSettings } from './settings/PaletteSettings';
import { DetailRow, LookPicker, VibrationRow } from './settings/LookPicker';
import { GameIconsRow, IconSetRow } from './settings/IconPicker';
import { MarkPicker, StorePreviewRow } from './settings/MarkPicker';
import { SettingRow, SettingsGroup } from './settings/SettingRow';
import { usePresence } from '../presence';
import { APP_VERSION, displayVersion, updateTarget, useAppUpdate } from '../app-update-state';
import { useMediaQuery } from '../hooks';
import type { SettingsSection } from '../ui-store';
import { RemindersPane } from './settings/RemindersPane';
import { AppUpdates } from './settings/AppUpdates';
import { AutoBackupRow } from './settings/AutoBackup';
import { useEntitlements } from '../entitlements';
import { DesktopPresence } from './settings/DesktopPresence';
import { GameRosterRow } from './settings/GameRosterRow';
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
import { fmtClock } from '../util';
import { HomeTimeZoneField } from './HomeTimeZoneField';
import { rosterGames, useIdentityColors } from './roster';
import { Btn, FileButton, Page, Segmented } from './ui';
import { confirmDialog } from './ConfirmDialog';
// Today is lazy-loaded, so its heading rule is brought in here as well.
import '../today.css';
import '../settings.css';

const MAX_BACKUP_BYTES = 20_000_000;
const Connections = lazy(() => import('./settings/Connections').then((m) => ({ default: m.Connections })));

export function SettingsPage() {
  // Only what the page shows: a snapshot or a tick elsewhere does not redraw Settings.
  const settings = useApp((store) => store.state.settings);
  const trackedGames = useApp((store) => store.state.games);
  const eventCount = useApp((store) => store.state.events.filter((e) => !e.deleted).length);
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
  const picked = useUI((state) => state.settingsPicked);
  const closeSection = useUI((state) => state.closeSettingsSection);
  const split = useMediaQuery('(min-width: 900px)');
  const touch = useMediaQuery('(pointer: coarse)');
  const presence = usePresence((store) => store.presence);
  const update = useAppUpdate();
  // The Android build (GitHub or Play) decides whether the updater rows show.
  useEntitlements((store) => store.distribution);
  const launcher = servedByLauncher();
  const detectedTz = detectLocalTz();
  const games = rosterGames(trackedGames);
  const identityColors = useIdentityColors(trackedGames);
  const [statusMessage, setStatusMessage] = useState('');
  const [importDraft, setImportDraft] = useState<{ text: string; games: number; events: number } | null>(null);
  useUnsavedDraft(importDraft !== null);
  const importRequest = useRef(0);
  const cloudSupported = cloudSyncSupported();
  const cloudConnected = cloudFileName !== '' && cloudStatus !== 'off' && cloudStatus !== 'unsupported';
  const reportError = (error: unknown) => setStatusMessage(error instanceof Error ? error.message : String(error));
  const syncSizeWarning = syncStatus === 'error' && syncError.startsWith('Local data is ');

  const exportJson = () => {
    const text = JSON.stringify(useApp.getState().state, null, 2);
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
    if (file.size > MAX_BACKUP_BYTES) {
      setStatusMessage('Import failed: backup is over 20 MB.');
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
          // Older backups migrate on import; only a newer one is refused, by the schema.
          const parsed = safeParseAppState(candidate);
          if (!parsed.success) throw new Error(parsed.error);
          const incoming = normalizeState(candidate);
          setImportDraft({
            text: JSON.stringify(candidate),
            games: incoming.games.filter((g) => !g.deleted).length,
            events: incoming.events.filter((e) => !e.deleted).length,
          });
          setStatusMessage('');
        } catch (error) {
          setImportDraft(null);
          setStatusMessage(
            error instanceof Error && /newer|schemaVersion/i.test(error.message)
              ? 'This backup needs a newer version of Memoria. Update the app, then import it.'
              : 'Import failed: not a Memoria backup.',
          );
        }
      })
      .catch((error: unknown) => {
        if (request === importRequest.current) reportError(error);
      });
  };

  const syncBadge = cloudConnected && cloudStatus === 'ok' ? cloudFileName : undefined;
  const sections: Array<{ key: SettingsSection; label: string; badge?: ReactNode }> = [
    { key: 'games', label: 'Games', badge: <span className="numeral">{games.length}</span> },
    { key: 'reminders', label: 'Time & reminders' },
    { key: 'appearance', label: 'Appearance' },
    { key: 'sync', label: 'Device sync', badge: syncBadge },
    { key: 'connections', label: 'Accounts' },
  ];
  if (presence) sections.push({ key: 'device', label: 'This PC' });
  sections.push(
    { key: 'data', label: 'Data' },
    {
      key: 'activity',
      label: 'Activity & About',
      badge:
        update.release && updateTarget() !== 'none' ? (
          <span className="settings-nav-new">New</span>
        ) : (
          <span className="numeral">{displayVersion(APP_VERSION)}</span>
        ),
    },
  );
  const active = sections.some((section) => section.key === requestedSection) ? requestedSection : 'games';
  // A wide window shows one pane beside the menu; a narrow one is one page of every section.
  // A narrow screen is a menu, then one section at a time, like the phone's own settings.
  const menu = !split && !picked;
  // On a narrow screen, choosing a section pushes it in from the right and Back
  // brings the menu in from the left, as a phone's own settings do. Kept with
  // the menu state it was decided on; nothing moves on a first arrival.
  const [step, setStep] = useState<{ menu: boolean; split: boolean; way?: 'forward' | 'back' }>({ menu, split });
  if (step.menu !== menu || step.split !== split) {
    setStep({ menu, split, way: step.split === split ? (menu ? 'back' : 'forward') : undefined });
  }
  const pane = (key: SettingsSection) => ({
    id: key,
    title: sections.find((section) => section.key === key)?.label ?? '',
    hidden: menu || key !== active,
    titled: split,
  });
  const activeLabel = sections.find((section) => section.key === active)?.label ?? 'Settings';
  const syncAvailable = deviceSyncAvailable();

  return (
    <Page className="settings-page">
      <PageBar>
        {!split && !menu && (
          <button type="button" className="settings-back" onClick={closeSection} aria-label="Back to Settings">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="m12.5 4.5-5.5 5.5 5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <PageTitle>{split || menu ? 'Settings' : activeLabel}</PageTitle>
      </PageBar>
      <div className="settings-shell">
        <div className="settings-layout" data-step={split ? undefined : step.way}>
          {(split || menu) && (
            <nav className={`settings-nav ${menu ? 'settings-menu' : ''}`} aria-label="Settings sections">
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
                        <span className="settings-nav-badge truncate text-caption">{section.badge}</span>
                      )}
                      {menu && (
                        <svg
                          viewBox="0 0 20 20"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          aria-hidden
                          className="settings-menu-chevron"
                        >
                          <path d="m7.5 4.5 5.5 5.5-5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <div className="settings-panes">
            <SettingsPane
              {...pane('games')}
              action={<Btn onClick={() => openSheet({ kind: 'addGame' })}>Add a game</Btn>}
            >
              {games.length > 0 ? (
                <ul className="settings-roster" aria-label="Your games">
                  {games.map((game) => (
                    <GameRosterRow
                      key={game.id}
                      game={game}
                      colors={identityColors[game.id] ?? game}
                      localTz={settings.localTz}
                    />
                  ))}
                </ul>
              ) : (
                <p className="settings-note text-body text-dim">No games yet.</p>
              )}
            </SettingsPane>

            {/* The clock every reset and reminder is read on, then everything that reaches you outside the app. */}
            <SettingsPane {...pane('reminders')}>
              <div className="settings-rows">
                <SettingRow label="Home timezone" hint="Resets, countdowns and reminders are shown on this clock.">
                  <HomeTimeZoneField
                    value={settings.localTz === detectedTz ? SYSTEM_TIMEZONE_VALUE : settings.localTz}
                    resolvedTz={settings.localTz}
                    detectedTz={detectedTz}
                    onChange={(value) => updateSettings({ localTz: resolveHomeTimeZone(value) })}
                  />
                </SettingRow>
              </div>
              <RemindersPane />
            </SettingsPane>

            {/* How the app looks and feels, then Memoria's own mark, apart from it. */}
            <SettingsPane {...pane('appearance')}>
              <div className="settings-rows">
                <LookPicker />
                <ThemeRow />
                <PaletteSettings />
                <DetailRow />
                <VibrationRow />
                <IconSetRow />
                <GameIconsRow />
              </div>
              <SettingsGroup title="Brand">
                <div className="settings-rows">
                  <MarkPicker />
                  <StorePreviewRow />
                </div>
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
                      <p className="say aside text-meta text-muted">
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
                          <p className="say aside text-label text-muted">
                            Create <code className="text-fg-soft">{CLOUD_FILE_SUGGESTED_NAME}</code> on the first
                            device. Pick it on the others.
                          </p>
                        </>
                      )}
                      {cloudSupported && cloudConnected && (
                        <div className="flex flex-wrap items-center gap-3">
                          {cloudStatus === 'needs-permission' ? (
                            <Btn kind="primary" onClick={() => void reconnectCloudFile().catch(reportError)}>
                              Reconnect
                            </Btn>
                          ) : (
                            <Btn kind="primary" onClick={() => void cloudSyncNow().catch(reportError)}>
                              Sync now
                            </Btn>
                          )}
                          <Btn
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

            <SettingsPane {...pane('connections')}>
              <Suspense fallback={null}>
                <Connections />
              </Suspense>
            </SettingsPane>

            {presence && (
              <SettingsPane {...pane('device')}>
                <div className="settings-rows">
                  <DesktopPresence />
                </div>
              </SettingsPane>
            )}

            <SettingsPane {...pane('data')}>
              <div className="settings-rows">
                {launcher && (
                  <SettingRow
                    label="Save to this PC"
                    hintKind="fact"
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
                    <Btn onClick={() => void syncNow().catch(reportError)}>Save now</Btn>
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
                  hintKind="fact"
                  hint={
                    <span className="numeral">
                      {games.length} game{games.length === 1 ? '' : 's'} · {eventCount} event
                      {eventCount === 1 ? '' : 's'}
                    </span>
                  }
                >
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Btn onClick={exportJson}>Export backup</Btn>
                    <FileButton accept="application/json" onFile={importJson}>
                      Import backup
                    </FileButton>
                  </div>
                </SettingRow>
                {isNativeApp && <AutoBackupRow />}
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
                        onClick={() => {
                          const ok = importStateJson(importDraft.text);
                          setStatusMessage(ok ? 'Backup merged.' : 'Import failed.');
                          setImportDraft(null);
                        }}
                      >
                        Merge backup
                      </Btn>
                      <Btn onClick={() => setImportDraft(null)}>Cancel</Btn>
                    </div>
                  </div>
                )}
                <SettingRow label="Clear local data" hint="Deletes every game, reading and event on this device.">
                  <Btn
                    kind="danger"
                    onClick={async () => {
                      const clear = await confirmDialog({
                        title: 'Delete all Memoria data on this device?',
                        description: 'Export a backup first if you need one.',
                        confirmLabel: 'Clear local data',
                        danger: true,
                      });
                      if (!clear) return;
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

            {/* The app itself, its version, tour and keys, then what has changed on this device. */}
            <SettingsPane {...pane('activity')}>
              <SettingsGroup title="About">
                <div className="settings-rows">
                  {updateTarget() === 'none' ? (
                    <SettingRow label="Memoria" hint={displayVersion(APP_VERSION)} hintKind="fact" />
                  ) : (
                    <AppUpdates />
                  )}
                  <SettingRow
                    label="Guide"
                    hint="Today, bars, your games, overnight and getting around, in five steps."
                  >
                    <Btn onClick={() => openSheet({ kind: 'guide' })}>Open guide</Btn>
                  </SettingRow>
                  {/* Keys need a keyboard: on a touch screen there is nothing to show. */}
                  {!touch && (
                    <SettingRow label="Keyboard shortcuts" hint="Every key Memoria answers to, on one sheet.">
                      <Btn onClick={() => openSheet({ kind: 'shortcuts' })}>Show shortcuts</Btn>
                    </SettingRow>
                  )}
                </div>
              </SettingsGroup>
              <Activity />
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
const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Device' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

/** Light or dark, following the device unless a theme is chosen. */
function ThemeRow() {
  const preference = useUI((s) => s.themePreference);
  const setPreference = useUI((s) => s.setThemePreference);
  return (
    <SettingRow label="Theme" hint="Device follows this device's light or dark setting.">
      <Segmented ariaLabel="Theme" options={THEME_OPTIONS} value={preference} onChange={setPreference} />
    </SettingRow>
  );
}

function SettingsPane({
  id,
  title,
  hidden,
  titled,
  action,
  children,
}: {
  id: SettingsSection;
  title: string;
  hidden: boolean;
  /** Beside the menu the pane names itself; alone, the page bar already does. */
  titled: boolean;
  /** A control for the whole section, at the end of its heading. */
  action?: ReactNode;
  children: ReactNode;
}) {
  if (hidden) return null;
  return (
    <section
      id={`settings-pane-${id}`}
      className="settings-pane min-w-0"
      aria-labelledby={titled ? `settings-${id}-heading` : undefined}
      aria-label={titled ? undefined : title}
    >
      {titled ? (
        <div className="settings-pane-heading">
          <h2 id={`settings-${id}-heading`} className="font-semibold text-fg-soft">
            {title}
          </h2>
          <span aria-hidden />
          {action}
        </div>
      ) : (
        action && <div className="settings-pane-actions">{action}</div>
      )}
      {children}
    </section>
  );
}
