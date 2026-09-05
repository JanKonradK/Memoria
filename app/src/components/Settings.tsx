import { useState } from 'react';
import { detectLocalTz, normalizeState, safeParseAppState } from '@memoria/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { servedByLauncher } from '../launcher';
import { resolveGameIdentityColors } from '../game-color';
import { syncNow } from '../sync';
import {
  CLOUD_FILE_SUGGESTED_NAME,
  cloudSyncNow,
  cloudSyncSupported,
  connectExistingCloudFile,
  connectNewCloudFile,
  disconnectCloudFile,
  reconnectCloudFile,
} from '../cloud-sync';
import { homeTimeZoneOptions, resolveHomeTimeZone, SYSTEM_TIMEZONE_VALUE, utcOffsetLabel } from '../timezone';
import { fmtClock, intOr, localResetLabel } from '../util';
import { Pill } from './primitives';
import { Btn, GameBadge, NumInput, Page, Select } from './ui';

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
  const detectedTz = detectLocalTz();
  const timeZoneOptions = homeTimeZoneOptions(settings.localTz);
  const games = state.games.filter((game) => !game.deleted).sort((a, b) => a.sort - b.sort);
  const identityColors = resolveGameIdentityColors(games);
  const [statusMessage, setStatusMessage] = useState('');
  const [importDraft, setImportDraft] = useState<{ text: string; games: number; events: number } | null>(null);
  const cloudSupported = cloudSyncSupported();
  const cloudConnected = cloudFileName !== '' && cloudStatus !== 'off' && cloudStatus !== 'unsupported';
  const reportError = (error: unknown) => setStatusMessage(error instanceof Error ? error.message : String(error));
  const syncSizeWarning = syncStatus === 'error' && syncError.startsWith('Local data is ');

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `memoria-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_000_000) {
      setImportDraft(null);
      setStatusMessage('Import failed — backup exceeds the 1 MB limit.');
      return;
    }
    void file
      .text()
      .then((text) => {
        try {
          const raw = JSON.parse(text) as unknown;
          const candidate = raw && typeof raw === 'object' && 'state' in raw ? (raw as { state: unknown }).state : raw;
          if (!candidate || typeof candidate !== 'object' || (!('games' in candidate) && !('settings' in candidate)))
            throw new Error('Not a Memoria backup');
          const normalized = normalizeState(candidate);
          const parsed = safeParseAppState(normalized);
          if (!parsed.success) throw new Error(parsed.error);
          const incoming = parsed.data;
          setImportDraft({
            text: JSON.stringify(candidate),
            games: incoming.games.filter((g) => !g.deleted).length,
            events: incoming.events.filter((e) => !e.deleted).length,
          });
          setStatusMessage('');
        } catch {
          setImportDraft(null);
          setStatusMessage('Import failed — not a valid Memoria backup file.');
        }
      })
      .catch(reportError);
  };

  return (
    <Page>
      <div className="mx-auto max-w-[1600px]">
        <h1 className="mb-6 text-title font-black tracking-tight text-fg-soft">Settings</h1>

        <div className="space-y-10">
          <section aria-labelledby="settings-games-heading">
            <div className="flex items-center justify-between gap-3 border-b border-line-hairline pb-2">
              <h2 id="settings-games-heading" className="text-heading font-semibold text-fg-soft">
                Games
              </h2>
              <Btn className="!min-h-11 sm:!min-h-8" onClick={() => openSheet({ kind: 'addGame' })}>
                + Add game
              </Btn>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-hairline py-3">
              <div>
                <p className="text-meta font-semibold text-fg-soft">Sleep window</p>
                <p className="text-label text-dim">Used by the hub's overnight check.</p>
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

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-hairline py-3">
              <div>
                <p className="text-meta font-semibold text-fg-soft">Home timezone</p>
                <p className="text-label text-dim">Used for every local clock and date.</p>
              </div>
              <div className="flex min-w-0 flex-col items-end gap-1 sm:min-w-80">
                <Select
                  aria-label="Home timezone"
                  value={settings.localTz === detectedTz ? SYSTEM_TIMEZONE_VALUE : settings.localTz}
                  onChange={(event) => updateSettings({ localTz: resolveHomeTimeZone(event.target.value) })}
                >
                  <option value={SYSTEM_TIMEZONE_VALUE}>Use system timezone ({detectedTz})</option>
                  {timeZoneOptions.map((option) => (
                    <option key={option.tz} value={option.tz}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <span className="numeral text-label text-dim">Current offset {utcOffsetLabel(settings.localTz)}</span>
              </div>
            </div>

            {games.length > 0 ? (
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {games.map((game) => {
                  const colors = identityColors[game.id] ?? game;
                  return (
                    // One button, one destination. This row used to carry both
                    // "Expand" (the real editor, inline) and "Edit" (a sheet
                    // holding three fields) — two controls claiming the same job.
                    <button
                      key={game.id}
                      type="button"
                      onClick={() => openSheet({ kind: 'game', gameId: game.id })}
                      className="flex min-h-14 w-full items-center gap-3 rounded-ui-xl bg-fill-1 px-3 py-2 text-left ring-1 ring-line-hairline transition duration-(--dur-fast) hover:bg-fill-2 hover:ring-line-strong"
                    >
                      <GameBadge short={game.short} {...colors} size="lg" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-body font-bold text-fg-soft">{game.name}</span>
                          {game.paused && <Pill variant="paused">paused</Pill>}
                        </div>
                        <span className="text-label text-dim">
                          reset {localResetLabel(game, settings.localTz, Date.now())}
                        </span>
                      </div>
                      <span className="shrink-0 text-meta font-semibold text-dim" aria-hidden="true">
                        Edit
                      </span>
                      <span className="sr-only">Edit {game.name}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 text-body text-dim">No games yet. Add one to start tracking resources and tasks.</p>
            )}
          </section>

          <section aria-labelledby="settings-data-heading">
            <h2
              id="settings-data-heading"
              className="border-b border-line-hairline pb-2 text-heading font-semibold text-fg-soft"
            >
              Data
            </h2>

            {launcher && (
              <div className="space-y-3 border-b border-line-hairline py-4">
                <p className="text-meta text-muted">
                  This window is served by the Memoria launcher. Edits stay in this browser first and are written to{' '}
                  <code className="text-fg-soft">%APPDATA%\memoria\state.json</code>, so every open window sees the same
                  data.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Btn
                    kind="primary"
                    className="!min-h-11 sm:!min-h-8"
                    onClick={() => void syncNow().catch(reportError)}
                  >
                    Save to file now
                  </Btn>
                  <span className="text-meta text-muted">
                    {syncStatus === 'syncing' && 'Saving…'}

                    {syncStatus === 'ok' && lastSyncAt && `✓ Saved ${fmtClock(lastSyncAt, settings.localTz)}`}
                    {syncStatus === 'error' && !syncSizeWarning && <span className="text-danger-fg">{syncError}</span>}
                  </span>
                </div>
                {syncSizeWarning && (
                  <p className="rounded-ui-lg bg-warn/10 p-3 text-meta text-warn-fg" role="status">
                    {syncError}
                  </p>
                )}
              </div>
            )}

            {/* Sync across devices through a folder something else already syncs.
                Shown in every build: a launcher window is one machine, and this
                is how a second machine — or a phone-side browser — sees the same
                document. See cloud-sync.ts for why this is a file and not an
                account. */}
            <div className="space-y-3 border-b border-line-hairline py-4">
              <div>
                <p className="text-meta font-semibold text-fg-soft">Sync across devices</p>
                <p className="text-label text-dim">
                  Keep one file in a folder your computer already syncs — Google Drive, OneDrive, Proton Drive, Dropbox,
                  iCloud Drive. Point every device at that same file and they stay in agreement. Memoria never contacts
                  the provider; it only reads and writes the file, and their app moves it.
                </p>
              </div>

              {!cloudSupported && (
                <p className="text-meta text-muted">
                  This browser cannot open a file for writing. Chrome and Edge can, including from a downloaded{' '}
                  <code className="text-fg-soft">Memoria.html</code>. Elsewhere, use Export and Import below.
                </p>
              )}

              {cloudSupported && !cloudConnected && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Btn
                      kind="primary"
                      className="!min-h-11 sm:!min-h-8"
                      onClick={() => {
                        setStatusMessage('');
                        void connectNewCloudFile()
                          .then((ok) => ok && setStatusMessage('Syncing to the file you chose.'))
                          .catch(reportError);
                      }}
                    >
                      Create sync file…
                    </Btn>
                    <Btn
                      className="!min-h-11 sm:!min-h-8"
                      onClick={() => {
                        setStatusMessage('');
                        void connectExistingCloudFile()
                          .then((ok) => ok && setStatusMessage('Joined the existing sync file.'))
                          .catch(reportError);
                      }}
                    >
                      Use existing file…
                    </Btn>
                  </div>
                  <p className="text-label text-dim">
                    First device: create <code className="text-fg-soft">{CLOUD_FILE_SUGGESTED_NAME}</code> inside the
                    synced folder. Every device after that: pick the file the first one made.
                  </p>
                </>
              )}

              {cloudSupported && cloudConnected && (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    {cloudStatus === 'needs-permission' ? (
                      <Btn
                        kind="primary"
                        className="!min-h-11 sm:!min-h-8"
                        onClick={() => void reconnectCloudFile().catch(reportError)}
                      >
                        Reconnect
                      </Btn>
                    ) : (
                      <Btn
                        kind="primary"
                        className="!min-h-11 sm:!min-h-8"
                        onClick={() => void cloudSyncNow().catch(reportError)}
                      >
                        Sync now
                      </Btn>
                    )}
                    <Btn
                      className="!min-h-11 sm:!min-h-8"
                      onClick={() => {
                        void disconnectCloudFile()
                          .then(() => setStatusMessage('Stopped syncing on this device. The file was left alone.'))
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
                  {(cloudStatus === 'error' || cloudStatus === 'needs-permission') && cloudError && (
                    <p className="rounded-ui-lg bg-warn/10 p-3 text-meta text-warn-fg" role="status">
                      {cloudError}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="pt-4">
              <div className="flex flex-wrap items-center gap-2 pb-1">
                <Btn className="!min-h-11 sm:!min-h-8" onClick={exportJson}>
                  Export backup
                </Btn>
                <label className="btn-compact flex min-h-11 cursor-pointer items-center rounded-ui-md bg-fill-2 px-3 py-1 text-caption font-semibold text-fg-soft ring-1 ring-line-hairline transition hover:bg-fill-3 sm:min-h-8">
                  Import backup
                  {/* sr-only, never `hidden`: display:none drops the input out of the
                      tab order and the wrapping label is not focusable, which made
                      Import backup unreachable by keyboard. */}
                  <input
                    type="file"
                    accept="application/json"
                    className="sr-only"
                    onChange={(e) => importJson(e.target.files?.[0])}
                  />
                </label>
                <span className="text-label text-dim">
                  {state.games.filter((g) => !g.deleted).length} games · {state.events.filter((e) => !e.deleted).length}{' '}
                  events
                </span>
              </div>
              {statusMessage && (
                <p className="mt-2 text-meta text-muted" role="status">
                  {statusMessage}
                </p>
              )}
              {importDraft && (
                <div className="mt-3 rounded-ui-xl bg-warn/10 p-3 ring-1 ring-warn/25">
                  <p className="text-body font-semibold text-warn-fg">
                    Merge backup with {importDraft.games} game{importDraft.games === 1 ? '' : 's'} and{' '}
                    {importDraft.events} event
                    {importDraft.events === 1 ? '' : 's'}?
                  </p>
                  <p className="mt-1 text-meta text-muted">
                    Newer rows win. Existing local data is not replaced wholesale.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Btn
                      kind="primary"
                      className="!min-h-11 sm:!min-h-8"
                      onClick={() => {
                        const ok = importStateJson(importDraft.text);
                        setStatusMessage(ok ? 'Backup imported and merged.' : 'Import failed.');
                        setImportDraft(null);
                      }}
                    >
                      Merge backup
                    </Btn>
                    <Btn className="!min-h-11 sm:!min-h-8" onClick={() => setImportDraft(null)}>
                      Cancel
                    </Btn>
                  </div>
                </div>
              )}
              <div className="mt-5 border-t border-danger/15 pt-4">
                <p className="text-meta text-muted">
                  Clearing wipes this browser's Memoria database.{' '}
                  {launcher ? 'The desktop state file is left untouched. ' : ''}
                  Export first if you need a copy.
                </p>
                <Btn
                  className="mt-3 !min-h-11 text-danger-fg ring-danger/30 sm:!min-h-8"
                  onClick={() => {
                    if (!window.confirm('Permanently clear Memoria data stored in this browser?')) return;
                    void clearLocalData()
                      .then(() => setStatusMessage('Local data cleared.'))
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
