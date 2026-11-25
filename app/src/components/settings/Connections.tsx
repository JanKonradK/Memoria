import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Game } from '@memoria/shared';
import {
  canImportBrowser,
  cancelBrowserConnect,
  canStartBrowserConnect,
  captureScreenshot,
  chooseScreenshotFolder,
  clearConnectorNotice,
  clearScreenshotCaptures,
  clearScreenshotFolder,
  connectorRuntime,
  disconnectHoyolab,
  disconnectSkport,
  gachaPreset,
  hoyolabPreset,
  importHoyolabBrowser,
  importSkportBrowser,
  inBackoff,
  linkHoyolabGame,
  linkSkportGame,
  loadConnectorStatus,
  openBrowserHelper,
  openBrowserScreenshot,
  openScreenshotCaptures,
  pickScreenshotFile,
  refreshHoyolab,
  refreshSkport,
  setAutoRefreshOnExit,
  setConnectorNotice,
  setScreenshotShortcut,
  setSkportAutoRefreshOnExit,
  signInHoyolab,
  signInSkport,
  skportPreset,
  startBrowserConnect,
  useConnectors,
} from '../../connectors';
import { useCopyCode } from '../../codes';
import { useNow } from '../../hooks';
import { useApp } from '../../store';
import { useUI } from '../../ui-store';
import { openGame } from '../../workspace-navigation';
import { fmtDur } from '../../util';
import { rosterGames } from '../roster';
import { confirmDialog } from '../ConfirmDialog';
import { Btn, Select, TextInput, Toggle, TOUCH_BUTTON } from '../ui';
import { SettingRow, SettingsGroup } from './SettingRow';

const NOT_LINKED = '';
/** The Windows app's own default; Reset returns to it. */
const DEFAULT_SCREENSHOT_SHORTCUT = 'Ctrl+Shift+M';
/** A notice older than this is not news when Connections opens again. */
const STALE_NOTICE_MS = 5_000;

type Status = ReturnType<typeof useConnectors.getState>['status'];

/**
 * Opt-in live numbers. Everything here is off until the player turns it on,
 * and sign-ins stay in the device's own protected store, never in backups or
 * sync.
 */
export function Connections() {
  const runtime = connectorRuntime();
  const trackedGames = useApp((store) => store.state.games);
  const games = rosterGames(trackedGames).filter((game) => !game.deleted);
  const notice = useConnectors((store) => store.notice);
  const status = useConnectors((store) => store.status);

  useEffect(() => {
    if (runtime !== 'web' && !useConnectors.getState().status) void loadConnectorStatus();
  }, [runtime]);
  // An old error would otherwise be announced again as if it had just happened.
  useEffect(() => clearConnectorNotice(STALE_NOTICE_MS), []);

  const hoyoGames = games.filter((game) => hoyolabPreset(game));
  const skportGames = games.filter((game) => skportPreset(game));
  const gachaGames = games.filter((game) => gachaPreset(game));
  const storeName = runtime === 'android' ? 'the Android Keystore' : 'Windows data protection (DPAPI)';

  return (
    <div className="min-w-0">
      <p className="settings-note text-body text-muted">
        Optional ways to fill in numbers for you. Each is off until you turn it on.
        {runtime === 'web'
          ? ' Files you pick here are read in this browser and never uploaded.'
          : ` Sign-ins stay on this device in ${storeName} and are never put in backups or sync.`}
      </p>
      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`settings-note text-body ${notice.tone === 'error' ? 'text-danger-fg' : notice.tone === 'warn' ? 'text-warn-fg' : 'text-fg-soft'}`}
        >
          {notice.text}
        </p>
      )}

      <SettingsGroup title="HoYoLAB Real-Time Notes">
        {runtime === 'web' ? (
          <p className="settings-note text-body text-muted">
            Live HoYoLAB numbers (Genshin Impact, Honkai: Star Rail, Zenless Zone Zero) need the Windows or Android app,
            which keep your sign-in off the web and can reach HoYoLAB directly. Pull History import below works in any
            browser.
          </p>
        ) : (
          <HoyolabRows games={hoyoGames} status={status} runtime={runtime} />
        )}
      </SettingsGroup>

      <SettingsGroup title="SKPORT · Arknights: Endfield">
        {runtime === 'web' ? (
          <p className="settings-note text-body text-muted">
            Live Arknights: Endfield numbers through SKPORT work only in the Windows or Android app, which keep your
            sign-in off the web and can reach SKPORT directly. Below, you can still type numbers from a screenshot in
            any browser.
          </p>
        ) : (
          <SkportRows games={skportGames} status={status} runtime={runtime} />
        )}
      </SettingsGroup>

      <SettingsGroup title="Screenshot reader">
        <ScreenshotRows runtime={runtime} status={status} />
      </SettingsGroup>

      <SettingsGroup title="Pull History">
        <p className="settings-note text-body text-muted">
          {runtime === 'desktop'
            ? 'Read pity from the game on this PC, or import a UIGF v4 or pull-history JSON file, on each game’s Pulls tab.'
            : 'Import a UIGF v4 or pull-history JSON file on each game’s Pulls tab.'}
        </p>
        {gachaGames.length === 0 ? (
          <p className="settings-note text-body text-muted">
            Covers Genshin Impact, Honkai: Star Rail, Zenless Zone Zero and Wuthering Waves. Track one to use it.
          </p>
        ) : (
          <div className="settings-rows">
            {gachaGames.map((game) => (
              <SettingRow key={game.id} label={game.name}>
                <Btn
                  className={TOUCH_BUTTON}
                  aria-label={`Open ${game.name} pulls`}
                  onClick={() => {
                    useUI.getState().setGameTab('pulls');
                    openGame(game.id);
                  }}
                >
                  Open Pulls
                </Btn>
              </SettingRow>
            ))}
          </div>
        )}
      </SettingsGroup>
    </div>
  );
}

function HoyolabRows({
  games,
  status,
  runtime,
}: {
  games: Game[];
  status: ReturnType<typeof useConnectors.getState>['status'];
  runtime: 'desktop' | 'android';
}) {
  const busy = useConnectors((store) => store.busy);
  const now = useNow(30_000);
  const hoyolab = status?.hoyolab;
  const backoff = inBackoff(status, now) ? hoyolab!.backoffUntilMs! : null;

  if (!status) return <p className="settings-note text-body text-muted">Reading connections…</p>;
  if (!hoyolab?.connected)
    return (
      <div className="settings-rows">
        <SettingRow
          label="Sign in to HoYoLAB"
          hint="Reads resin, stamina, dailies, weekly bosses and endgame cycles for the games you link. Nothing is changed in your account."
        >
          <Btn kind="primary" className={TOUCH_BUTTON} disabled={busy.login} onClick={() => void signInHoyolab()}>
            {busy.login ? 'Opening…' : 'Sign in'}
          </Btn>
        </SettingRow>
        <BrowserConnect provider="hoyolab" />
      </div>
    );

  return (
    <div className="settings-rows">
      <SettingRow
        label={`Connected · ${hoyolab.maskedUid ?? 'HoYoLAB'}`}
        hint="Refresh your sign-in for 1-click claiming, or sign out to remove it from this device."
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Btn className={TOUCH_BUTTON} disabled={busy.login} onClick={() => void signInHoyolab()}>
            {busy.login ? 'Opening…' : 'Sign in again'}
          </Btn>
          <Btn className={TOUCH_BUTTON} disabled={busy.login} onClick={() => void signInHoyolab(true)}>
            Switch account
          </Btn>
          <Btn className={TOUCH_BUTTON} disabled={busy.disconnect} onClick={() => void disconnectHoyolab()}>
            Disconnect
          </Btn>
        </div>
      </SettingRow>
      <BrowserConnect provider="hoyolab" />
      {runtime === 'desktop' && (
        <SettingRow
          label="Refresh when a game closes"
          hint="When a linked game closes on this PC, Memoria reads its numbers once."
        >
          <Toggle
            ariaLabel="Refresh when a game closes"
            checked={hoyolab.autoRefreshOnExit}
            onChange={(on) => void setAutoRefreshOnExit(on)}
          />
        </SettingRow>
      )}
      {backoff != null && (
        <p role="status" className="settings-note text-body text-warn-fg">
          HoYoLAB asked Memoria to wait. Refresh is paused for {fmtDur(backoff - now)}.
        </p>
      )}
      {games.length === 0 ? (
        <p className="settings-note text-body text-muted">
          Track Genshin Impact, Honkai: Star Rail or Zenless Zone Zero to link it here.
        </p>
      ) : (
        games.map((game) => <HoyolabGameRow key={game.id} game={game} status={status} backoff={backoff != null} />)
      )}
    </div>
  );
}

function HoyolabGameRow({
  game,
  status,
  backoff,
}: {
  game: Game;
  status: NonNullable<ReturnType<typeof useConnectors.getState>['status']>;
  backoff: boolean;
}) {
  const presetKey = hoyolabPreset(game)!;
  const linking = useConnectors((store) => Boolean(store.busy[`link:${game.id}`]));
  const refreshing = useConnectors((store) => Boolean(store.busy[`refresh:${game.id}`]));
  const roles = status.hoyolab.roles.filter((role) => role.presetKey === presetKey);
  const link = status.hoyolab.gameLinks[game.id];
  const value = link ? `${link.uid}|${link.region}` : NOT_LINKED;

  return (
    <SettingRow
      label={game.name}
      hint={roles.length === 0 ? 'No account for this game on your HoYoLAB profile.' : undefined}
      control="below"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-48 flex-1">
          <Select
            aria-label={`HoYoLAB account for ${game.name}`}
            value={value}
            disabled={linking || roles.length === 0}
            onChange={(event) => {
              const next = event.target.value;
              if (next === NOT_LINKED) {
                void linkHoyolabGame(game.id, presetKey, null, null);
                return;
              }
              const role = roles.find((item) => `${item.uid}|${item.region}` === next);
              if (role) void linkHoyolabGame(game.id, presetKey, role.uid, role.region);
            }}
          >
            <option value={NOT_LINKED}>Not linked</option>
            {roles.map((role) => (
              <option key={`${role.uid}|${role.region}`} value={`${role.uid}|${role.region}`}>
                {[role.nickname, role.uid, role.regionName ?? role.region].filter(Boolean).join(' · ')}
              </option>
            ))}
          </Select>
        </div>
        {link && (
          <Btn
            className={TOUCH_BUTTON}
            disabled={refreshing || backoff}
            aria-label={`Refresh now: ${game.name}`}
            onClick={() => void refreshHoyolab(game.id)}
          >
            {refreshing ? 'Reading…' : 'Refresh now'}
          </Btn>
        )}
      </div>
    </SettingRow>
  );
}

function SkportRows({ games, status, runtime }: { games: Game[]; status: Status; runtime: 'desktop' | 'android' }) {
  const busy = useConnectors((store) => store.busy);
  const skport = status?.skport;

  if (!status) return <p className="settings-note text-body text-muted">Reading connections…</p>;
  if (!skport)
    return (
      <p className="settings-note text-body text-muted">
        Update Memoria on this device to read Arknights: Endfield through SKPORT.
      </p>
    );
  if (!skport.connected)
    return (
      <div className="settings-rows">
        <SettingRow
          label="Sign in to SKPORT"
          hint="Reads Sanity and Daily Activity for the Arknights: Endfield account you link. Nothing is changed in your account."
        >
          <Btn
            kind="primary"
            className={TOUCH_BUTTON}
            aria-label="Sign in to SKPORT"
            disabled={busy['skport:login']}
            onClick={() => void signInSkport()}
          >
            {busy['skport:login'] ? 'Opening…' : 'Sign in'}
          </Btn>
        </SettingRow>
        <BrowserConnect provider="skport" />
      </div>
    );

  return (
    <div className="settings-rows">
      <SettingRow label={`Connected · ${skport.maskedUid ?? 'SKPORT'}`} hint="Signing out removes it from this device.">
        <div className="flex flex-wrap justify-end gap-2">
          <Btn
            className={TOUCH_BUTTON}
            aria-label="Sign in to SKPORT again"
            disabled={busy['skport:login']}
            onClick={() => void signInSkport()}
          >
            {busy['skport:login'] ? 'Opening…' : 'Sign in again'}
          </Btn>
          <Btn
            className={TOUCH_BUTTON}
            aria-label="Switch SKPORT account"
            disabled={busy['skport:login']}
            onClick={() => void signInSkport(true)}
          >
            Switch account
          </Btn>
          <Btn
            className={TOUCH_BUTTON}
            aria-label="Disconnect SKPORT"
            disabled={busy['skport:disconnect']}
            onClick={() => void disconnectSkport()}
          >
            Disconnect
          </Btn>
        </div>
      </SettingRow>
      <BrowserConnect provider="skport" />
      {runtime === 'desktop' && (
        <SettingRow
          label="Refresh when Endfield closes"
          hint="When a linked Arknights: Endfield closes on this PC, Memoria reads its numbers once."
        >
          <Toggle
            ariaLabel="Refresh when Endfield closes"
            checked={skport.autoRefreshOnExit}
            onChange={(on) => void setSkportAutoRefreshOnExit(on)}
          />
        </SettingRow>
      )}
      {games.length === 0 ? (
        <p className="settings-note text-body text-muted">Track Arknights: Endfield to link it here.</p>
      ) : (
        games.map((game) => <SkportGameRow key={game.id} game={game} skport={skport} />)
      )}
    </div>
  );
}

const PROVIDER_NAME = { hoyolab: 'HoYoLAB', skport: 'SKPORT' } as const;

/**
 * Connects from a browser the player is already signed in to: a one-time code
 * for the Memoria Browser Helper extension on Windows, or a pasted request
 * from DevTools. The pasted text goes straight to the native host and is
 * cleared from the field at once.
 */
function BrowserConnect({ provider }: { provider: 'hoyolab' | 'skport' }) {
  const name = PROVIDER_NAME[provider];
  const busy = useConnectors((store) => store.busy);
  const handoff = useConnectors((store) => store.activeBrowserHandoff);
  const { copied, message, copy } = useCopyCode();
  const [open, setOpen] = useState(false);
  const secret = useRef<HTMLInputElement>(null);
  const pasteId = useId();
  const helper = canStartBrowserConnect();
  const paste = canImportBrowser(provider);
  if (!helper && !paste) return null;
  const mine = handoff?.provider === provider ? handoff : null;

  const submit = () => {
    const field = secret.current;
    const raw = field?.value ?? '';
    if (field) field.value = '';
    if (!raw.trim()) return;
    void (provider === 'hoyolab' ? importHoyolabBrowser(raw) : importSkportBrowser(raw));
  };

  return (
    <SettingRow
      label="Use my browser"
      hint={`Already signed in to ${name} in your browser? Connect that session instead of signing in here.`}
      control="below"
    >
      <div className="space-y-3">
        <Btn
          className={TOUCH_BUTTON}
          aria-expanded={open}
          aria-label={`Use my browser for ${name}`}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Hide browser options' : 'Use my browser'}
        </Btn>
        {open && helper && (
          <div className="space-y-2">
            {mine ? (
              <>
                <p className="text-meta text-muted">
                  The Memoria Browser Helper extension reads your signed-in {name} session, HttpOnly cookies included,
                  and hands it to this app once. Enter this code in it:
                </p>
                <p
                  className="font-mono text-title font-semibold tracking-widest text-fg"
                  aria-label={`${name} pairing code`}
                >
                  {mine.code}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Btn className={TOUCH_BUTTON} onClick={() => void copy(mine.code)}>
                    {copied === mine.code ? 'Copied' : 'Copy code'}
                  </Btn>
                  <Btn
                    className={TOUCH_BUTTON}
                    disabled={busy['browser:helper']}
                    onClick={() => void openBrowserHelper()}
                  >
                    Open extension folder
                  </Btn>
                  <Btn className={TOUCH_BUTTON} onClick={() => void cancelBrowserConnect()}>
                    Cancel
                  </Btn>
                </div>
                <p role="status" className="text-meta text-fg-soft">
                  {message}
                </p>
              </>
            ) : (
              <Btn
                kind="primary"
                className={TOUCH_BUTTON}
                disabled={busy[`browser:${provider}`]}
                onClick={() => void startBrowserConnect(provider)}
              >
                Open {name} in browser
              </Btn>
            )}
          </div>
        )}
        {open && paste && (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label htmlFor={pasteId} className="block text-meta text-muted">
              Or paste from browser DevTools: a Cookie header, Copy as cURL or Copy as fetch.
            </label>
            <div className="flex gap-2">
              <TextInput
                id={pasteId}
                ref={secret}
                type="password"
                autoComplete="off"
                spellCheck={false}
                aria-label={`Paste ${name} request`}
                className="min-w-0 flex-1"
              />
              <Btn
                kind="primary"
                type="submit"
                className={TOUCH_BUTTON}
                aria-label={`Connect ${name} from pasted request`}
                disabled={busy[`${provider}:import`]}
              >
                Connect
              </Btn>
            </div>
          </form>
        )}
      </div>
    </SettingRow>
  );
}

function SkportGameRow({ game, skport }: { game: Game; skport: NonNullable<NonNullable<Status>['skport']> }) {
  const presetKey = skportPreset(game)!;
  const linking = useConnectors((store) => Boolean(store.busy[`link:${game.id}`]));
  const refreshing = useConnectors((store) => Boolean(store.busy[`refresh:${game.id}`]));
  const roles = skport.roles.filter((role) => role.presetKey === presetKey);
  const link = skport.gameLinks[game.id];
  const value = link ? `${link.uid}|${link.region}` : NOT_LINKED;

  return (
    <SettingRow
      label={game.name}
      hint={roles.length === 0 ? 'No Arknights: Endfield account on your SKPORT profile.' : undefined}
      control="below"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-48 flex-1">
          <Select
            aria-label={`SKPORT account for ${game.name}`}
            value={value}
            disabled={linking || roles.length === 0}
            onChange={(event) => {
              const next = event.target.value;
              if (next === NOT_LINKED) {
                void linkSkportGame(game.id, null, null);
                return;
              }
              const role = roles.find((item) => `${item.uid}|${item.region}` === next);
              if (role) void linkSkportGame(game.id, role.uid, role.region);
            }}
          >
            <option value={NOT_LINKED}>Not linked</option>
            {roles.map((role) => (
              <option key={`${role.uid}|${role.region}`} value={`${role.uid}|${role.region}`}>
                {[
                  role.nickname,
                  role.level != null ? `Lv. ${role.level}` : null,
                  role.uid,
                  role.regionName ?? role.region,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </option>
            ))}
          </Select>
        </div>
        {link && (
          <Btn
            className={TOUCH_BUTTON}
            disabled={refreshing}
            aria-label={`Refresh now: ${game.name}`}
            onClick={() => void refreshSkport(game.id)}
          >
            {refreshing ? 'Reading…' : 'Refresh now'}
          </Btn>
        )}
      </div>
    </SettingRow>
  );
}

/** Letters, digits, F1–F12 and PrintScreen, named as the Windows app reads them; null for any other key. */
function shortcutKey(event: ReactKeyboardEvent): string | null {
  const code = event.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  if (code === 'PrintScreen' || event.key === 'PrintScreen') return 'PrintScreen';
  return null;
}

/** Function keys and PrintScreen may stand alone; a letter or digit needs Ctrl, Alt or Shift. */
function standsAlone(key: string): boolean {
  return key === 'PrintScreen' || /^F[0-9]+$/.test(key);
}

/** Click, then press the keys. Esc cancels; Tab moves on, so the keyboard is never trapped. */
function ShortcutRecorder({
  accelerator,
  disabled,
  onChange,
}: {
  accelerator: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState('');
  const stop = () => {
    setRecording(false);
    setHint('');
  };

  const record = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    if (event.key === 'Tab') {
      stop();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      stop();
      return;
    }
    const key = shortcutKey(event);
    if (!key) return;
    const modifiers = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift'].filter(
      (part): part is string => typeof part === 'string',
    );
    if (modifiers.length === 0 && !standsAlone(key)) {
      setHint('Add Ctrl, Alt or Shift to that key.');
      return;
    }
    stop();
    const next = [...modifiers, key].join('+');
    if (next !== accelerator) onChange(next);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Btn
        className={`min-w-36 font-mono ${TOUCH_BUTTON}`}
        aria-label={recording ? 'Press shortcut… (Esc cancels)' : `Change shortcut, now ${accelerator}`}
        aria-pressed={recording}
        disabled={disabled}
        onClick={() => {
          setHint('');
          setRecording((value) => !value);
        }}
        onKeyDown={record}
        onKeyUp={(event) => {
          // Windows hands PrintScreen to a page only on key up.
          if (recording && event.key === 'PrintScreen') record(event);
        }}
        onBlur={stop}
      >
        {recording ? 'Press shortcut… (Esc cancels)' : accelerator}
      </Btn>
      {hint && (
        <span role="status" className="text-caption text-warn-fg">
          {hint}
        </span>
      )}
    </div>
  );
}

function ScreenshotShortcutRows({ status }: { status: Status }) {
  const busy = useConnectors((store) => Boolean(store.busy.shortcut));
  const shortcut = status?.screenshotShortcut;
  if (!shortcut) return null;
  const accelerator = shortcut.accelerator || DEFAULT_SCREENSHOT_SHORTCUT;
  return (
    <>
      <SettingRow label="Global shortcut" hint={`Press ${accelerator} anywhere, even in a game, to snip a reading.`}>
        <Toggle
          ariaLabel="Global screenshot shortcut"
          checked={shortcut.enabled}
          onChange={(on) => void setScreenshotShortcut(on, accelerator)}
        />
      </SettingRow>
      <SettingRow label="Shortcut" hint="Ctrl, Alt or Shift with a letter or digit, or F1–F12 or PrintScreen.">
        <div className="flex flex-wrap items-start justify-end gap-2">
          <ShortcutRecorder
            accelerator={accelerator}
            disabled={busy}
            onChange={(next) => void setScreenshotShortcut(shortcut.enabled, next)}
          />
          {accelerator !== DEFAULT_SCREENSHOT_SHORTCUT && (
            <Btn
              className={TOUCH_BUTTON}
              disabled={busy}
              aria-label={`Reset shortcut to ${DEFAULT_SCREENSHOT_SHORTCUT}`}
              onClick={() => void setScreenshotShortcut(shortcut.enabled, DEFAULT_SCREENSHOT_SHORTCUT)}
            >
              Reset
            </Btn>
          )}
        </div>
      </SettingRow>
      {shortcut.registered === false && shortcut.error && (
        <p role="alert" className="settings-note text-body text-warn-fg">
          {accelerator} could not be set: {shortcut.error} Choose another shortcut.
        </p>
      )}
    </>
  );
}

/** `0 B`, `512 B`, `3.4 KB`, `12.0 MB`. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const capturesWord = (count: number) => (count === 1 ? 'capture' : 'captures');

/** Captures the Windows app saved in its own folder: open the folder, or clear them. */
function SavedCapturesRow({ status }: { status: Status }) {
  const busy = useConnectors((store) => Boolean(store.busy.captures));
  const count = status?.screenshotCaptures?.count ?? 0;
  const bytes = status?.screenshotCaptures?.bytes ?? 0;
  const clear = async () => {
    if (count === 0) return;
    const ok = await confirmDialog({
      title: 'Clear saved captures?',
      description: `This deletes ${count} saved ${capturesWord(count)} from Memoria’s captures folder on this PC. Readings you already saved stay.`,
      confirmLabel: 'Clear captures',
      danger: true,
    });
    if (!ok) return;
    if (await clearScreenshotCaptures())
      setConnectorNotice({ tone: 'ok', text: `Cleared ${count} saved ${capturesWord(count)}.` });
  };
  return (
    <SettingRow
      label="Saved captures"
      hint={
        count === 0 ? (
          'Captures you take with Memoria are saved to their own folder so you can clear them anytime.'
        ) : (
          <>
            <span className="numeral">{count}</span> saved {capturesWord(count)} ·{' '}
            <span className="numeral">{formatBytes(bytes)}</span> in Memoria’s captures folder.
          </>
        )
      }
    >
      <div className="flex flex-wrap justify-end gap-2">
        <Btn className={TOUCH_BUTTON} disabled={busy} onClick={() => void openScreenshotCaptures()}>
          Open folder
        </Btn>
        <Btn className={TOUCH_BUTTON} disabled={busy || count === 0} onClick={() => void clear()}>
          Clear captures
        </Btn>
      </div>
    </SettingRow>
  );
}

function ScreenshotRows({
  runtime,
  status,
}: {
  runtime: 'desktop' | 'android' | 'web';
  status: ReturnType<typeof useConnectors.getState>['status'];
}) {
  const busy = useConnectors((store) => store.busy);
  const fileRef = useRef<HTMLInputElement>(null);
  const canCapture = runtime === 'desktop' && Boolean(window.memoriaDesktop?.connectors?.screenshot.capture);
  const canOpenCaptures = runtime === 'desktop' && Boolean(window.memoriaDesktop?.connectors?.screenshot?.openCaptures);
  const hint =
    runtime === 'desktop'
      ? 'Memoria reads the numbers with Windows’ own text recognition, on this PC. You confirm before anything is saved.'
      : 'Type the numbers beside your screenshot; nothing is read automatically here.';

  return (
    <div className="settings-rows">
      {canCapture && (
        <SettingRow
          label="Read the screen"
          hint="Drag one or more areas on the frozen screen, then press Enter, or press Enter right away for the whole screen. Snip again while the confirmation is open to add more areas. Capture window reads the game in front."
        >
          <div className="flex flex-wrap justify-end gap-2">
            <Btn
              kind="primary"
              className={TOUCH_BUTTON}
              disabled={busy.capture}
              onClick={() => void captureScreenshot('snip')}
            >
              Snip screen
            </Btn>
            <Btn className={TOUCH_BUTTON} disabled={busy.capture} onClick={() => void captureScreenshot('window')}>
              Capture window
            </Btn>
          </div>
        </SettingRow>
      )}
      {canCapture && <ScreenshotShortcutRows status={status} />}
      {canOpenCaptures && <SavedCapturesRow status={status} />}
      <SettingRow label="Read a screenshot" hint={hint}>
        {runtime === 'web' ? (
          <>
            {/* The button takes focus and the click; the file field stays out of the tab order. */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              tabIndex={-1}
              aria-hidden
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void openBrowserScreenshot(file);
              }}
            />
            <Btn className={TOUCH_BUTTON} onClick={() => fileRef.current?.click()}>
              Pick a screenshot…
            </Btn>
          </>
        ) : (
          <Btn className={TOUCH_BUTTON} disabled={busy.screenshot} onClick={() => void pickScreenshotFile()}>
            {runtime === 'desktop' ? 'Read a screenshot…' : 'Pick a screenshot…'}
          </Btn>
        )}
      </SettingRow>
      {runtime === 'android' && (
        <p className="settings-note text-body text-muted">
          You can also share any screenshot from your Gallery straight into Memoria.
        </p>
      )}
      {runtime === 'desktop' && (
        <SettingRow
          label="Watch a screenshot folder"
          hint={
            status?.screenshotWatch.enabled
              ? `Watching ${status.screenshotWatch.folderName ?? 'a folder'}. New screenshots there open for you to confirm.`
              : 'New screenshots saved there open for you to confirm.'
          }
        >
          {status?.screenshotWatch.enabled ? (
            <Btn className={TOUCH_BUTTON} disabled={busy.watch} onClick={() => void clearScreenshotFolder()}>
              Stop watching
            </Btn>
          ) : (
            <Btn className={TOUCH_BUTTON} disabled={busy.watch} onClick={() => void chooseScreenshotFolder()}>
              Watch folder…
            </Btn>
          )}
        </SettingRow>
      )}
    </div>
  );
}
