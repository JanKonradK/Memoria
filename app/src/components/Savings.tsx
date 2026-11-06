import { useMemo, useState, type FormEvent } from 'react';
import { DateTime } from 'luxon';
import {
  GameSavingsSchema,
  incomeRange,
  PAID_PASSES,
  paidPerDay,
  type PaidPasses,
  MAX_SAVINGS_GOALS,
  pityRulesFor,
  planGoals,
  presetForGame,
  pullsAt,
  pullsForFeatured,
  ruleForBanner,
  trackOf,
  savedPulls,
  versionRows,
  type Game,
  type GameEvent,
  type GamePity,
  type PityRule,
  type GameSavings,
  type GoalPlan,
  type IncomeRange,
  type VersionHistory,
} from '@memoria/shared';
import { useApp } from '../store';
import { useElementWidth, useNow } from '../hooks';
import { useGround } from '../theme';
import { assignGameInks } from '../game-color';
import { uid } from '../util';
import { rosterGames } from './roster';
import { Btn, Field, GameBadge, NumInput, Segmented, Select, TextInput, Toggle } from './ui';
import { ChartTip, fmt, niceMax, tickLabel, ticks } from './chart';

/**
 * Savings planner: one card per account. The player types in their balance;
 * Memoria shows the pulls on hand and, from recent versions' free income, how
 * many they can expect by each goal. Estimates are always a range.
 */

const DAY = 86_400_000;
/** A typical hard-pity target, the default for a new goal. */
const DEFAULT_TARGET = 90;
/** Every listed game in Version history uses 160 a pull; a custom game can change it. */
const FALLBACK_PULL_COST = 160;
/** Input limits, matching GameSavingsSchema. */
const MAX_AMOUNT = 100_000_000;
const MAX_PULL_COST = 100_000;
const MAX_PER_DAY = 1_000_000;

const STATUS: Record<GoalPlan['status'], { label: (plan: GoalPlan) => string; tone: string }> = {
  covered: { label: () => 'Covered now', tone: 'ok' },
  likely: { label: () => 'On track', tone: 'ok' },
  'at-risk': { label: () => 'Depends on events', tone: 'warn' },
  short: { label: (plan) => `Short by about ${fmt(plan.shortfall)} pulls`, tone: 'danger' },
  past: { label: () => 'Ended', tone: 'muted' },
};

function ago(at: number, now: number): string {
  const days = Math.floor((now - at) / DAY);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

export function SavingsView({ history }: { history: VersionHistory | null }) {
  const state = useApp((s) => s.state);
  const ground = useGround();
  const now = useNow(60_000);
  const games = useMemo(() => rosterGames(state.games), [state.games]);
  const inks = useMemo(() => assignGameInks(games, ground), [games, ground]);
  const banners = useMemo(() => {
    const byGame = new Map<string, GameEvent[]>();
    for (const event of state.events) {
      if (event.deleted || event.type !== 'banner' || event.end <= now) continue;
      byGame.set(event.gameId, [...(byGame.get(event.gameId) ?? []), event]);
    }
    for (const list of byGame.values()) list.sort((a, b) => a.end - b.end);
    return byGame;
  }, [state.events, now]);

  if (games.length === 0)
    return <p className="py-8 text-center text-body text-dim">Add a game to start saving for its banners.</p>;

  return (
    <div className="savings-list">
      {games.map((game) => (
        <SavingsCard
          key={game.id}
          game={game}
          history={history}
          ink={inks[game.id]!}
          banners={banners.get(game.id) ?? []}
          tz={state.settings.localTz}
          now={now}
        />
      ))}
      <p className="mt-6 text-caption text-dim">
        Income is the free currency per day of each game’s last six finished versions, from Version history. It is an
        estimate of what the game gives out, not what you will collect. Enter your balance again whenever you pull or
        top up.
      </p>
    </div>
  );
}

function SavingsCard({
  game,
  history,
  ink,
  banners,
  tz,
  now,
}: {
  game: Game;
  history: VersionHistory | null;
  ink: string;
  banners: GameEvent[];
  tz: string;
  now: number;
}) {
  const updateGame = useApp((s) => s.updateGame);
  // By preset, so an older account saved without a preset key still finds its game.
  const presetKey = presetForGame(game)?.key;
  const meta = presetKey ? history?.games[presetKey] : undefined;
  const rows = useMemo(() => (history && presetKey ? versionRows(history, presetKey) : []), [history, presetKey]);
  const savings = game.savings;
  const currency = meta?.currency ?? 'Currency';
  const pullCost = savings?.pullCost ?? meta?.pullCost ?? FALLBACK_PULL_COST;
  const today = DateTime.fromMillis(now, { zone: tz }).toISODate() ?? '';
  const passes = presetKey ? PAID_PASSES[presetKey] : undefined;
  const paid = paidPerDay(savings, passes, pullCost);
  const income = useMemo(() => incomeRange(rows, today, savings?.perDay, paid), [rows, today, savings?.perDay, paid]);
  const [error, setError] = useState('');
  // Checked here, not just by the inputs: a value out of range must say so, not throw.
  const save = (next: GameSavings) => {
    const parsed = GameSavingsSchema.safeParse(next);
    if (!parsed.success) {
      setError('One of those numbers is out of range. Nothing was saved.');
      return;
    }
    setError('');
    updateGame(game.id, { savings: parsed.data });
  };
  const title = game.accountLabel ? `${game.name} · ${game.accountLabel}` : game.name;

  if (!savings) {
    return (
      <section className="savings-card flex flex-wrap items-center justify-between gap-3" aria-label={title}>
        <h2 className="flex items-center gap-2 text-body font-semibold text-fg">
          <GameBadge short={game.short} color={game.color} color2={game.color2} color3={game.color3} size="sm" />
          {title}
        </h2>
        <Btn onClick={() => save({ currency: 0, tickets: 0, takenAt: Date.now(), participation: 1, goals: [] })}>
          Start saving
        </Btn>
      </section>
    );
  }

  const plans = planGoals(savings, income, pullCost, now);
  const onHand = savedPulls(savings, pullCost);

  return (
    <section className="savings-card" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 text-body font-semibold text-fg">
          <GameBadge short={game.short} color={game.color} color2={game.color2} color3={game.color3} size="sm" />
          {title}
        </h2>
        <div className="text-right">
          <div className="text-numeral font-semibold leading-none text-fg tabular-nums">{fmt(onHand)}</div>
          <div className="text-caption text-muted">pulls saved</div>
        </div>
      </div>

      <BalanceForm
        key={savings.takenAt}
        savings={savings}
        currency={currency}
        customCost={!meta?.pullCost}
        pullCost={pullCost}
        onSave={save}
        entered={ago(savings.takenAt, now)}
      />

      {error && (
        <p role="alert" className="mt-2 text-meta text-danger-fg">
          {error}
        </p>
      )}

      <Income savings={savings} income={income} currency={currency} passes={passes} onSave={save} />

      {plans.length > 0 && (
        <>
          <SavingsChart
            savings={savings}
            income={income}
            plans={plans}
            pullCost={pullCost}
            ink={ink}
            tz={tz}
            now={now}
          />
          <ul className="savings-goals mt-2" aria-label="Goals">
            {plans.map((plan) => (
              <GoalRow
                key={plan.goal.id}
                plan={plan}
                tz={tz}
                onRemove={() => save({ ...savings, goals: savings.goals.filter((goal) => goal.id !== plan.goal.id) })}
              />
            ))}
          </ul>
        </>
      )}

      {savings.goals.length < MAX_SAVINGS_GOALS && (
        <AddGoal
          banners={banners.filter((banner) => !savings.goals.some((goal) => goal.eventId === banner.id))}
          pityRules={pityRulesFor(presetKey)}
          pity={game.pity}
          tz={tz}
          onAdd={(goal) => save({ ...savings, goals: [...savings.goals, goal] })}
        />
      )}

      <div className="mt-3 flex justify-end">
        <Btn onClick={() => updateGame(game.id, { savings: undefined })}>Stop saving</Btn>
      </div>
    </section>
  );
}

function BalanceForm({
  savings,
  currency,
  customCost,
  pullCost,
  entered,
  onSave,
}: {
  savings: GameSavings;
  currency: string;
  customCost: boolean;
  pullCost: number;
  entered: string;
  onSave: (next: GameSavings) => void;
}) {
  const [amount, setAmount] = useState(String(savings.currency));
  const [tickets, setTickets] = useState(String(savings.tickets));
  const [cost, setCost] = useState(String(pullCost));
  const whole = (value: string) => Math.max(0, Math.floor(Number(value) || 0));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({
      ...savings,
      currency: whole(amount),
      tickets: whole(tickets),
      takenAt: Date.now(),
      ...(customCost && whole(cost) > 0 ? { pullCost: whole(cost) } : {}),
    });
  };
  return (
    <form className="savings-balance mt-3 grid grid-cols-2 items-end gap-3 sm:grid-cols-4" onSubmit={submit}>
      <Field label={currency}>
        <NumInput min={0} max={MAX_AMOUNT} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Pull tickets">
        <NumInput min={0} max={MAX_AMOUNT} value={tickets} onChange={(e) => setTickets(e.target.value)} />
      </Field>
      {customCost && (
        <Field label="Cost of one pull">
          <NumInput min={1} max={MAX_PULL_COST} value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
      )}
      <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
        <Btn type="submit" kind="primary">
          Save balance
        </Btn>
        <span className="text-caption text-dim">Entered {entered}</span>
      </div>
    </form>
  );
}

const PARTICIPATION = [
  { value: '1', label: 'Everything' },
  { value: '0.75', label: 'Most' },
  { value: '0.5', label: 'Half' },
];

function Income({
  savings,
  income,
  currency,
  passes,
  onSave,
}: {
  savings: GameSavings;
  income: IncomeRange;
  currency: string;
  passes?: PaidPasses;
  onSave: (next: GameSavings) => void;
}) {
  const [perDay, setPerDay] = useState(String(savings.perDay ?? ''));
  const share = String(savings.participation);
  return (
    <div className="savings-income mt-4 flex flex-wrap items-end justify-between gap-3">
      <div className="text-meta text-muted">
        {income.source === 'history' && (
          <>
            About <strong className="text-fg">{fmt(Math.round(income.mid * savings.participation))}</strong> {currency}{' '}
            a day, between {fmt(Math.round(income.low * savings.participation))} and{' '}
            {fmt(Math.round(income.high * savings.participation))}, from versions {income.versions[0]}–
            {income.versions.at(-1)}.
          </>
        )}
        {income.paid > 0 && (
          <p className="mt-1">
            Plus <strong className="text-fg">{fmt(Math.round(income.paid))}</strong> a day from passes you buy.
          </p>
        )}
        {income.source !== 'history' && (
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = Number(perDay);
              onSave({ ...savings, perDay: Number.isFinite(value) && value >= 0 ? value : undefined });
            }}
          >
            <Field label={`Free ${currency} per day`}>
              <NumInput
                min={0}
                max={MAX_PER_DAY}
                value={perDay}
                placeholder="No history yet"
                onChange={(e) => setPerDay(e.target.value)}
              />
            </Field>
            <Btn type="submit">Save</Btn>
          </form>
        )}
      </div>
      {passes && (
        <fieldset className="savings-passes">
          <legend className="mb-1 block text-caption text-muted">You buy</legend>
          <Toggle
            className="text-meta"
            label={`${passes.monthly.name}, every month`}
            checked={Boolean(savings.monthlyPass)}
            onChange={(on) => onSave({ ...savings, monthlyPass: on || undefined })}
          />
          <Toggle
            className="text-meta"
            label={`${passes.battle.name}, every version`}
            checked={Boolean(savings.battlePass)}
            onChange={(on) => onSave({ ...savings, battlePass: on || undefined })}
          />
        </fieldset>
      )}
      <div>
        <span className="mb-1 block text-caption text-muted">Free content you do</span>
        <Segmented
          ariaLabel="Free content you do"
          value={PARTICIPATION.some((option) => option.value === share) ? share : '1'}
          onChange={(value) => onSave({ ...savings, participation: Number(value) })}
          options={PARTICIPATION}
        />
      </div>
    </div>
  );
}

function GoalRow({ plan, tz, onRemove }: { plan: GoalPlan; tz: string; onRemove: () => void }) {
  const status = STATUS[plan.status];
  const date = DateTime.fromMillis(plan.goal.deadline, { zone: tz }).toLocaleString(DateTime.DATE_MED);
  const reached =
    plan.status !== 'covered' && plan.status !== 'past' && plan.reachedAt
      ? DateTime.fromMillis(plan.reachedAt, { zone: tz }).toLocaleString(DateTime.DATE_MED)
      : null;
  return (
    <li className="savings-goal flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
      <div className="min-w-0">
        <div className="truncate text-body font-semibold text-fg">{plan.goal.label}</div>
        <div className="text-caption text-muted">
          {fmt(plan.goal.targetPulls)} pulls by {date}
          {plan.needed > plan.goal.targetPulls && ` · ${fmt(plan.needed)} with earlier goals`}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className={`savings-status savings-status-${status.tone} text-meta font-semibold`}>
            <span aria-hidden className="savings-status-dot" />
            {status.label(plan)}
          </div>
          {plan.status !== 'past' && (
            <div className="text-caption text-dim tabular-nums">
              Expect {fmt(plan.expected.low)}–{fmt(plan.expected.high)} pulls
              {reached && `, ${fmt(plan.needed)} around ${reached}`}
            </div>
          )}
        </div>
        <Btn onClick={onRemove} aria-label={`Remove ${plan.goal.label}`}>
          Remove
        </Btn>
      </div>
    </li>
  );
}

function AddGoal({
  banners,
  pityRules,
  pity,
  tz,
  onAdd,
}: {
  banners: GameEvent[];
  pityRules: readonly PityRule[];
  pity: GamePity | undefined;
  tz: string;
  onAdd: (goal: GameSavings['goals'][number]) => void;
}) {
  const [bannerId, setBannerId] = useState('');
  const [label, setLabel] = useState('');
  const [date, setDate] = useState('');
  const [target, setTarget] = useState(String(DEFAULT_TARGET));
  const banner = banners.find((b) => b.id === bannerId);
  // From the pity tracker: pulls for this banner's featured 5★ from where the player stands.
  const pityFor = (event: GameEvent | undefined) => {
    const rule = ruleForBanner(pityRules, event?.bannerKind);
    return rule ? pullsForFeatured(rule, trackOf(pity, rule.id)) : null;
  };
  const fromPity = pityFor(banner);
  const deadline = banner ? banner.end : date ? DateTime.fromISO(date, { zone: tz }).endOf('day').toMillis() : NaN;
  const pulls = Math.floor(Number(target));
  const name = (banner ? banner.name : label).trim();
  const ready = Number.isFinite(deadline) && pulls >= 1 && name.length > 0;

  return (
    <form
      className="savings-add mt-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-[2fr_1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        onAdd({
          id: uid(),
          label: name.slice(0, 200),
          targetPulls: Math.min(pulls, 10_000),
          deadline,
          ...(banner ? { eventId: banner.id } : {}),
        });
        setBannerId('');
        setLabel('');
        setDate('');
      }}
    >
      {banners.length > 0 && (
        <Field label="Save for" className="sm:col-span-3">
          <Select
            value={bannerId}
            onChange={(e) => {
              setBannerId(e.target.value);
              const needed = pityFor(banners.find((b) => b.id === e.target.value));
              if (needed) setTarget(String(needed.worst));
            }}
            aria-label="Save for"
          >
            <option value="">A date of my own</option>
            {banners.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} · ends {DateTime.fromMillis(b.end, { zone: tz }).toLocaleString(DateTime.DATE_MED)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {!banner && (
        <>
          <Field label="Goal">
            <TextInput
              value={label}
              maxLength={200}
              placeholder="Next limited banner"
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field label="By">
            <TextInput type="date" max="2099-12-31" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </>
      )}
      <div className={`flex items-end gap-2 ${banner ? 'sm:col-span-3' : ''}`}>
        <Field label="Pulls">
          <NumInput min={1} max={10_000} value={target} onChange={(e) => setTarget(e.target.value)} className="w-24" />
        </Field>
        <Btn type="submit" kind="primary" disabled={!ready}>
          Add goal
        </Btn>
      </div>
      {fromPity && (
        <div className="flex flex-wrap items-center gap-2 text-caption text-muted sm:col-span-3">
          <span>From your pity:</span>
          <Btn onClick={() => setTarget(String(fromPity.worst))} aria-pressed={target === String(fromPity.worst)}>
            Guaranteed · {fmt(fromPity.worst)}
          </Btn>
          <Btn onClick={() => setTarget(String(fromPity.typical))} aria-pressed={target === String(fromPity.typical)}>
            Typical · {fmt(fromPity.typical)}
          </Btn>
        </div>
      )}
    </form>
  );
}

const PAD = { top: 12, right: 12, bottom: 26, left: 40 };

/** Expected pulls from today to the last goal: the middle income as a line, the range as a wash. */
function SavingsChart({
  savings,
  income,
  plans,
  pullCost,
  ink,
  tz,
  now,
}: {
  savings: GameSavings;
  income: IncomeRange;
  plans: GoalPlan[];
  pullCost: number;
  ink: string;
  tz: string;
  now: number;
}) {
  const [ref, width] = useElementWidth();
  const [hover, setHover] = useState<number | null>(null);
  const future = plans.filter((plan) => plan.status !== 'past');
  if (future.length === 0) return null;
  const height = 180;
  const start = Math.min(now, Math.max(savings.takenAt, now - 7 * DAY));
  // A little room past the last goal so its marker is not pinned to the edge.
  const lastGoal = Math.max(...future.map((plan) => plan.goal.deadline), start + 14 * DAY);
  const end = lastGoal + (lastGoal - start) * 0.06;
  const steps = 48;
  const at = (i: number) => start + ((end - start) * i) / steps;
  const series = (perDay: number) =>
    Array.from({ length: steps + 1 }, (_, i) => pullsAt(savings, perDay, pullCost, at(i), income.paid));
  const [low, mid, high] = [series(income.low), series(income.mid), series(income.high)];
  const yMax = niceMax(Math.max(...high, ...future.map((plan) => plan.needed)) * 1.05);
  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + ((t - start) / (end - start)) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;
  const path = (values: number[]) => values.map((v, i) => `${i ? 'L' : 'M'}${x(at(i))},${y(v)}`).join(' ');
  const band = `${path(high)} ${low
    .map((v, i) => [v, i] as const)
    .reverse()
    .map(([v, i]) => `L${x(at(i))},${y(v)}`)
    .join(' ')} Z`;
  // At most about eight labels, however far the last goal is.
  const spanMonths = (end - start) / (30 * DAY);
  const every = [1, 2, 3, 6, 12, 24, 60, 120].find((step) => spanMonths / step <= 8) ?? Math.ceil(spanMonths / 8);
  const months: number[] = [];
  for (
    let m = DateTime.fromMillis(start, { zone: tz }).startOf('month').plus({ months: 1 });
    m.toMillis() < end && months.length < 24;
    m = m.plus({ months: every })
  )
    months.push(m.toMillis());
  const hovered = hover === null ? null : future[hover];

  return (
    <div ref={ref} className="history-chart mt-4" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Expected pulls up to your last goal">
          {ticks(yMax).map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} className="history-grid" />
              <text x={PAD.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" className="history-axis">
                {tickLabel(tick, yMax)}
              </text>
            </g>
          ))}
          {months.map((month) => (
            <text key={month} x={x(month)} y={height - 8} textAnchor="middle" className="history-axis">
              {DateTime.fromMillis(month, { zone: tz }).toFormat(every >= 12 ? 'yyyy' : 'LLL')}
            </text>
          ))}
          <path d={band} fill={ink} opacity={0.12} />
          <path d={path(mid)} fill="none" stroke={ink} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <line x1={x(now)} x2={x(now)} y1={PAD.top} y2={PAD.top + plotH} className="savings-now" />
          {future.map((plan, i) => (
            <g key={plan.goal.id}>
              <line
                x1={x(plan.goal.deadline) - 10}
                x2={x(plan.goal.deadline) + 10}
                y1={y(plan.needed)}
                y2={y(plan.needed)}
                className="savings-target"
              />
              <circle
                cx={x(plan.goal.deadline)}
                cy={y(plan.needed)}
                r={hover === i ? 5.5 : 4}
                className="savings-target-dot"
              />
            </g>
          ))}
        </svg>
      )}
      {width > 0 &&
        future.map((plan, i) => (
          <button
            key={plan.goal.id}
            type="button"
            className="history-hit history-hit-dot"
            style={{ left: x(plan.goal.deadline) - 12, top: y(plan.needed) - 12 }}
            aria-label={`${plan.goal.label}: needs ${plan.needed} pulls, expect ${plan.expected.low} to ${plan.expected.high}`}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          />
        ))}
      {hovered && hover !== null && (
        <ChartTip x={x(hovered.goal.deadline)} y={y(hovered.needed)} width={width}>
          <strong>{fmt(hovered.needed)} pulls needed</strong>
          <span>{hovered.goal.label}</span>
          <span>
            Expect {fmt(hovered.expected.low)}–{fmt(hovered.expected.high)}, most likely {fmt(hovered.expected.mid)}
          </span>
        </ChartTip>
      )}
    </div>
  );
}
