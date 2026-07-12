import { useState } from 'react';
import type { AlertType, HoyoKind, HoyoLink } from '@technogg/shared';
import { alertTypeLabel, DEFAULT_THRESHOLDS, HOYO_KIND_LABEL, HOYO_KINDS, HOYO_REGIONS } from '@technogg/shared';
import { useApp } from '../store';
import { getSyncConfig, sendTestPing, setSyncConfig, syncNow } from '../sync';
import { detectHoyoAccounts, refreshHoyolab, useHoyo } from '../hoyolab-client';
import { fmtClock, intOr, minToTimeInput, timeInputToMin } from '../util';
import { Btn, Field, NumInput, SectionTitle, Select, TextArea, TextInput, Toggle } from './ui';

const ALERT_TYPES: AlertType[] = ['energy_cap', 'daily_undone', 'weekly_undone', 'monthly_undone', 'event_end'];

/** Guess which TechnoGG game a HoYoLAB account belongs to, by name. */
const KIND_GUESS: Record<HoyoKind, RegExp> = {
  genshin: /genshin/i,
  hsr: /star rail|honkai|hsr/i,
  zzz: /zenless|zzz/i,
};

function HoyolabSection() {
  const app = useApp();
  const settings = app.state.settings;
  const hoyo = useHoyo();
  const [detectMsg, setDetectMsg] = useState('');
  const games = app.state.games.filter((g) => !g.deleted).sort((a, b) => a.sort - b.sort);
  const links = settings.hoyolabLinks;

  const setLink = (gameId: string, link: HoyoLink | null) => {
    const rest = links.filter((l) => l.gameId !== gameId);
    app.updateSettings({ hoyolabLinks: link ? [...rest, link] : rest });
  };

  const detect = async () => {
    setDetectMsg('Detecting…');
    try {
      const roles = await detectHoyoAccounts(settings.hoyolabCookie);
      const found: string[] = [];
      let next = [...links];
      for (const kind of HOYO_KINDS) {
        const role = roles[kind];
        if (!role) continue;
        const game = games.find((g) => KIND_GUESS[kind].test(g.name));
        found.push(`${HOYO_KIND_LABEL[kind]}: ${role.nickname} (${role.uid})${game ? '' : ' — no matching game'}`);
        if (game) {
          next = [...next.filter((l) => l.gameId !== game.id), { gameId: game.id, kind, uid: role.uid, region: role.region }];
        }
      }
      app.updateSettings({ hoyolabLinks: next });
      setDetectMsg(found.length ? found.join(' · ') : 'No game accounts found on this cookie.');
      if (found.length) void refreshHoyolab();
    } catch (e) {
      setDetectMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const hasToken = (k: string) => new RegExp(`(?:^|[;\\s])${k}=[^;\\s]`).test(settings.hoyolabCookie);
  const tokens = {
    ltoken: hasToken('ltoken_v2') || hasToken('ltoken'),
    ltuid: hasToken('ltuid_v2') || hasToken('ltuid'),
  };
  const cookieReady = tokens.ltoken && tokens.ltuid;

  return (
    <section className="glass gold-hairline rounded-3xl p-5">
      <SectionTitle>HoYoLAB auto-import</SectionTitle>
      <p className="mb-2 text-xs text-slate-400">
        Pulls live energy, dailies, expeditions and weeklies for Genshin / Star Rail / ZZZ — no more manual entry. The
        cookie is stored only in your own synced data.
      </p>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-xs text-slate-300">
        <li>
          Log in at <span className="font-semibold">hoyolab.com</span>, press <span className="font-semibold">F12</span> →{' '}
          <span className="font-semibold">Network</span> tab → reload the page.
        </li>
        <li>
          Click any request to <span className="font-semibold">hoyolab.com</span> → Request Headers → copy the whole{' '}
          <code className="text-slate-200">cookie:</code> value and paste it below.
        </li>
        <li className="text-slate-500">
          (Alternative: F12 → Application → Cookies → hoyolab.com → copy <code>ltoken_v2</code>, <code>ltmid_v2</code>,{' '}
          <code>ltuid_v2</code> and paste as <code>ltoken_v2=…; ltmid_v2=…; ltuid_v2=…</code>. The console trick{' '}
          <code>document.cookie</code> does NOT work — the login token is HttpOnly.)
        </li>
      </ol>
      <div className="space-y-3">
        <Field label="hoyolab.com cookie">
          <TextArea
            placeholder="ltoken_v2=…; ltmid_v2=…; ltuid_v2=…; …"
            value={settings.hoyolabCookie}
            onChange={(e) => app.updateSettings({ hoyolabCookie: e.target.value.trim() })}
          />
        </Field>
        {settings.hoyolabCookie && (
          <p className="text-xs">
            <span className={tokens.ltoken ? 'text-emerald-300' : 'text-rose-300'}>
              {tokens.ltoken ? '✓ ltoken found' : '✗ ltoken_v2 missing'}
            </span>
            {' · '}
            <span className={tokens.ltuid ? 'text-emerald-300' : 'text-rose-300'}>
              {tokens.ltuid ? '✓ ltuid found' : '✗ ltuid_v2 missing'}
            </span>
            {!cookieReady && (
              <span className="text-slate-400"> — copy the full cookie header via the Network tab (step 2 above).</span>
            )}
          </p>
        )}

        <div className="space-y-2">
          {games.map((game) => {
            const link = links.find((l) => l.gameId === game.id);
            return (
              <div key={game.id} className="grid grid-cols-[minmax(0,1fr)_110px_110px_110px] items-center gap-2">
                <span className="truncate text-sm text-slate-200">{game.name}</span>
                <Select
                  value={link?.kind ?? ''}
                  onChange={(e) => {
                    const kind = e.target.value as HoyoKind | '';
                    if (!kind) setLink(game.id, null);
                    else setLink(game.id, { gameId: game.id, kind, uid: link?.uid ?? '', region: HOYO_REGIONS[kind][0]!.region });
                  }}
                  aria-label={`HoYoLAB game for ${game.name}`}
                >
                  <option value="">not linked</option>
                  {HOYO_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {HOYO_KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
                {link ? (
                  <>
                    <TextInput
                      placeholder="UID"
                      value={link.uid}
                      onChange={(e) => setLink(game.id, { ...link, uid: e.target.value.trim() })}
                      aria-label={`UID for ${game.name}`}
                    />
                    <Select
                      value={link.region}
                      onChange={(e) => setLink(game.id, { ...link, region: e.target.value })}
                      aria-label={`Server for ${game.name}`}
                    >
                      {HOYO_REGIONS[link.kind].map((r) => (
                        <option key={r.region} value={r.region}>
                          {r.label}
                        </option>
                      ))}
                    </Select>
                  </>
                ) : (
                  <span className="col-span-2" />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Btn kind="primary" onClick={() => void detect()} disabled={!cookieReady}>
            Detect & link accounts
          </Btn>
          <Btn onClick={() => void refreshHoyolab()} disabled={hoyo.refreshing || links.length === 0}>
            {hoyo.refreshing ? 'Refreshing…' : 'Refresh now'}
          </Btn>
          <span className="text-xs text-slate-400">
            {hoyo.lastError && <span className="text-rose-300">{hoyo.lastError} </span>}
            {hoyo.lastRefreshAt && !hoyo.lastError && `✓ Imported ${fmtClock(hoyo.lastRefreshAt)}`}
          </span>
        </div>
        {detectMsg && <p className="text-xs text-slate-400">{detectMsg}</p>}
        <p className="text-[11px] text-slate-500">
          Refreshes every 5 minutes while the app is open; the sync worker also refreshes every 10 minutes around the
          clock, so alerts fire on live values. Cookies expire after a few months — re-paste when errors appear.
        </p>
      </div>
    </section>
  );
}

export function SettingsPage() {
  const app = useApp();
  const settings = app.state.settings;
  const [syncCfg, setSyncCfgLocal] = useState(getSyncConfig());
  const [pingResult, setPingResult] = useState('');

  const saveSyncCfg = () => {
    setSyncConfig(syncCfg);
    void syncNow();
  };

  const globalRule = (type: AlertType) => app.state.alertRules.find((r) => r.type === type && r.gameId === null && !r.deleted);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(app.state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `technogg-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = (file: File | undefined) => {
    if (!file) return;
    void file.text().then((text) => {
      const ok = app.importJson(text);
      setPingResult(ok ? 'Backup imported (merged).' : 'Import failed — not a valid backup file.');
    });
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-5 pb-28 pt-5">
      <h2 className="mb-3 text-lg font-black tracking-tight text-slate-100">Settings</h2>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className="glass gold-hairline rounded-3xl p-5">
        <SectionTitle>Sync server</SectionTitle>
        <p className="mb-3 text-xs text-slate-400">
          Your deployed Cloudflare Worker. Keeps phone + PC in sync and sends Discord/Telegram alerts even when the app
          is closed.
        </p>
        <div className="space-y-3">
          <Field label="Server URL">
            <TextInput
              placeholder="https://technogg.yourname.workers.dev"
              value={syncCfg.url}
              onChange={(e) => setSyncCfgLocal({ ...syncCfg, url: e.target.value })}
            />
          </Field>
          <Field label="Sync token">
            <TextInput
              type="password"
              placeholder="the SYNC_TOKEN secret you set on the worker"
              value={syncCfg.token}
              onChange={(e) => setSyncCfgLocal({ ...syncCfg, token: e.target.value })}
            />
          </Field>
          <div className="flex items-center gap-3">
            <Btn kind="primary" onClick={saveSyncCfg}>
              Save & sync now
            </Btn>
            <span className="text-xs text-slate-400">
              {app.syncStatus === 'syncing' && 'Syncing…'}
              {app.syncStatus === 'ok' && app.lastSyncAt && `✓ Synced ${fmtClock(app.lastSyncAt)}`}
              {app.syncStatus === 'error' && <span className="text-rose-300">{app.syncError}</span>}
              {app.syncStatus === 'idle' && 'Not configured'}
            </span>
          </div>
        </div>

        </section>

        <HoyolabSection />

        <section className="glass gold-hairline rounded-3xl p-5">
        <SectionTitle>Notifications</SectionTitle>
        <div className="space-y-3">
          <Field label="Discord webhook URL">
            <TextInput
              placeholder="https://discord.com/api/webhooks/…"
              value={settings.discordWebhook}
              onChange={(e) => app.updateSettings({ discordWebhook: e.target.value.trim() })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Telegram bot token">
              <TextInput
                placeholder="123456:ABC-…"
                value={settings.telegramToken}
                onChange={(e) => app.updateSettings({ telegramToken: e.target.value.trim() })}
              />
            </Field>
            <Field label="Telegram chat id">
              <TextInput
                placeholder="e.g. 123456789"
                value={settings.telegramChatId}
                onChange={(e) => app.updateSettings({ telegramChatId: e.target.value.trim() })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quiet hours start">
              <TextInput
                type="time"
                value={minToTimeInput(settings.quietStart)}
                onChange={(e) => app.updateSettings({ quietStart: timeInputToMin(e.target.value) })}
              />
            </Field>
            <Field label="Quiet hours end">
              <TextInput
                type="time"
                value={minToTimeInput(settings.quietEnd)}
                onChange={(e) => app.updateSettings({ quietEnd: timeInputToMin(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="Your timezone (for alert clock times + quiet hours)">
            <div className="flex gap-2">
              <TextInput value={settings.localTz} onChange={(e) => app.updateSettings({ localTz: e.target.value })} />
              <Btn
                className="shrink-0"
                onClick={() => app.updateSettings({ localTz: Intl.DateTimeFormat().resolvedOptions().timeZone })}
              >
                Use device
              </Btn>
            </div>
          </Field>
          <div className="flex items-center gap-3">
            <Btn
              onClick={() => {
                setPingResult('Sending…');
                void sendTestPing().then(setPingResult);
              }}
            >
              Send test ping
            </Btn>
            {pingResult && <span className="text-xs text-slate-400">{pingResult}</span>}
          </div>
        </div>

        </section>

        <section className="glass gold-hairline rounded-3xl p-5">
        <SectionTitle>Alert timing (global defaults)</SectionTitle>
        <div className="space-y-2.5">
          {ALERT_TYPES.map((type) => {
            const rule = globalRule(type);
            const enabled = rule?.enabled ?? true;
            const minutes = rule?.thresholdMinutes ?? DEFAULT_THRESHOLDS[type];
            return (
              <div key={type} className="flex items-center gap-3">
                <Toggle
                  checked={enabled}
                  onChange={(v) => app.upsertRule({ type, gameId: null, enabled: v, thresholdMinutes: minutes })}
                />
                <span className="flex-1 text-sm text-slate-200">{alertTypeLabel(type)}</span>
                <NumInput
                  className="!w-24"
                  value={String(minutes)}
                  onChange={(e) =>
                    app.upsertRule({ type, gameId: null, enabled, thresholdMinutes: Math.max(5, intOr(e.target.value, minutes)) })
                  }
                />
                <span className="w-20 text-[11px] text-slate-500">min before</span>
              </div>
            );
          })}
          <p className="text-[11px] text-slate-500">
            e.g. "Energy nearing cap · 120" pings when a resource is within 2 hours of capping.
          </p>
        </div>

        </section>

        <section className="glass gold-hairline rounded-3xl p-5">
        <SectionTitle>Data</SectionTitle>
        <div className="flex flex-wrap items-center gap-2 pb-1">
          <Btn onClick={exportJson}>Export backup</Btn>
          <label className="cursor-pointer rounded-xl bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 ring-1 ring-white/10 transition hover:bg-white/10">
            Import backup
            <input type="file" accept="application/json" className="hidden" onChange={(e) => importJson(e.target.files?.[0])} />
          </label>
          <span className="text-[11px] text-slate-500">
            {app.state.games.filter((g) => !g.deleted).length} games ·{' '}
            {app.state.events.filter((e) => !e.deleted).length} events
          </span>
        </div>
        </section>
      </div>
    </div>
  );
}
