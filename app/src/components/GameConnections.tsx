import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { mapHoYoNotes, presetForGame, type GameImportBatch } from '@memoria/shared';
import { connectionRequest, useGameConnections, type GameConnection } from '../game-connections';
import { servedByLauncher } from '../launcher';
import { isNativeApp } from '../native';
import { connectHoyo, listHoyoAccounts } from '../hoyo-native';
import { useApp } from '../store';
import { Btn, Field, Select, TextInput } from './ui';
import { isDesktopApp, useUnsavedDraft } from '../desktop-host';

const SERVERS = {
  genshin: [
    ['os_euro', 'Europe'],
    ['os_usa', 'America'],
    ['os_asia', 'Asia'],
    ['os_cht', 'TW, HK, MO'],
  ],
  hsr: [
    ['prod_official_eur', 'Europe'],
    ['prod_official_usa', 'America'],
    ['prod_official_asia', 'Asia'],
    ['prod_official_cht', 'TW, HK, MO'],
  ],
  zzz: [
    ['prod_gf_eu', 'Europe'],
    ['prod_gf_us', 'America'],
    ['prod_gf_jp', 'Asia'],
    ['prod_gf_sg', 'TW, HK, MO'],
  ],
};

export function GameConnections({ gameId, onReview }: { gameId: string; onReview(batch: GameImportBatch): void }) {
  const state = useApp((store) => store.state);
  const connections = useGameConnections((store) => store.connections);
  const refreshError = useGameConnections((store) => store.error);
  const game = state.games.find((item) => item.id === gameId && !item.deleted);
  const key = game ? presetForGame(game)?.key : undefined;
  const provider = key && Object.hasOwn(SERVERS, key) ? (key as GameConnection['provider']) : undefined;
  const connected = connections.find((item) => item.gameId === gameId);
  const desktop = isDesktopApp();
  const browser = desktop ? window.memoriaDesktop?.browser : undefined;
  const browserLogin = Boolean(browser) && (!connected || connected.transport === 'browser');
  const nativeLogin = isNativeApp || (desktop && !browserLogin && Boolean(window.memoriaDesktop?.hoyo));
  const conflicts = connections.filter((item) => item.gameId === gameId);
  const [uid, setUid] = useState('');
  const [server, setServer] = useState('');
  const [cookie, setCookie] = useState('');
  useUnsavedDraft(!connected && Boolean(uid || server || cookie));
  const [automatic, setAutomatic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<
    { provider: GameConnection['provider']; uid: string; server: string; nickname: string }[]
  >([]);
  const [accountNotice, setAccountNotice] = useState('');
  const [browserStatus, setBrowserStatus] = useState<{ receivedAt: number | null; accounts: number; error?: string }>();
  const [connectorNotice, setConnectorNotice] = useState('');
  const active = useRef(true);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (servedByLauncher() || isNativeApp || desktop)
      void connectionRequest().catch((cause: unknown) => {
        if (active.current) setError(cause instanceof Error ? cause.message : 'Connections could not load.');
      });
  }, [desktop]);
  useEffect(() => {
    if (!browserLogin || !browser) return;
    let current = true;
    const check = () =>
      void browser
        .status()
        .then((status) => {
          if (current) setBrowserStatus(status);
        })
        .catch(() => undefined);
    check();
    document.addEventListener('memoria:refresh-accounts', check);
    return () => {
      current = false;
      document.removeEventListener('memoria:refresh-accounts', check);
    };
  }, [browser, browserLogin]);
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      const result = await connectionRequest(body);
      if (active.current && result.reading?.gameId === gameId)
        onReview(mapHoYoNotes(useApp.getState().state, gameId, result.reading));
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : 'Connection failed.');
    } finally {
      if (active.current) {
        setBusy(false);
        setCookie('');
      }
    }
  };
  const findAccounts = async () => {
    if (!provider) return;
    setBusy(true);
    setError('');
    setAccountNotice('');
    setAccounts([]);
    try {
      const result = await listHoyoAccounts({ provider });
      if (!active.current) return;
      setAccounts(result.accounts);
      if (result.accounts.length === 1) {
        setUid(result.accounts[0].uid);
        setServer(result.accounts[0].server);
        setAccountNotice('Account found. Select Connect and review to check its readings.');
      } else if (result.accounts.length === 0) {
        setAccountNotice('No linked account was found for this game. You can enter its UID and server below.');
      } else {
        setAccountNotice('Choose a linked account, then select Connect and review.');
      }
    } catch (cause) {
      if (active.current)
        setError(cause instanceof Error ? cause.message : 'Accounts could not load. Enter the UID and server below.');
    } finally {
      if (active.current) setBusy(false);
    }
  };
  if (!servedByLauncher() && !isNativeApp && !desktop)
    return (
      <p className="text-body text-muted">
        Connect game accounts in the Windows app. Account readings reach this phone through device sync. Screenshot
        import works on this device.
      </p>
    );
  if (!provider)
    return (
      <p className="text-body text-muted">
        Account connections support Genshin Impact, Honkai: Star Rail, and Zenless Zone Zero. Use a screenshot for this
        game.
      </p>
    );
  return (
    <div className="space-y-4">
      <p className="text-body text-muted">
        Read your HoYoLAB Real-Time Notes. This community connection imports supported readings. It does not play the
        game or claim rewards.
      </p>
      {browserLogin && (
        <section className="space-y-3" aria-label="Chrome or Edge connection">
          <h3 className="text-heading font-semibold">Use Chrome or Edge</h3>
          <ol className="list-decimal space-y-3 pl-5 text-body text-muted">
            <li>
              <Btn
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError('');
                  void browser!
                    .setup()
                    .then(() => {
                      if (active.current)
                        setConnectorNotice('Connector folder opened. Load that folder in Chrome or Edge.');
                    })
                    .catch((cause: unknown) => {
                      if (active.current)
                        setError(cause instanceof Error ? cause.message : 'The connector could not open. Try again.');
                    })
                    .finally(() => {
                      if (active.current) setBusy(false);
                    });
                }}
              >
                Set up browser connector
              </Btn>
              <p className="mt-2">
                One time: open <code>chrome://extensions</code> or <code>edge://extensions</code>. Enable Developer
                mode, select Load unpacked, and choose the folder that Memoria opens. Pin the Memoria connector to the
                toolbar.
              </p>
            </li>
            <li>
              <a
                className="underline underline-offset-2"
                href="https://www.hoyolab.com/"
                target="_blank"
                rel="noreferrer"
              >
                Open HoYoLAB in your browser
              </a>{' '}
              and sign in. Enable Real-Time Notes for each game.
            </li>
            <li>
              Open the Memoria connector in the browser toolbar and select Read accounts. Return here and select Find my
              accounts, then Connect and review.
            </li>
          </ol>
          <p className="text-meta text-muted">
            Sign-in stays in your browser. The connector sends account IDs and readings to this PC.
          </p>
          {connectorNotice && (
            <p role="status" className="text-body text-muted">
              {connectorNotice}
            </p>
          )}
          {browserStatus?.receivedAt !== null && browserStatus?.receivedAt !== undefined && (
            <p className="text-meta text-muted">
              Browser readings received {new Date(browserStatus.receivedAt).toLocaleString()}.
            </p>
          )}
          {browserStatus?.error && (
            <p role="alert" className="text-body text-danger-fg">
              {browserStatus.error}
            </p>
          )}
        </section>
      )}
      {nativeLogin && (
        <div className="space-y-2">
          <Btn
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError('');
              void connectHoyo()
                .then((result) => {
                  if (!active.current || !result.connected) return;
                  if (desktop && connected) return run({ action: 'connect', ...connected });
                  if (!connected) return findAccounts();
                })
                .catch((cause: unknown) => {
                  if (active.current) setError(cause instanceof Error ? cause.message : 'Sign-in could not open.');
                })
                .finally(() => {
                  if (active.current) setBusy(false);
                });
            }}
          >
            Sign in with HoYoLAB
          </Btn>
          <p className="text-meta text-muted">
            Sign in on the official page, then select Done. One sign-in serves your linked games on this{' '}
            {desktop ? 'PC' : 'phone'}. Your session stays here.
          </p>
        </div>
      )}
      {conflicts.length > 1 && (
        <section className="space-y-2" aria-label="Connection conflict">
          <p role="alert" className="text-body text-danger-fg">
            This game has two connection methods. Disconnect one to resume account readings.
          </p>
          <div className="flex flex-wrap gap-2">
            {conflicts.map((connection) => (
              <Btn
                key={connection.transport || 'legacy'}
                disabled={busy}
                onClick={() =>
                  void run({
                    action: 'disconnect',
                    gameId,
                    transport: connection.transport || 'legacy',
                  })
                }
              >
                Disconnect {connection.transport === 'browser' ? 'browser' : 'protected PC'} account
              </Btn>
            ))}
          </div>
        </section>
      )}
      {connected ? (
        <div className="space-y-3">
          <p className="text-body text-fg">
            Connected account: {connected.uid} · {SERVERS[provider].find(([value]) => value === connected.server)?.[1]}
          </p>
          <label className="flex min-h-11 items-center gap-3 text-body">
            <input
              type="checkbox"
              checked={connected.autoRefresh}
              disabled={busy || conflicts.length > 1}
              onChange={(event) => void run({ action: 'configure', gameId, autoRefresh: event.target.checked })}
            />
            {desktop
              ? 'Import readings every five minutes, including while playing'
              : 'Refresh automatically every five minutes while Memoria is open'}
          </label>
          {desktop && connected.autoRefresh && (
            <p className="text-meta text-muted">
              {connected.transport === 'browser' &&
                'Keep Chrome or Edge open and enable automatic readings in the browser connector. '}
              Enable Keep Memoria in the system tray in Play mode to continue after closing the window. Readings pause
              when this game is paused, the PC is offline, or you quit Memoria.
            </p>
          )}
          {connected.lastCheckedAt !== null && (
            <p className="text-meta text-muted">
              {connected.transport === 'browser' ? 'Reading captured' : 'Last checked'}{' '}
              {new Date(connected.lastCheckedAt).toLocaleString()}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Btn
              disabled={busy || conflicts.length > 1}
              kind="primary"
              onClick={() => void run({ action: 'refresh', gameId })}
            >
              {busy ? 'Checking…' : 'Fetch readings'}
            </Btn>
            <Btn disabled={busy || conflicts.length > 1} onClick={() => void run({ action: 'disconnect', gameId })}>
              Disconnect
            </Btn>
          </div>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run({
              action: 'connect',
              gameId,
              provider,
              uid,
              server: server || SERVERS[provider][0][0],
              cookie,
              autoRefresh: automatic,
              ...(browserLogin ? { transport: 'browser' } : {}),
            });
          }}
        >
          {(nativeLogin || browserLogin) && (
            <div className="space-y-2">
              <Btn disabled={busy} onClick={() => void findAccounts()}>
                Find my accounts
              </Btn>
              {accountNotice && (
                <p role="status" className="text-body text-muted">
                  {accountNotice}
                </p>
              )}
              {accounts.length > 1 && (
                <Field label="Linked HoYoLAB account">
                  <Select
                    disabled={busy}
                    value={
                      accounts.some((account) => account.uid === uid && account.server === server)
                        ? `${uid}:${server}`
                        : ''
                    }
                    onChange={(event) => {
                      const account = accounts.find((item) => `${item.uid}:${item.server}` === event.target.value);
                      if (account) {
                        setUid(account.uid);
                        setServer(account.server);
                      }
                    }}
                  >
                    <option value="">Choose an account</option>
                    {accounts.map((account) => (
                      <option key={`${account.uid}:${account.server}`} value={`${account.uid}:${account.server}`}>
                        {account.nickname || 'Traveler'} ·{' '}
                        {SERVERS[provider].find(([value]) => value === account.server)?.[1] || account.server} ·{' '}
                        {account.uid}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="In-game UID">
              <TextInput
                disabled={busy}
                required
                inputMode="numeric"
                pattern="[0-9]{8,12}"
                maxLength={12}
                value={uid}
                onChange={(event) => setUid(event.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="Game server">
              <Select
                disabled={busy}
                value={server || SERVERS[provider][0][0]}
                onChange={(event) => setServer(event.target.value)}
              >
                {SERVERS[provider].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {!nativeLogin && !browserLogin && (
            <details className="text-body text-muted">
              <summary className="min-h-11 cursor-pointer py-2 text-fg">Get a connection session</summary>
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  Sign in at{' '}
                  <a className="underline" href="https://www.hoyolab.com/" target="_blank" rel="noreferrer">
                    HoYoLAB
                  </a>{' '}
                  and enable Real-Time Notes.
                </li>
                <li>In your browser developer tools, open Network and select a Battle Chronicle request.</li>
                <li>Copy its Cookie request header into the field below. Keep it private.</li>
              </ol>
              <p className="mt-2">
                Memoria encrypts this session for your Windows user. It is excluded from game backups and device sync.
                Reconnect if HoYoLAB expires it.
              </p>
            </details>
          )}
          {!nativeLogin && !browserLogin && (
            <Field label="HoYoLAB session cookie">
              <TextInput
                required
                type="password"
                disabled={busy}
                value={cookie}
                maxLength={16000}
                onChange={(event) => setCookie(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          )}
          <label className="flex min-h-11 items-center gap-3 text-body">
            <input
              type="checkbox"
              disabled={busy}
              checked={automatic}
              onChange={(event) => setAutomatic(event.target.checked)}
            />
            Automatically import supported readings every five minutes
          </label>
          {browserLogin && (
            <p className="text-meta text-muted">
              For automatic readings, also enable the browser connector's automatic option and keep Chrome or Edge open.
            </p>
          )}
          <Btn type="submit" kind="primary" disabled={busy}>
            {busy ? 'Checking account…' : 'Connect and review'}
          </Btn>
        </form>
      )}
      {(error || refreshError) && (
        <p role="alert" className="text-body text-danger-fg">
          {error || refreshError}
        </p>
      )}
    </div>
  );
}
