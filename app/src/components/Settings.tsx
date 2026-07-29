import { useEffect, useState } from 'react';
import { normalizeState, safeParseAppState } from '@void/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { useSession } from '../auth';
import { deleteHostedAccount, exportHostedAccount } from '../account';
import { getSyncConfig, setSyncConfig, syncNow } from '../sync';
import { fmtClock, intOr } from '../util';
import { Pill } from './primitives';
import { Disclosure } from './Disclosure';
import { Btn, Field, GameBadge, NumInput, Page, Segmented, TextInput } from './ui';

type SettingsSection = 'games' | 'display' | 'account' | 'data';

export function SettingsPage() {
  const state = useApp((store) => store.state);
  const identity = useApp((store) => store.identity);
  const syncStatus = useApp((store) => store.syncStatus);
  const syncError = useApp((store) => store.syncError);
  const lastSyncAt = useApp((store) => store.lastSyncAt);
  const updateSettings = useApp((store) => store.updateSettings);
  const importStateJson = useApp((store) => store.importJson);
  const clearLocalData = useApp((store) => store.clearLocalData);
  const openSheet = useUI((state) => state.openSheet);
  const textSize = useUI((state) => state.textSize);
  const setTextSize = useUI((state) => state.setTextSize);
  const focusColumns = useUI((state) => state.focusColumns);
  const setFocusColumns = useUI((state) => state.setFocusColumns);
  const session = useSession();
  const settings = state.settings;
  const games = state.games.filter((game) => !game.deleted).sort((a, b) => a.sort - b.sort);
  const [syncCfg, setSyncCfgLocal] = useState(getSyncConfig());
  const [statusMessage, setStatusMessage] = useState('');
  const [importDraft, setImportDraft] = useState<{ text: string; games: number; events: number } | null>(null);
  const [openSection, setOpenSection] = useState<SettingsSection | null>('games');
  const disclosureProps = (section: SettingsSection) => ({
    open: openSection === section,
    onOpenChange: (open: boolean) => setOpenSection(open ? section : null),
    fill: true,
    className: 'glass gold-hairline rounded-ui-card px-4',
    headingClassName: 'relative',
    triggerClassName: 'py-2 text-meta font-bold uppercase tracking-widest text-muted',
    contentClassName: 'scrollbar-thin h-full overflow-y-auto pb-4',
  });
  const reportError = (error: unknown) => setStatusMessage(error instanceof Error ? error.message : String(error));
  const syncSizeWarning = syncStatus === 'error' && syncError.startsWith('Local data is ');

  useEffect(() => {
    setSyncCfgLocal(getSyncConfig());
  }, [identity]);

  const saveSyncCfg = () => {
    setSyncConfig(syncCfg);
    void syncNow().catch(reportError);
  };

  const exportJson = async () => {
    const data = session.hosted ? await exportHostedAccount() : state;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `void-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_000_000) {
      setImportDraft(null);
      setStatusMessage('Import failed — backup exceeds the 1 MB account limit.');
      return;
    }
    void file
      .text()
      .then((text) => {
        try {
          const raw = JSON.parse(text) as unknown;
          const candidate = raw && typeof raw === 'object' && 'state' in raw ? (raw as { state: unknown }).state : raw;
          if (!candidate || typeof candidate !== 'object' || (!('games' in candidate) && !('settings' in candidate)))
            throw new Error('Not a Void backup');
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
          setStatusMessage('Import failed — not a valid Void backup file.');
        }
      })
      .catch(reportError);
  };

  return (
    // Lock to the viewport only when there is room to be usable. Below ~700px tall
    // the section headers leave the open section a few pixels, so pinning the
    // height turns "don't scroll" into "content is unreachable" — that is the case
    // where scrolling is the right answer.
    <Page className="min-h-dvh [@media(min-height:700px)]:h-dvh [@media(min-height:700px)]:overflow-hidden">
      <div className="mx-auto flex max-w-[1600px] flex-col [@media(min-height:700px)]:h-full">
        <h2 className="mb-3 text-title font-black tracking-tight text-fg-soft">Settings</h2>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <Disclosure
            {...disclosureProps('games')}
            title="Games"
            regionLabel="Games"
            triggerLabel={`${openSection === 'games' ? 'Collapse' : 'Expand'} Games settings`}
          >
            <div className="mb-3 flex justify-end">
              <Btn onClick={() => openSheet({ kind: 'addGame' })}>+ Add game</Btn>
            </div>
            {games.length > 0 ? (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {games.map((game) => (
                  <div
                    key={game.id}
                    className="flex min-h-14 items-center gap-3 rounded-ui-xl bg-fill-1 px-3 py-2 ring-1 ring-line-hairline"
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
                      className="min-h-9 shrink-0 rounded-ui-lg bg-fill-2 px-3 py-1.5 text-meta font-semibold text-fg-soft ring-1 ring-line-hairline transition hover:bg-fill-3 hover:text-white"
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
          </Disclosure>

          <Disclosure
            {...disclosureProps('display')}
            title="Display"
            regionLabel="Display and appearance"
            triggerLabel={`${openSection === 'display' ? 'Collapse' : 'Expand'} Display settings`}
          >
            <div className="space-y-3">
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-body font-semibold text-fg-soft">Expanded card layout</p>
                  <p className="mt-0.5 text-label text-dim">
                    Auto splits into two columns on screens wider than 1500px.
                  </p>
                </div>
                <Segmented
                  options={[
                    { value: 'one', label: 'One' },
                    { value: 'two', label: 'Two' },
                    { value: 'auto', label: 'Auto' },
                  ]}
                  value={focusColumns}
                  onChange={setFocusColumns}
                  ariaLabel="Expanded card layout"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-body font-semibold text-fg-soft">Sleep window</p>
                  <p className="mt-0.5 text-label text-dim">
                    Used by the hub's overnight check to show which games cap before you wake.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <NumInput
                    className="!w-24"
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
            </div>
          </Disclosure>

          <Disclosure
            {...disclosureProps('account')}
            title={session.hosted ? 'Account and sync' : 'Advanced local sync'}
            regionLabel={session.hosted ? 'Account and sync' : 'Advanced local sync'}
            triggerLabel={`${openSection === 'account' ? 'Collapse' : 'Expand'} ${
              session.hosted ? 'Account and sync' : 'Advanced local sync'
            } settings`}
          >
            {session.hosted ? (
              <div className="space-y-3">
                <p className="text-body font-semibold text-fg-soft">{session.displayName}</p>
                <p className="text-meta text-muted">
                  This device remains IndexedDB-first. Changes sync to your private account document whenever you are
                  online.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Btn kind="primary" onClick={() => void syncNow().catch(reportError)}>
                    Sync now
                  </Btn>
                  <Btn onClick={session.manageAccount}>Manage devices</Btn>
                  <Btn onClick={() => void session.signOut().catch(reportError)}>Sign out</Btn>
                  <span className="text-meta text-muted">
                    {syncStatus === 'syncing' && 'Syncing…'}
                    {syncStatus === 'ok' && lastSyncAt && `✓ Synced ${fmtClock(lastSyncAt)}`}
                    {syncStatus === 'error' && !syncSizeWarning && <span className="text-danger-fg">{syncError}</span>}
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-meta text-muted">
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
            {syncSizeWarning && (
              <p className="mt-3 rounded-ui-lg bg-warn/10 p-3 text-meta text-warn-fg" role="status">
                {syncError}
              </p>
            )}
          </Disclosure>

          <Disclosure
            {...disclosureProps('data')}
            title="Data"
            regionLabel="Data"
            triggerLabel={`${openSection === 'data' ? 'Collapse' : 'Expand'} Data settings`}
          >
            <div className="flex flex-wrap items-center gap-2 pb-1">
              <Btn onClick={() => void exportJson().catch(reportError)}>Export backup</Btn>
              <label className="flex min-h-11 cursor-pointer items-center rounded-ui-lg bg-fill-2 px-4 py-2 text-body font-semibold text-fg-soft ring-1 ring-line-hairline transition hover:bg-fill-3 sm:min-h-9">
                Import backup
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
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
                    onClick={() => {
                      const ok = importStateJson(importDraft.text);
                      setStatusMessage(ok ? 'Backup imported and merged.' : 'Import failed.');
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
              <div className="mt-5 border-t border-danger/15 pt-4">
                <p className="text-meta text-muted">
                  Account deletion permanently removes the cloud document, operational records and Clerk identity.
                  Export first if you need a copy.
                </p>
                <Btn
                  className="mt-3 text-danger-fg ring-danger/30"
                  onClick={() => {
                    if (
                      !window.confirm('Permanently delete your Void account and all cloud data? This cannot be undone.')
                    )
                      return;
                    void deleteHostedAccount()
                      .then(async () => {
                        await clearLocalData();
                        await session.signOut();
                      })
                      .catch(reportError);
                  }}
                >
                  Delete account permanently
                </Btn>
              </div>
            )}
          </Disclosure>
        </div>
      </div>
    </Page>
  );
}
