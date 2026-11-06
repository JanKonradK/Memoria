import { useEffect, useRef, useState, type ReactNode } from 'react';
import { encodePairingCode } from '@memoria/shared';
import { launcherFetch, servedByLauncher } from '../../launcher';
import {
  disconnectLanSync,
  isNativeDevice,
  pairLanDevice,
  pairLanFromQr,
  resolveFirstSync,
  syncLanNow,
  useLanSync,
} from '../../lan-sync';
import { scanPairingCode } from '../../native';
import { Btn, Field, TextInput, TOUCH_BUTTON } from '../ui';

type Devices = {
  error?: string;
  enabled: boolean;
  fingerprint: string;
  addresses: string[];
  code: string | null;
  expiresAt: number | null;
  /** This PC's name. */
  name?: string;
  devices: { id: string; name: string; pairedAt: number; lastSeenAt?: number | null }[];
};
type Firewall = {
  supported: boolean;
  networks?: { name: string; category: string; allowed: boolean }[];
  outcome?: 'ok' | 'declined' | 'failed';
};
/** A device syncs every 15 seconds while Memoria is open on it. */
const LIVE_MS = 45_000;
const DETAILS =
  'border-t border-line text-body text-muted [&>summary]:min-h-11 [&>summary]:cursor-pointer [&>summary]:rounded-ui-sm [&>summary]:py-3 [&>summary]:font-medium [&>summary]:text-fg-soft';
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function PairingQr({ addresses, code, fingerprint }: { addresses: string[]; code: string; fingerprint: string }) {
  const payload = encodePairingCode(addresses, code, fingerprint);
  const [image, setImage] = useState<{ payload: string; src: string }>();
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    // Keep the encoder outside the normal app startup path.
    void import('qrcode')
      .then((qr) => qr.toDataURL(payload, { width: 320, margin: 4, errorCorrectionLevel: 'M' }))
      .then((src) => {
        if (current) setImage({ payload, src });
      })
      .catch(() => {
        if (current) setError('QR code failed to load. Use the code below.');
      });
    return () => {
      current = false;
    };
  }, [payload]);
  return image?.payload === payload ? (
    <img
      src={image.src}
      width={256}
      height={256}
      className="h-auto w-64 max-w-full rounded-ui-lg"
      alt="Scan this code with Memoria on your phone or tablet to connect"
    />
  ) : (
    <p className="flex min-h-64 items-center text-body text-muted" role="status">
      {error || 'Preparing your code…'}
    </p>
  );
}

function ago(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString();
}

type DeviceRow = { key: string; name: string; detail: string; live: boolean; action?: ReactNode };

/** Every device on this sync, like a browser's list of signed-in sessions. */
function DeviceList({ rows }: { rows: DeviceRow[] }) {
  return (
    <section className="space-y-2" aria-labelledby="sync-devices-heading">
      <h3 id="sync-devices-heading" className="text-body font-semibold text-fg">
        Devices
      </h3>
      <ul className="settings-devices">
        {rows.map((row) => (
          <li key={row.key} className="settings-device">
            <span className="settings-device-dot" data-live={row.live || undefined} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-fg [overflow-wrap:anywhere]">{row.name}</span>
              <span className="block text-meta text-muted">{row.detail}</span>
            </span>
            {row.action}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The usual reason a phone cannot connect: Windows Firewall has no rule for
 * this copy of Memoria, or treats the home Wi-Fi as a public network.
 */
function FirewallCheck({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState<Firewall | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void launcherFetch('/api/firewall')
      .then((response) => (response.ok ? (response.json() as Promise<Firewall>) : null))
      .then((body) => {
        if (current && body) setStatus(body);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [enabled]);
  const blocked = status?.supported && Array.isArray(status.networks) ? status.networks.filter((n) => !n.allowed) : [];
  if (!enabled || blocked.length === 0) return null;
  const isPublic = blocked.some((network) => network.category === 'Public');
  const names = blocked.map((network) => `“${network.name}”`).join(', ');
  const allow = async () => {
    setBusy(true);
    setNote('');
    try {
      const response = await launcherFetch('/api/firewall', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ makePrivate: isPublic }),
      });
      if (!response.ok) throw new Error();
      const body = (await response.json()) as Firewall;
      setStatus(body);
      if (body.outcome === 'declined') setNote('Windows needs your approval. Try again and choose Yes.');
      else if (body.outcome !== 'ok') setNote('Windows could not change the setting.');
    } catch {
      setNote('Windows could not change the setting.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="surface-notice surface-notice-warn space-y-2" aria-labelledby="sync-firewall-heading">
      <h3 id="sync-firewall-heading" className="text-body font-semibold text-fg">
        Windows is blocking phones
      </h3>
      <p className="text-body text-fg-soft">
        {isPublic
          ? `Windows treats ${names} as a public network, so phones and tablets cannot reach Memoria.`
          : 'Windows Firewall does not let phones and tablets reach this copy of Memoria.'}
      </p>
      <Btn kind="primary" className={TOUCH_BUTTON} disabled={busy} onClick={() => void allow()}>
        {busy ? 'Waiting for Windows…' : isPublic ? 'Allow phones on this Wi-Fi' : 'Allow through Windows Firewall'}
      </Btn>
      <p className="text-meta text-fg-soft">
        {isPublic
          ? 'Windows asks for permission, then marks this Wi-Fi as your private home network. Only do this on your own Wi-Fi.'
          : 'Windows asks for permission first.'}
      </p>
      {note && (
        <p role="alert" className="text-body text-danger-fg">
          {note}
        </p>
      )}
    </section>
  );
}

function DesktopConnection() {
  const [devices, setDevices] = useState<Devices | null>(null);
  const [showPairing, setShowPairing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [now, setNow] = useState(Date.now());
  const requestId = useRef({ id: 0 });
  const working = useRef(false);
  const pairingDeviceIds = useRef<string[]>([]);
  const refresh = async () => {
    if (working.current) return;
    const id = ++requestId.current.id;
    try {
      const response = await launcherFetch('/api/devices');
      if (!response.ok) throw new Error('PC app unavailable');
      const body = (await response.json()) as Devices;
      if (id !== requestId.current.id) return;
      setDevices(body);
      if (body.devices.some((device) => !pairingDeviceIds.current.includes(device.id))) setShowPairing(false);
      setLoadError('');
      setNow(Date.now());
    } catch {
      if (id === requestId.current.id) setLoadError('Restart Memoria on the PC and try again.');
    }
  };
  useEffect(() => {
    const requests = requestId.current;
    void refresh();
    const interval = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 2000);
    return () => {
      ++requests.id;
      clearInterval(interval);
    };
  }, []);
  const control = async (action: string, id?: string) => {
    if (working.current) return;
    working.current = true;
    ++requestId.current.id;
    setBusy(true);
    setError('');
    try {
      const response = await launcherFetch('/api/devices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, id }),
      });
      if (!response.ok) throw new Error('Could not connect. Keep Memoria open and try again.');
      const next = (await response.json()) as Devices;
      setDevices(next);
      pairingDeviceIds.current = next.devices.map((device) => device.id);
      setNow(Date.now());
      setShowPairing(action === 'code' || (action === 'start' && !devices?.devices.length));
    } catch (failure) {
      setError(message(failure));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const paired = (devices?.devices.length ?? 0) > 0;
  const pairingVisible = devices?.enabled && (!paired || showPairing);
  const pairingCode = devices?.expiresAt && devices.expiresAt > now ? devices.code : null;
  return (
    <>
      {loadError ? (
        <div role="alert" className="space-y-2 text-body text-danger-fg">
          <p>{loadError}</p>
          <Btn className={TOUCH_BUTTON} onClick={() => void refresh()}>
            Try again
          </Btn>
        </div>
      ) : !devices ? (
        <p role="status" className="text-body text-muted">
          Checking your connection…
        </p>
      ) : devices.error ? (
        <div className="space-y-3 text-body">
          <p role="alert" className="text-danger-fg">
            {devices.error}
          </p>
          <p className="text-muted">Reset, then scan a new code on your phone or tablet. Your data stays.</p>
          <Btn className={TOUCH_BUTTON} disabled={busy} onClick={() => void control('reset')}>
            Reset device connection
          </Btn>
        </div>
      ) : (
        <>
          <FirewallCheck enabled={devices.enabled} />
          {paired && (
            <DeviceList
              rows={[
                {
                  key: 'pc',
                  name: devices.name || 'This PC',
                  detail: devices.enabled ? 'This PC' : 'This PC · sync paused',
                  live: devices.enabled,
                },
                ...devices.devices.map((device) => {
                  const live = devices.enabled && !!device.lastSeenAt && now - device.lastSeenAt < LIVE_MS;
                  return {
                    key: device.id,
                    name: device.name,
                    live,
                    detail: live
                      ? 'Connected'
                      : device.lastSeenAt
                        ? `Last synced ${ago(device.lastSeenAt, now)}`
                        : 'Not synced since Memoria started',
                    action: (
                      <Btn
                        className={TOUCH_BUTTON}
                        disabled={busy}
                        aria-label={`Disconnect ${device.name} ${device.id}`}
                        onClick={() => void control('revoke', device.id)}
                      >
                        Disconnect
                      </Btn>
                    ),
                  };
                }),
              ]}
            />
          )}
          {!pairingVisible && (
            <Btn
              kind={paired && devices.enabled ? 'ghost' : 'primary'}
              className={TOUCH_BUTTON}
              disabled={busy}
              onClick={() => void control(devices.enabled ? 'code' : 'start')}
            >
              {busy
                ? 'Preparing…'
                : paired
                  ? devices.enabled
                    ? 'Connect another device'
                    : 'Resume sync'
                  : 'Connect my phone or tablet'}
            </Btn>
          )}
          {pairingVisible && (
            <div className="grid items-start gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
              <div>
                {devices.addresses.length === 0 ? (
                  <p className="max-w-xs text-body text-muted">Connect this PC to Wi-Fi to show a code.</p>
                ) : pairingCode ? (
                  <PairingQr addresses={devices.addresses} code={pairingCode} fingerprint={devices.fingerprint} />
                ) : (
                  <div className="space-y-3">
                    <p className="text-body text-muted">This code has expired.</p>
                    <Btn kind="primary" className={TOUCH_BUTTON} disabled={busy} onClick={() => void control('code')}>
                      Show a new code
                    </Btn>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <p className="text-lead font-semibold text-fg">On your phone or tablet</p>
                <ol className="list-decimal space-y-2 pl-5 text-body text-muted">
                  <li>Open Memoria.</li>
                  <li>
                    Settings → <strong className="font-medium text-fg">Scan PC code</strong>.
                  </li>
                  <li>Scan this code. Both devices need the same Wi-Fi.</li>
                </ol>
                <p role="status" className="text-meta text-muted">
                  Waiting for your device…
                </p>
                <details className={DETAILS}>
                  <summary>Enter a code instead</summary>
                  <div className="space-y-2 pb-3">
                    <p className="font-medium text-fg">PC address</p>
                    {devices.addresses.map((address) => (
                      <p key={address} className="select-all break-all">
                        {address}
                      </p>
                    ))}
                    <p className="font-medium text-fg">PC key fingerprint</p>
                    <p className="select-all break-all">{devices.fingerprint}</p>
                    <p className="font-medium text-fg">Pairing code</p>
                    <p className="select-all text-heading tabular-nums text-fg">
                      {pairingCode ? `${pairingCode.slice(0, 4)} ${pairingCode.slice(4)}` : 'Show a new code first'}
                    </p>
                  </div>
                </details>
              </div>
            </div>
          )}
          {devices.enabled && (
            <details className={DETAILS}>
              <summary>Manage connection</summary>
              <div className="space-y-3 pb-3">
                <p>Pausing stops every device from syncing until you resume.</p>
                <Btn className={TOUCH_BUTTON} disabled={busy} onClick={() => void control('stop')}>
                  Pause sync
                </Btn>
              </div>
            </details>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-body text-danger-fg">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * Shown instead of syncing when this device and the PC each hold games the
 * other has never seen. Nothing has been sent or merged yet.
 */
function FirstSyncChoice({ deviceGames, pcGames }: { deviceGames: number; pcGames: number }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const answer = (choice: Parameters<typeof resolveFirstSync>[0]) => {
    setBusy(true);
    void resolveFirstSync(choice).finally(() => setBusy(false));
  };
  const games = (count: number) => `${count} ${count === 1 ? 'game' : 'games'}`;
  return (
    <section className="space-y-3" aria-labelledby="first-sync-heading">
      <h3 id="first-sync-heading" className="text-heading font-semibold text-fg">
        Both devices already have games
      </h3>
      <p className="text-body text-muted">
        This device has {games(deviceGames)}, your PC has {games(pcGames)}. Nothing synced yet.
      </p>
      <div className="space-y-1">
        <div className="flex flex-wrap gap-2">
          <Btn
            kind={confirming ? 'danger' : 'primary'}
            className={TOUCH_BUTTON}
            disabled={busy}
            onClick={() => (confirming ? answer('pc') : setConfirming(true))}
          >
            {confirming ? `Confirm: remove this device's ${games(deviceGames)}` : 'Use my PC’s data'}
          </Btn>
          {confirming && (
            <Btn className={TOUCH_BUTTON} disabled={busy} onClick={() => setConfirming(false)}>
              Keep this device’s games
            </Btn>
          )}
        </div>
        <p className="text-meta text-muted">Replaces this device's games with your PC's.</p>
      </div>
      <div className="space-y-1">
        <Btn className={TOUCH_BUTTON} disabled={busy} onClick={() => answer('combine')}>
          Combine both
        </Btn>
        <p className="text-meta text-muted">Keeps both. A game on both appears twice.</p>
      </div>
      <div className="space-y-1">
        <Btn className={TOUCH_BUTTON} disabled={busy} onClick={() => answer('cancel')}>
          Cancel and disconnect
        </Btn>
      </div>
    </section>
  );
}

function PhoneConnection() {
  const connection = useLanSync();
  const [host, setHost] = useState('');
  const [code, setCode] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scan = async () => {
    setBusy(true);
    setError('');
    try {
      await pairLanFromQr(await scanPairingCode());
    } catch (failure) {
      if (!(failure && typeof failure === 'object' && 'code' in failure && failure.code === 'CANCELLED'))
        setError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {!connection.host ? (
        <>
          <p className="text-body text-muted">On your PC: Settings → Connect my phone or tablet.</p>
          <Btn kind="primary" className={TOUCH_BUTTON} disabled={busy} onClick={() => void scan()}>
            {busy ? 'Connecting…' : 'Scan PC code'}
          </Btn>
          <details className={DETAILS}>
            <summary>Enter a code instead</summary>
            <form
              className="space-y-3 pb-3"
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                setError('');
                void pairLanDevice(host, code, fingerprint)
                  .then(() => setCode(''))
                  .catch((failure: unknown) => setError(message(failure)))
                  .finally(() => setBusy(false));
              }}
            >
              <Field label="PC address">
                <TextInput
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                  placeholder="Shown on your PC"
                  autoCapitalize="none"
                  autoCorrect="off"
                  inputMode="url"
                  required
                  disabled={busy}
                />
              </Field>
              <Field label="PC key fingerprint">
                <TextInput
                  value={fingerprint}
                  onChange={(event) => setFingerprint(event.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  required
                  disabled={busy}
                />
              </Field>
              <Field label="Pairing code">
                <TextInput
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="Eight-digit code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={12}
                  required
                  disabled={busy}
                />
              </Field>
              <Btn type="submit" kind="primary" className={TOUCH_BUTTON} disabled={busy}>
                {busy ? 'Connecting…' : 'Connect to PC'}
              </Btn>
            </form>
          </details>
        </>
      ) : connection.choice ? (
        <FirstSyncChoice {...connection.choice} />
      ) : (
        <>
          <div role="status" className="space-y-1">
            <p className={`text-body font-semibold ${connection.status === 'ok' ? 'text-ok-fg' : 'text-fg'}`}>
              {connection.status === 'ok'
                ? 'Connected to your PC'
                : connection.status === 'syncing' || connection.status === 'pairing'
                  ? 'Syncing…'
                  : connection.status === 'offline'
                    ? 'Waiting for your PC'
                    : 'Not connected'}
            </p>
            {connection.lastSyncAt && (
              <p className="text-meta text-muted">
                Last synced at{' '}
                {new Date(connection.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <DeviceList
            rows={[
              {
                key: 'pc',
                name: connection.pcName || 'Your PC',
                detail:
                  connection.status === 'ok'
                    ? 'PC · connected'
                    : connection.status === 'offline'
                      ? 'PC · not reachable'
                      : 'PC',
                live: connection.status === 'ok',
              },
              {
                key: 'self',
                name: connection.peers.find((peer) => peer.id === connection.deviceId)?.name ?? 'This device',
                detail: 'This device',
                live: connection.status === 'ok',
              },
              ...connection.peers
                .filter((peer) => peer.id !== connection.deviceId)
                .map((peer) => {
                  const live = !!peer.lastSeenAt && Date.now() - peer.lastSeenAt < LIVE_MS;
                  return {
                    key: peer.id,
                    name: peer.name,
                    live,
                    detail: live
                      ? 'Connected'
                      : peer.lastSeenAt
                        ? `Last synced ${ago(peer.lastSeenAt, Date.now())}`
                        : 'Not synced lately',
                  };
                }),
            ]}
          />
          <details className={DETAILS}>
            <summary>Connection options</summary>
            <div className="space-y-3 pb-3">
              <Btn
                className={TOUCH_BUTTON}
                disabled={busy || connection.status === 'syncing'}
                onClick={() => void syncLanNow()}
              >
                Check connection
              </Btn>
              <p>PC on a new network? Scan a new code.</p>
              <Btn className={TOUCH_BUTTON} disabled={busy} onClick={() => void scan()}>
                {busy ? 'Connecting…' : 'Scan a new PC code'}
              </Btn>
              <p className="break-all text-meta">PC address: {connection.host}</p>
              <Btn
                className={TOUCH_BUTTON}
                disabled={busy}
                onClick={() => {
                  setError('');
                  void disconnectLanSync();
                }}
              >
                Disconnect
              </Btn>
            </div>
          </details>
        </>
      )}
      {(error || (!connection.choice && connection.error)) && (
        <p role="alert" className="text-body text-danger-fg">
          {error || connection.error}
        </p>
      )}
    </>
  );
}

/** Wi-Fi sync between the Windows app and a paired phone or tablet. */
export function DeviceSync() {
  const desktop = servedByLauncher();
  const native = isNativeDevice();
  if (!desktop && !native) return null;
  return (
    <div id="device-sync" className="settings-sync min-w-0 space-y-3">
      <p className="text-body text-muted">
        Devices paired before Beta 0.4 must be paired again to enable encrypted sync.
      </p>
      {desktop ? <DesktopConnection /> : <PhoneConnection />}
      <details className={DETAILS}>
        <summary>Need help connecting?</summary>
        <ul className="list-disc space-y-2 pb-3 pl-5">
          <li>Connect both devices to the same Wi-Fi.</li>
          <li>Keep Memoria open on your PC.</li>
          <li>If the PC says Windows is blocking phones, select Allow there and approve the prompt.</li>
          <li>Code expired? Show a new one on the PC.</li>
          <li>
            Away from home? Install Tailscale on both devices and sign in to the same account. After the next sync, the
            phone reaches the PC from any network.
          </li>
        </ul>
        <p className="pb-3 text-meta text-muted">Sync is encrypted and checks both device keys.</p>
      </details>
    </div>
  );
}

/** Whether this build offers Wi-Fi sync at all. */
export function deviceSyncAvailable() {
  return servedByLauncher() || isNativeDevice();
}
