import type { Game, Purchase } from '@technogg/shared';
import { dailyHeatmap, dailyStreak, gameWaste, projectWallet } from '@technogg/shared';
import { useState } from 'react';
import { useApp } from '../store';
import { fmtDateTimeLocalInput, fmtDur, intOr, parseDateTimeLocalInput, tint } from '../util';
import { Btn, Field, NumInput, SectionTitle, TextInput, Toggle } from './ui';
import { Heatmap } from './Heatmap';
import { ResourceIcon } from './ResourceIcon';
import { FocusEditor, TeamsEditor } from './FocusTeams';

const DAY = 86_400_000;

function PurchaseRow({ p, color, now }: { p: Purchase; color: string; now: number }) {
  const app = useApp();
  const left = p.expiresAt - now;
  const lapsed = left <= 0;
  const urgentCls = lapsed || left < 2 * DAY ? 'text-rose-300' : left < 7 * DAY ? 'text-amber-300' : 'text-slate-300';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/5">
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-200">{p.name}</span>
      <span className={`text-xs font-bold tabular-nums ${urgentCls}`}>
        {lapsed ? `expired ${fmtDur(-left)} ago` : `${fmtDur(left)} left`}
      </span>
      <span className="text-[11px] text-slate-500">every {p.cycleDays}d</span>
      <Toggle checked={p.notify} onChange={(v) => app.updatePurchase(p.id, { notify: v })} label="ping" />
      <Btn className="!px-3 !py-1 text-xs" onClick={() => app.renewPurchase(p.id)}>
        Renewed ✓
      </Btn>
      <button
        type="button"
        onClick={() => app.deletePurchase(p.id)}
        className="text-slate-500 transition hover:text-rose-400"
        aria-label={`Delete ${p.name}`}
      >
        ✕
      </button>
    </div>
  );
}

function GameStats({ game, now }: { game: Game; now: number }) {
  const app = useApp();
  const state = app.state;
  const [customName, setCustomName] = useState('');
  const [customDays, setCustomDays] = useState('30');

  const wallet = state.wallets.find((w) => w.id === game.id && !w.deleted);
  const purchases = state.purchases.filter((p) => p.gameId === game.id && !p.deleted).sort((a, b) => a.expiresAt - b.expiresAt);
  const proj = wallet ? projectWallet(wallet, now) : null;
  const waste7 = gameWaste(state, game, 7 * DAY, now);
  const streak = dailyStreak(state, game, now);
  const heat = dailyHeatmap(state, game, 84, now);
  const patchDaysLeft = proj?.daysToPatch != null ? Math.ceil(proj.daysToPatch) : null;

  return (
    <section
      className="rounded-3xl p-5"
      style={{
        background: `linear-gradient(155deg, ${tint(game.color, 0.14)} 0%, transparent 45%), #07060c`,
        boxShadow: `inset 0 0 0 1px ${tint(game.color, 0.28)}, 0 0 44px -20px ${tint(game.color, 0.45)}`,
      }}
    >
      <h2
        className="mb-3 text-xl font-black tracking-tight text-slate-50"
        style={{ textShadow: `0 0 20px ${tint(game.color, 0.5)}` }}
      >
        {game.name}
      </h2>

      <SectionTitle>Premium currency</SectionTitle>
      {wallet ? (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Field label="Balance now">
              <NumInput
                value={String(wallet.balance)}
                onChange={(e) =>
                  app.upsertWallet(game.id, { balance: Math.max(0, intOr(e.target.value, wallet.balance)), balanceAt: Date.now() })
                }
              />
            </Field>
            <Field label="Income / day">
              <NumInput
                value={String(wallet.dailyIncome)}
                onChange={(e) => app.upsertWallet(game.id, { dailyIncome: Math.max(0, intOr(e.target.value, wallet.dailyIncome)) })}
              />
            </Field>
            <Field label="Pull cost">
              <NumInput
                value={String(wallet.pullCost)}
                onChange={(e) => app.upsertWallet(game.id, { pullCost: Math.max(0, intOr(e.target.value, wallet.pullCost)) })}
              />
            </Field>
            <Field label="Current patch ends">
              <TextInput
                type="datetime-local"
                value={wallet.nextPatchAt != null ? fmtDateTimeLocalInput(wallet.nextPatchAt) : ''}
                onChange={(e) => app.upsertWallet(game.id, { nextPatchAt: parseDateTimeLocalInput(e.target.value) })}
              />
            </Field>
            <Field label="Patch length (d)">
              <NumInput
                value={String(wallet.patchDays)}
                onChange={(e) => app.upsertWallet(game.id, { patchDays: Math.max(0, intOr(e.target.value, wallet.patchDays)) })}
              />
            </Field>
          </div>
          {proj && (
            <p className="text-sm text-slate-300">
              Now ≈{' '}
              <span className="font-black tabular-nums" style={{ color: game.color }}>
                {proj.current.toLocaleString()}
              </span>
              {proj.atPatch != null && patchDaysLeft != null && (
                <>
                  {' '}
                  · at next patch (<span className="tabular-nums">{patchDaysLeft}d</span>) ≈{' '}
                  <span className="font-black tabular-nums" style={{ color: game.color }}>
                    {proj.atPatch.toLocaleString()}
                  </span>{' '}
                  → <span className="font-black tabular-nums text-amber-200">{proj.pullsAtPatch}</span> pulls
                </>
              )}
              {proj.atPatch == null && <span className="text-slate-500"> — set the next patch date for a projection</span>}
            </p>
          )}
          <p className="text-[11px] text-slate-500">
            "Current patch ends" is the same moment the next one starts — it rolls forward by the patch length on its own.
            Income/day should include Welkin/BP drip while active. Re-enter the balance whenever you pull — projections
            restart from your last entry.
          </p>
        </div>
      ) : (
        <Btn onClick={() => app.upsertWallet(game.id, {})}>Start tracking currency</Btn>
      )}

      <SectionTitle>Purchases</SectionTitle>
      <div className="space-y-2">
        {purchases.map((p) => (
          <PurchaseRow key={p.id} p={p} color={game.color} now={now} />
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Btn className="!px-3 !py-1.5 text-xs" onClick={() => app.addPurchase(game.id, 'Welkin / Monthly card', 30)}>
            + Monthly card (30d)
          </Btn>
          <Btn
            className="!px-3 !py-1.5 text-xs"
            onClick={() => app.addPurchase(game.id, 'Battle Pass', Math.max(1, wallet?.patchDays ?? 42))}
          >
            + Battle Pass (patch)
          </Btn>
          <TextInput
            className="!w-36"
            placeholder="Custom…"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
          />
          <NumInput className="!w-16" value={customDays} onChange={(e) => setCustomDays(e.target.value.replace(/[^\d]/g, ''))} />
          <Btn
            className="!px-3 !py-1.5 text-xs"
            onClick={() => {
              if (!customName.trim()) return;
              app.addPurchase(game.id, customName.trim(), Math.max(1, intOr(customDays, 30)));
              setCustomName('');
            }}
          >
            + Add
          </Btn>
        </div>
        <p className="text-[11px] text-slate-500">
          "Renewed ✓" pushes the expiry one cycle out. Expiring purchases warn on the game card and ping via alerts 48h before.
        </p>
      </div>

      <SectionTitle>Focus — what to build next</SectionTitle>
      <FocusEditor gameId={game.id} />

      <SectionTitle>Teams</SectionTitle>
      <TeamsEditor gameId={game.id} />

      <SectionTitle>Habits & waste</SectionTitle>
      <div className="space-y-2">
        {waste7.map(({ res, wasted }) => (
          <div key={res.id} className="flex items-center gap-2 text-xs text-slate-300">
            <ResourceIcon iconKey={res.icon} color={game.color} size={13} />
            <span className="text-slate-400">{res.name} wasted at cap, 7d:</span>
            <span className={`font-bold tabular-nums ${wasted > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{wasted}</span>
          </div>
        ))}
        {heat.some((h) => h.total > 0) && (
          <div>
            <div className="mb-1.5 text-xs text-slate-400">
              Dailies, last 12 weeks
              {streak >= 2 && <span className="ml-2 font-bold text-amber-200">🔥 {streak}-day streak</span>}
            </div>
            <Heatmap days={heat} color={game.color} />
          </div>
        )}
      </div>
    </section>
  );
}

export function StatsPage({ now }: { now: number }) {
  const state = useApp((s) => s.state);
  const games = state.games.filter((g) => !g.deleted).sort((a, b) => a.sort - b.sort);

  return (
    <div className="mx-auto w-full max-w-7xl px-5 pb-28 pt-5">
      <h2 className="mb-3 text-lg font-black tracking-tight text-slate-100">Stats & spending</h2>
      {games.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-500">Add a game first — stats live here once you have one.</p>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {games.map((g) => (
            <GameStats key={g.id} game={g} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
