import { useRef, useState } from 'react';
import { detectLocalTz, normalizeState, safeParseAppState } from '@memoria/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { servedByLauncher } from '../launcher';
import { syncNow } from '../sync';
import { DeviceSync } from './settings/DeviceSync';
import { DeviceNotifications } from './settings/DeviceNotifications';
import { AppUpdates } from './settings/AppUpdates';
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

  return (
    <Page>
      <div data-tour="settings" className="mx-auto max-w-[1600px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-heading font-semibold tracking-tight text-fg">Settings</h1>
          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => openSheet({ kind: 'guide' })}>User guide</Btn>
          </div>
        </div>
        <DeviceSync />
        <DeviceNotifications />
        <AppUpdates />

        <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="settings-section min-w-0" aria-labelledby="settings-games-heading">
            <div className="today-group-rule">
              <h2 id="settings-games-heading" className="text-meta font-semibold text-fg-soft">
                Games
              </h2>
              <span aria-hidden />
            </div>

            <div className="mx-2 flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
              <div>
                <p className="text-meta font-semibold text-fg-soft">Sleep window</p>
              </div>
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
            </div>

            <div className="mx-2 flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
              <div>
                <p className="text-meta font-semibold text-fg-soft">Home timezone</p>
              </div>
              <HomeTimeZoneField
                value={settings.localTz === detectedTz ? SYSTEM_TIMEZONE_VALUE : settings.localTz}
                resolvedTz={settings.localTz}
                detectedTz={detectedTz}
                onChange={(value) => updateSettings({ localTz: resolveHomeTimeZone(value) })}
              />
            </div>

            {games.length > 0 ? (
              <div className="settings-game-list mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                {listedGames.map((game) => {
                  const colors = identityColors[game.id] ?? game;
                  return (
                    // One button, one destination. This row used to carry both
                    // "Expand" (the real editor, inline) and "Edit" (a sheet
                    // holding three fields) — two controls claiming the same job.
                    <button
                      key={game.id}
                      type="button"
                      aria-label={`Game settings for ${game.name}${game.accountLabel ? `, ${game.accountLabel}` : ''}`}
                      onClick={() => openSheet({ kind: 'game', gameId: game.id })}
                      className="settings-game-row group flex min-h-14 w-full items-center rounded-ui-lg text-left transition duration-(--dur-fast) hover:bg-fill-1"
                    >
                      {/* The identity trio is merged in so two accounts of one game draw one ring. */}
                      <GameLogo game={{ ...game, ...colors }} size={48} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 text-body font-semibold text-fg-soft [overflow-wrap:anywhere]">
                            {game.name}
                          </span>
                          {game.paused && <Pill variant="paused">paused</Pill>}
                        </div>
                        <span className="aside text-label text-muted [overflow-wrap:anywhere]">
                          {game.accountLabel ? `${game.accountLabel} · ` : ''}reset{' '}
                          {localResetLabel(game, settings.localTz, Date.now())}
                        </span>
                        <p className="aside numeral text-label text-muted">
                          {state.resources.filter((r) => r.gameId === game.id && !r.deleted).length} resources ·{' '}
                          {state.tasks.filter((t) => t.gameId === game.id && !t.deleted).length} tasks
                        </p>
                      </div>
                      {/* Still ONE control and one tab stop — the pencil is the
                          row's own pressed state made visible, not a second
                          button claiming the same job. It reads as pressable
                          because it answers the row: hover, focus and press all
                          land on it. The row keeps the accessible name. */}
                      <span
                        aria-hidden="true"
                        className="settings-game-action btn-compact flex min-h-11 shrink-0 items-center gap-1.5 rounded-ui-md bg-fill-2 px-3 text-meta font-semibold text-muted ring-1 ring-line-hairline transition duration-(--dur-fast) group-hover:bg-fill-3 group-hover:text-fg-soft group-hover:ring-line-strong group-focus-visible:bg-fill-3 group-focus-visible:text-fg-soft group-focus-visible:ring-line-strong group-active:scale-[0.97] sm:min-h-8"
                      >
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" className="icon h-4 w-4" aria-hidden>
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
              <p className="mx-2 mt-4 text-body text-dim">No games yet.</p>
            )}
          </section>

          <section
            className="settings-section min-w-0 xl:border-l xl:border-line xl:pl-8"
            aria-labelledby="settings-data-heading"
          >
            <div className="today-group-rule">
              <h2 id="settings-data-heading" className="text-meta font-semibold text-fg-soft">
                Data
              </h2>
              <span aria-hidden />
            </div>

            {launcher && (
              <div className="mx-2 space-y-3 border-b border-line py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Btn kind="primary" className={TOUCH_BUTTON} onClick={() => void syncNow().catch(reportError)}>
                    Save now
                  </Btn>
                  <span className="text-meta text-muted">
                    {syncStatus === 'syncing' && 'Saving…'}

                    {syncStatus === 'ok' && lastSyncAt && `✓ Saved ${fmtClock(lastSyncAt, settings.localTz)}`}
                    {syncStatus === 'error' && !syncSizeWarning && <span className="text-danger-fg">{syncError}</span>}
                  </span>
                </div>
                {syncSizeWarning && (
                  <p className="border-l-2 border-warn/60 pl-3 text-meta text-warn-fg" role="status">
                    {syncError}
                  </p>
                )}
              </div>
            )}

            {/* Shared-folder sync uses desktop browser file handles. Android
                uses Wi-Fi pairing above and the native backup picker below. */}
            {!isNativeApp && (
              <div className="mx-2 space-y-3 border-b border-line py-4">
                <div>
                  <p className="text-meta font-semibold text-fg-soft">Shared-folder sync</p>
                  <p className="aside text-label text-muted">
                    One file in a synced folder, such as Google Drive or OneDrive, shared by every device.
                  </p>
                </div>

                {!cloudSupported && (
                  <p className="text-meta text-muted">Needs Chrome or Edge. Use Export and Import instead.</p>
                )}

                {cloudSupported && !cloudConnected && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Btn
                        kind="primary"
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
                      Create <code className="text-fg-soft">{CLOUD_FILE_SUGGESTED_NAME}</code> on the first device. Pick
                      it on the others.
                    </p>
                  </>
                )}

                {cloudSupported && cloudConnected && (
                  <>
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
                  </>
                )}
                {(cloudStatus === 'error' || cloudStatus === 'needs-permission') && cloudError && (
                  <p className="border-l-2 border-warn/60 pl-3 text-meta text-warn-fg" role="status">
                    {cloudError}
                  </p>
                )}
              </div>
            )}

            <div className="mx-2 pt-4">
              <div className="flex flex-wrap items-center gap-2 pb-1">
                <Btn className={TOUCH_BUTTON} onClick={exportJson}>
                  Export backup
                </Btn>
                <label className="focus-ring-group btn-compact flex min-h-11 cursor-pointer items-center rounded-ui-md bg-fill-2 px-3 py-1 text-caption font-semibold text-fg-soft ring-1 ring-line-hairline transition hover:bg-fill-3 sm:min-h-8">
                  Import backup
                  {/* sr-only, never `hidden`: display:none drops the input out of the
                      tab order and the wrapping label is not focusable, which made
                      Import backup unreachable by keyboard. */}
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
                <span className="numeral aside text-label text-muted">
                  {games.length} games · {state.events.filter((e) => !e.deleted).length} events
                </span>
              </div>
              {statusMessage && (
                <p className="mt-2 text-meta text-muted" role="status">
                  {statusMessage}
                </p>
              )}
              {importDraft && (
                <div className="mt-3 border-l-2 border-warn/60 pl-3">
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
              <div className="mt-5 border-t border-line pt-4">
                <Btn
                  kind="danger"
                  className={TOUCH_BUTTON}
                  onClick={() => {
                    if (
                      !window.confirm('Delete all Memoria data in this browser? Export a backup first if you need one.')
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
              </div>
            </div>
          </section>
        </div>
      </div>
    </Page>
  );
}
