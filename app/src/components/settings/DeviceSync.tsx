import { useEffect, useRef, useState } from 'react';
import { encodePairingCode } from '@memoria/shared';
import { launcherFetch, servedByLauncher } from '../../launcher';
import {
  disconnectLanSync,
  isNativeDevice,
  pairLanDevice,
  pairLanFromQr,
  syncLanNow,
  useLanSync,
} from '../../lan-sync';
import { scanPairingCode } from '../../native';
import { Btn, Field, TextInput, TOUCH_BUTTON } from '../ui';

type Devices = {
  error?: string;
  enabled: boolean;
  addresses: string[];
  code: string | null;
  expiresAt: number | null;
  devices: { id: string; name: string; pairedAt: number }[];
};
const DETAILS =
  'border-t border-line-hairline text-body text-muted [&>summary]:min-h-11 [&>summary]:cursor-pointer [&>summary]:rounded-ui-sm [&>summary]:py-3 [&>summary]:font-medium [&>summary]:text-fg-soft';
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function PairingQr({ addresses, code }: { addresses: string[]; code: string }) {
  const payload = encodePairingCode(addresses, code);
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
        if (current) setError('The QR code could not load. Use the manual code below.');
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
      alt="Scan this code with Memoria on your phone to connect"
    />
  ) : (
    <p className="flex min-h-64 items-center text-body text-muted" role="status">
      {error || 'Preparing your code…'}
    </p>
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
      if (id === requestId.current.id)
        setLoadError('Restart the PC app, then try again. If this keeps happening, restart Windows.');
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
          <p className="text-muted">
            Reset the connection, then scan a new code on your phone. Your games and progress stay saved. A copy of the
            old connection file is kept.
          </p>
          <Btn className={TOUCH_BUTTON} disabled={busy} onClick={() => void control('reset')}>
            Reset phone connection
          </Btn>
        </div>
      ) : (
        <>
          {paired && !pairingVisible && (
            <div role="status" className="space-y-1">
              <p className="text-body font-semibold text-ok-fg">
                {devices.enabled ? 'Your phone is connected' : 'Sync is paused'}
              </p>
              <p className="text-body text-muted">
                {devices.enabled
                  ? 'You’re all set. Your progress syncs automatically when both apps are open.'
                  : 'Your progress is safe on both devices. Resume when you are ready.'}
              </p>
            </div>
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
                    ? 'Connect another phone'
                    : 'Resume sync'
                  : 'Connect my phone'}
            </Btn>
          )}
          {pairingVisible && (
            <div className="grid items-start gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
              <div>
                {devices.addresses.length === 0 ? (
                  <p className="max-w-xs text-body text-muted">
                    Connect this PC to your home Wi-Fi. Your code will appear here.
                  </p>
                ) : pairingCode ? (
                  <PairingQr addresses={devices.addresses} code={pairingCode} />
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
                <p className="text-lead font-semibold text-fg">Now pick up your phone</p>
                <ol className="list-decimal space-y-2 pl-5 text-body text-muted">
                  <li>Open Memoria on your phone.</li>
                  <li>
                    Open Settings and tap <strong className="font-medium text-fg">Scan PC code</strong>.
                  </li>
                  <li>Point your camera at this code.</li>
                </ol>
                <p className="text-body text-muted">
                  Use the same Wi-Fi on both devices. Your existing progress will be kept.
                </p>
                <p role="status" className="text-meta text-muted">
                  Waiting for your phone…
                </p>
                <details className={DETAILS}>
                  <summary>Enter a code instead</summary>
                  <div className="space-y-2 pb-3">
                    <p>On your phone, tap Enter a code instead.</p>
                    <p className="font-medium text-fg">PC address</p>
                    {devices.addresses.map((address) => (
                      <p key={address} className="select-all break-all">
                        {address}
                      </p>
                    ))}
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
                <p>Sync works while Memoria is open on the PC and phone. You can keep using either app offline.</p>
                {devices.devices.map((device) => (
                  <div key={device.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 [overflow-wrap:anywhere]">{device.name}</span>
                    <Btn
                      className={TOUCH_BUTTON}
                      disabled={busy}
                      aria-label={`Disconnect ${device.name} ${device.id}`}
                      onClick={() => void control('revoke', device.id)}
                    >
                      Disconnect phone
                    </Btn>
                  </div>
                ))}
                <Btn className={TOUCH_BUTTON} disabled={busy} onClick={() => void control('stop')}>
                  Pause sync
                </Btn>
                <p className="text-meta">This keeps your saved progress and remembers your phone.</p>
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

function PhoneConnection() {
  const connection = useLanSync();
  const [host, setHost] = useState('');
  const [code, setCode] = useState('');
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
          <p className="text-body text-muted">On your PC, open Memoria → Settings → Connect my phone.</p>
          <Btn kind="primary" className={TOUCH_BUTTON} disabled={busy} onClick={() => void scan()}>
            {busy ? 'Connecting…' : 'Scan PC code'}
          </Btn>
          <p className="text-meta text-muted">
            Point your camera at the code on your PC. Your existing progress will be kept.
          </p>
          <details className={DETAILS}>
            <summary>Enter a code instead</summary>
            <form
              className="space-y-3 pb-3"
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                setError('');
                void pairLanDevice(host, code)
                  .then(() => setCode(''))
                  .catch((failure: unknown) => setError(message(failure)))
                  .finally(() => setBusy(false));
              }}
            >
              <p>On your PC, select Enter a code instead. Type both the PC address and pairing code shown there.</p>
              <Field label="PC address">
                <TextInput
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                  placeholder="Type the address shown on your PC"
                  autoCapitalize="none"
                  autoCorrect="off"
                  inputMode="url"
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
      ) : (
        <>
          <div role="status" className="space-y-1">
            <p className={`text-body font-semibold ${connection.status === 'ok' ? 'text-ok-fg' : 'text-fg'}`}>
              {connection.status === 'ok'
                ? 'Connected to your PC'
                : connection.status === 'syncing' || connection.status === 'pairing'
                  ? 'Updating your progress…'
                  : connection.status === 'offline'
                    ? 'Waiting for your PC'
                    : 'Your progress is saved on this phone'}
            </p>
            <p className="text-body text-muted">
              {connection.status === 'offline'
                ? 'You can keep using Memoria. Sync will resume when your PC is available.'
                : 'Your progress syncs automatically when both apps are open.'}
            </p>
            {connection.lastSyncAt && (
              <p className="text-meta text-muted">
                Last synced at{' '}
                {new Date(connection.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
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
              <p>If your PC has moved to another network, show a new code on the PC and scan it again.</p>
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
              <p className="text-meta">Disconnecting keeps your saved progress on both devices.</p>
            </div>
          </details>
        </>
      )}
      {(error || connection.error) && (
        <p role="alert" className="text-body text-danger-fg">
          {error || connection.error}
        </p>
      )}
    </>
  );
}

export function DeviceSync() {
  const desktop = servedByLauncher();
  const native = isNativeDevice();
  if (!desktop && !native) return null;
  return (
    <section id="device-sync" className="settings-section mb-5 min-w-0 space-y-3" aria-labelledby="wifi-sync-heading">
      <div className="space-y-1">
        <h2 id="wifi-sync-heading" className="text-heading font-semibold text-fg-soft">
          Phone & computer
        </h2>
        <p className="text-body text-muted">Keep the same progress on both devices.</p>
      </div>
      {desktop ? <DesktopConnection /> : <PhoneConnection />}
      <details className={DETAILS}>
        <summary>Need help connecting?</summary>
        <ul className="list-disc space-y-2 pb-3 pl-5">
          <li>Connect your phone and PC to the same Wi-Fi.</li>
          <li>Keep Memoria open on your PC.</li>
          <li>If Windows asks to allow Memoria through its firewall, allow it on your private network.</li>
          <li>If a code has expired, show a new code on your PC and scan it again.</li>
        </ul>
        <p className="pb-3 text-meta text-muted">Use your own trusted Wi-Fi. This local connection is not encrypted.</p>
      </details>
    </section>
  );
}
