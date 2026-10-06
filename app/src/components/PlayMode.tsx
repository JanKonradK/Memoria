import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useApp } from '../store';
import { useGameConnections } from '../game-connections';
import type { PlayModeConfig, PlayModeStatus } from '../desktop-play';
import { Sheet } from './Sheet';
import { Btn, Field, Select, Toggle } from './ui';

const initial: PlayModeConfig = {
  enabled: false,
  background: false,
  hotkey: 'CommandOrControl+Shift+M',
  sourceId: '',
  gameId: '',
};
const hotkeys = ['CommandOrControl+Shift+M', 'CommandOrControl+Shift+F8', 'CommandOrControl+Shift+F9'];
const shortcutLabel = (value: string) => value.replace('CommandOrControl', 'Ctrl').replaceAll('+', ' + ');
const configOf = ({ enabled, background, hotkey, sourceId, gameId }: PlayModeStatus): PlayModeConfig => ({
  enabled,
  background,
  hotkey,
  sourceId,
  gameId,
});

/** PC capture setup and its durable review inbox share one focused surface. */
export function PlayMode() {
  const host = window.memoriaDesktop?.play;
  const games = useApp((store) => store.state.games).filter((game) => !game.deleted);
  const connections = useGameConnections((store) => store.connections);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PlayModeStatus>();
  const [config, setConfig] = useState(initial);
  const [savedConfig, setSavedConfig] = useState(initial);
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const openEpoch = useRef(0);
  const openRef = useRef(false);
  const dirty = JSON.stringify(config) !== JSON.stringify(savedConfig);

  useEffect(() => {
    if (!host) return;
    let active = true;
    const refresh = () =>
      void host
        .status()
        .then((value) => {
          if (active) setStatus(value);
        })
        .catch(() => undefined);
    const show = () => {
      // Tray/menu requests can arrive while this sheet contains an unsaved setup.
      if (openRef.current) return;
      openRef.current = true;
      const epoch = ++openEpoch.current;
      setOpen(true);
      setWorking(true);
      setError('');
      setNotice('');
      void Promise.all([host.status(), host.sources()])
        .then(([value, windows]) => {
          if (!active || epoch !== openEpoch.current) return;
          setStatus(value);
          setConfig(configOf(value));
          setSavedConfig(configOf(value));
          setSources(windows);
        })
        .catch((cause: unknown) => {
          if (active && epoch === openEpoch.current)
            setError(cause instanceof Error ? cause.message : 'Play mode could not open. Try again.');
        })
        .finally(() => {
          if (active && epoch === openEpoch.current) setWorking(false);
        });
    };
    document.addEventListener('memoria:open-play', show);
    const stopChanged = host.onChanged(refresh);
    const stopOpen = host.onOpen(show);
    refresh();
    return () => {
      active = false;
      document.removeEventListener('memoria:open-play', show);
      stopChanged();
      stopOpen();
    };
  }, [host]);

  const run = async (action: () => Promise<void>) => {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The action failed. Try again.');
    } finally {
      setWorking(false);
    }
  };
  const close = () => {
    openEpoch.current += 1;
    openRef.current = false;
    setOpen(false);
  };
  if (!host) return null;
  const automatic = connections.filter(
    (connection) => connection.autoRefresh && games.some((game) => game.id === connection.gameId && !game.paused),
  );

  return (
    <AnimatePresence>
      {open && (
        <Sheet
          key="play-mode"
          open
          title="Play mode"
          dirty={dirty}
          onClose={close}
          footer={
            <Btn
              kind="primary"
              disabled={working || !dirty}
              onClick={() =>
                void run(async () => {
                  const value = await host.configure(config);
                  setStatus(value);
                  setConfig(configOf(value));
                  setSavedConfig(configOf(value));
                  setNotice(
                    value.enabled && value.registered
                      ? 'Shortcut ready. Return to your game and capture its readings.'
                      : 'Play mode settings saved.',
                  );
                })
              }
            >
              {working ? 'Working…' : 'Save play mode'}
            </Btn>
          }
        >
          <div className="space-y-6">
            <p className="text-body text-muted">
              Keep playing. Use a shortcut to read your game window, then review the readings here when you are ready.
            </p>
            <fieldset disabled={working} className="min-w-0 space-y-4">
              <Toggle
                label="Use the capture shortcut"
                checked={config.enabled}
                onChange={(enabled) => setConfig({ ...config, enabled })}
              />
              <Field label="Game account for captures">
                <Select
                  value={config.gameId}
                  onChange={(event) => setConfig({ ...config, gameId: event.target.value })}
                >
                  <option value="">Choose a game account</option>
                  {config.gameId && !games.some((game) => game.id === config.gameId) && (
                    <option value={config.gameId} disabled>
                      Selected account was removed. Choose another.
                    </option>
                  )}
                  {games.map((game) => (
                    <option key={game.id} value={game.id}>
                      {game.name}
                      {game.accountLabel ? ` · ${game.accountLabel}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Game window">
                <Select
                  value={config.sourceId}
                  onChange={(event) => setConfig({ ...config, sourceId: event.target.value })}
                >
                  <option value="">Choose an open game window</option>
                  {config.sourceId && !sources.some((source) => source.id === config.sourceId) && (
                    <option value={config.sourceId} disabled>
                      Selected window is closed. Choose another.
                    </option>
                  )}
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Btn
                  onClick={() =>
                    void run(async () => {
                      setSources(await host.sources());
                      setNotice('Window list updated.');
                    })
                  }
                >
                  Refresh windows
                </Btn>
                <p className="min-w-0 flex-1 text-meta text-muted">
                  Open the game first. Select its window again after restarting Memoria.
                </p>
              </div>
              <Field label="Capture shortcut">
                <Select
                  value={config.hotkey}
                  onChange={(event) => setConfig({ ...config, hotkey: event.target.value })}
                >
                  {hotkeys.map((hotkey) => (
                    <option key={hotkey} value={hotkey}>
                      {shortcutLabel(hotkey)}
                    </option>
                  ))}
                </Select>
              </Field>
              <p className="text-meta text-muted">
                Capture while the readings are visible. Windowed or borderless mode works best. Memoria keeps the
                detected text on this PC and does not save the image.
              </p>
              <Toggle
                label="Keep Memoria in the system tray"
                checked={config.background}
                onChange={(background) => setConfig({ ...config, background })}
              />
              <p className="text-meta text-muted">
                When enabled, closing the window keeps account checks, the capture shortcut, and phone sync running. Use
                Quit Memoria in the tray menu to stop them. Your PC must be awake.
              </p>
            </fieldset>
            {(error || status?.error) && (
              <p role="alert" className="break-words text-body text-danger-fg">
                {error || status?.error}
              </p>
            )}
            {notice && (
              <p role="status" className="text-body text-ok-fg">
                {notice}
              </p>
            )}
            <section className="space-y-3 border-t border-line-hairline pt-5" aria-label="Capture inbox">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-heading font-semibold">Capture inbox</h2>
                <span className="text-meta text-muted" role="status">
                  {status?.busy ? 'Reading game window…' : `${status?.count ?? 0} to review`}
                </span>
              </div>
              {!status?.pending.length && (
                <p className="text-body text-muted">
                  Your captures will appear here. Open the resource screen in your game, then press{' '}
                  {shortcutLabel(config.hotkey)}.
                </p>
              )}
              {status?.pending.map((capture) => (
                <article
                  key={capture.id}
                  className="space-y-2 border-b border-line-hairline pb-4 last:border-0 last:pb-0"
                >
                  <p className="break-words text-body font-semibold">{capture.gameName || capture.name}</p>
                  <p className="text-meta text-muted">{new Date(capture.capturedAt).toLocaleString()}</p>
                  <p className="line-clamp-2 break-words text-meta text-muted">{capture.text}</p>
                  <div className="flex flex-wrap gap-2">
                    <Btn
                      disabled={working}
                      kind="primary"
                      onClick={() => {
                        if (dirty && !window.confirm('Discard unsaved Play mode settings and review this capture?'))
                          return;
                        if (
                          document.dispatchEvent(
                            new CustomEvent('memoria:review-capture', { detail: capture, cancelable: true }),
                          )
                        )
                          close();
                      }}
                    >
                      Review capture
                    </Btn>
                    <Btn
                      disabled={working}
                      onClick={() => {
                        if (window.confirm('Discard this capture from the inbox?'))
                          void run(async () => {
                            setStatus(await host.remove(capture.id));
                          });
                      }}
                    >
                      Discard
                    </Btn>
                  </div>
                </article>
              ))}
            </section>
            <section className="space-y-3 border-t border-line-hairline pt-5" aria-label="Automatic accounts">
              <h2 className="text-heading font-semibold">Automatic accounts</h2>
              <p className="text-body text-muted">
                {automatic.length
                  ? `${automatic.length} connected account${automatic.length === 1 ? '' : 's'} checked every five minutes while Memoria is running.`
                  : 'Connect Genshin, Star Rail, or ZZZ through HoYoLAB, then enable automatic readings for each account.'}
              </p>
              <Btn
                onClick={() => {
                  if (dirty && !window.confirm('Discard unsaved Play mode settings and open Accounts?')) return;
                  if (
                    document.dispatchEvent(
                      new CustomEvent('memoria:open-import', {
                        detail: { tab: 'accounts', gameId: config.gameId || undefined },
                        cancelable: true,
                      }),
                    )
                  )
                    close();
                }}
              >
                Manage accounts
              </Btn>
            </section>
          </div>
        </Sheet>
      )}
    </AnimatePresence>
  );
}
