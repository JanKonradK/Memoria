import { useMemo, useState, type FormEvent } from 'react';
import { DateTime } from 'luxon';
import {
  addPulls,
  GamePitySchema,
  pityRulesFor,
  pityStats,
  presetForGame,
  pullsForFeatured,
  recordFiveStar,
  removeFiveStar,
  trackOf,
  type Game,
  type GamePity,
  type PityFiveStar,
  type PityRule,
  type PityTrack,
} from '@memoria/shared';
import { useApp } from '../store';
import { useElementWidth } from '../hooks';
import { useGround } from '../theme';
import { assignGameInks } from '../game-color';
import { uid } from '../util';
import { rosterGames } from './roster';
import { Btn, Field, GameBadge, NumInput, Segmented, TextInput } from './ui';
import { ChartTip, fmt } from './chart';

/**
 * Pity tracker: one card per account of a game Memoria knows the rules for.
 * The player taps in pulls as they make them and records each 5★; Memoria
 * keeps the count, the 50/50 guarantee and a log of where 5★s landed.
 */

const OUTCOME_LABEL: Record<PityFiveStar['outcome'], string> = {
  won: 'Won the 50/50',
  lost: 'Lost the 50/50',
  guaranteed: 'Featured',
  standard: '5★',
};

export function PityView() {
  const state = useApp((s) => s.state);
  const ground = useGround();
  const games = useMemo(() => rosterGames(state.games), [state.games]);
  const inks = useMemo(() => assignGameInks(games, ground), [games, ground]);
  const tracked = games.filter((game) => pityRulesFor(presetForGame(game)?.key).length > 0);
  const untracked = games.filter((game) => !tracked.includes(game));

  if (tracked.length === 0)
    return (
      <p className="py-8 text-center text-body text-dim">
        Pity tracking covers Genshin Impact, Honkai: Star Rail, Zenless Zone Zero and Wuthering Waves. Add one of them
        to start.
      </p>
    );

  return (
    <div className="savings-list">
      {tracked.map((game) => (
        <PityCard key={game.id} game={game} ink={inks[game.id]!} tz={state.settings.localTz} />
      ))}
      <p className="mt-6 text-caption text-dim">
        Hard pity and 50/50 odds are each game’s published rules. “About” figures use the community-measured soft-pity
        curve, so they are estimates. Memoria does not read your in-game history: record pulls here as you make them.
        {untracked.length > 0 && ` No pity rules yet for ${untracked.map((game) => game.short).join(', ')}.`}
      </p>
    </div>
  );
}

function PityCard({ game, ink, tz }: { game: Game; ink: string; tz: string }) {
  const updateGame = useApp((s) => s.updateGame);
  const rules = pityRulesFor(presetForGame(game)?.key);
  const [error, setError] = useState('');
  const title = game.accountLabel ? `${game.name} · ${game.accountLabel}` : game.name;
  const save = (rule: PityRule, track: PityTrack) => {
    const next: GamePity = { tracks: { ...game.pity?.tracks, [rule.id]: track } };
    const parsed = GamePitySchema.safeParse(next);
    if (!parsed.success) {
      setError('That entry is out of range. Nothing was saved.');
      return;
    }
    setError('');
    updateGame(game.id, { pity: parsed.data });
  };
  return (
    <section className="savings-card" aria-label={title}>
      <h2 className="flex items-center gap-2 text-body font-semibold text-fg">
        <GameBadge short={game.short} color={game.color} color2={game.color2} color3={game.color3} size="sm" />
        {title}
      </h2>
      {error && (
        <p role="alert" className="mt-2 text-meta text-danger-fg">
          {error}
        </p>
      )}
      <div className="pity-tracks mt-3">
        {rules.map((rule) => (
          <PityTrackPanel
            key={rule.id}
            rule={rule}
            track={trackOf(game.pity, rule.id)}
            ink={ink}
            tz={tz}
            onSave={(track) => save(rule, track)}
          />
        ))}
      </div>
    </section>
  );
}

type Panel = 'none' | 'five' | 'edit';

function PityTrackPanel({
  rule,
  track,
  ink,
  tz,
  onSave,
}: {
  rule: PityRule;
  track: PityTrack;
  ink: string;
  tz: string;
  onSave: (track: PityTrack) => void;
}) {
  const [panel, setPanel] = useState<Panel>('none');
  const needed = pullsForFeatured(rule, track);
  const stats = pityStats(track);
  const hasFiftyFifty = rule.featured !== undefined && rule.featured < 1;
  const state =
    rule.featured === undefined
      ? 'Standard banner'
      : rule.featured >= 1
        ? 'Every 5★ is featured'
        : track.guaranteed
          ? 'Next 5★ is the featured one'
          : `${Math.round(rule.featured * 1000) / 10}% chance the next 5★ is featured`;
  const fill = Math.min(1, track.count / rule.hard);
  const target = rule.featured === undefined ? '5★' : 'Featured 5★';

  return (
    <div className="pity-track" aria-label={rule.label} role="group">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-meta font-semibold text-fg-soft">{rule.label}</div>
          <div className={`text-caption ${track.guaranteed ? 'text-fg' : 'text-muted'}`}>{state}</div>
        </div>
        <div className="text-right">
          <div className="text-numeral font-semibold leading-none text-fg tabular-nums">
            {fmt(track.count)}
            <span className="text-meta font-normal text-dim"> / {rule.hard}</span>
          </div>
          <div className="text-caption text-muted">pity</div>
        </div>
      </div>

      <div
        className="pity-meter mt-2"
        role="meter"
        aria-label={`${rule.label} pity`}
        aria-valuemin={0}
        aria-valuemax={rule.hard}
        aria-valuenow={Math.min(track.count, rule.hard)}
      >
        <div className="pity-meter-fill" style={{ width: `${fill * 100}%`, background: ink }} />
        <div className="pity-meter-soft" style={{ left: `${((rule.soft - 1) / rule.hard) * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-caption text-dim tabular-nums">
        <span>
          {track.count >= rule.hard ? (
            <span className="text-warn-fg">Past hard pity. Record the 5★ you got.</span>
          ) : (
            <>
              {target} within <strong className="text-fg-soft">{fmt(needed.worst)}</strong> pulls, about{' '}
              {fmt(needed.typical)}
            </>
          )}
        </span>
        <span>Soft pity {rule.soft}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Btn onClick={() => onSave(addPulls(track, 1))} aria-label={`Add 1 pull to ${rule.label}`}>
          +1
        </Btn>
        <Btn onClick={() => onSave(addPulls(track, 10))} aria-label={`Add 10 pulls to ${rule.label}`}>
          +10
        </Btn>
        <Btn
          kind="primary"
          onClick={() => setPanel(panel === 'five' ? 'none' : 'five')}
          aria-expanded={panel === 'five'}
        >
          Got a 5★
        </Btn>
        <Btn onClick={() => setPanel(panel === 'edit' ? 'none' : 'edit')} aria-expanded={panel === 'edit'}>
          Correct
        </Btn>
      </div>

      {panel === 'five' && (
        <FiveStarForm
          rule={rule}
          track={track}
          hasFiftyFifty={hasFiftyFifty}
          onCancel={() => setPanel('none')}
          onSave={(entry) => {
            onSave(recordFiveStar(track, rule, { id: uid(), at: Date.now(), ...entry }));
            setPanel('none');
          }}
        />
      )}
      {panel === 'edit' && (
        <CorrectForm
          rule={rule}
          track={track}
          hasGuarantee={hasFiftyFifty}
          onCancel={() => setPanel('none')}
          onSave={(next) => {
            onSave(next);
            setPanel('none');
          }}
        />
      )}

      {stats.fiveStars > 0 && (
        <>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-caption text-muted">
            <span>
              <strong className="text-fg tabular-nums">{stats.fiveStars}</strong> 5★ logged
            </span>
            <span>
              Average pity <strong className="text-fg tabular-nums">{stats.averagePity!.toFixed(1)}</strong>
            </span>
            {stats.won + stats.lost > 0 && (
              <span>
                50/50s won{' '}
                <strong className="text-fg tabular-nums">
                  {stats.won} of {stats.won + stats.lost}
                </strong>
              </span>
            )}
          </div>
          <PityLog rule={rule} log={track.log} ink={ink} tz={tz} onRemove={(id) => onSave(removeFiveStar(track, id))} />
        </>
      )}
    </div>
  );
}

function FiveStarForm({
  rule,
  track,
  hasFiftyFifty,
  onSave,
  onCancel,
}: {
  rule: PityRule;
  track: PityTrack;
  hasFiftyFifty: boolean;
  onSave: (entry: { pity: number; won?: boolean; name?: string }) => void;
  onCancel: () => void;
}) {
  // Usually the last pull tapped in; the player can say it came earlier in a ten-pull.
  const [pity, setPity] = useState(String(Math.min(Math.max(track.count, 1), rule.hard)));
  const [result, setResult] = useState<'won' | 'lost'>('won');
  const [name, setName] = useState('');
  const value = Math.floor(Number(pity));
  const valid = Number.isFinite(value) && value >= 1 && value <= rule.hard;
  const asks = hasFiftyFifty && !track.guaranteed;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onSave({ pity: value, name, ...(asks ? { won: result === 'won' } : {}) });
  };
  return (
    <form className="pity-form mt-3 grid grid-cols-1 items-end gap-3 sm:grid-cols-[auto_1fr_auto]" onSubmit={submit}>
      <Field label="On pull">
        <NumInput
          min={1}
          max={rule.hard}
          value={pity}
          onChange={(e) => setPity(e.target.value)}
          className="w-24"
          aria-describedby={`pity-help-${rule.id}`}
        />
      </Field>
      <Field label="Who or what (optional)">
        <TextInput value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      {asks && (
        <div>
          <span className="mb-1 block text-caption text-muted">Was it featured?</span>
          <Segmented<'won' | 'lost'>
            ariaLabel="Was it featured?"
            value={result}
            onChange={setResult}
            options={[
              { value: 'won', label: 'Yes, won' },
              { value: 'lost', label: 'No, lost' },
            ]}
          />
        </div>
      )}
      <p id={`pity-help-${rule.id}`} className="text-caption text-dim sm:col-span-3">
        {track.count > value
          ? `${track.count - value} pulls after it stay counted toward the next 5★.`
          : 'Pity starts again from zero.'}
        {track.guaranteed && ' It was guaranteed to be featured.'}
      </p>
      <div className="flex gap-2 sm:col-span-3">
        <Btn type="submit" kind="primary" disabled={!valid}>
          Record 5★
        </Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
      </div>
    </form>
  );
}

function CorrectForm({
  rule,
  track,
  hasGuarantee,
  onSave,
  onCancel,
}: {
  rule: PityRule;
  track: PityTrack;
  hasGuarantee: boolean;
  onSave: (track: PityTrack) => void;
  onCancel: () => void;
}) {
  const [count, setCount] = useState(String(track.count));
  const [guaranteed, setGuaranteed] = useState(track.guaranteed ? 'yes' : 'no');
  const value = Math.floor(Number(count));
  const valid = Number.isFinite(value) && value >= 0 && value <= rule.hard;
  return (
    <form
      className="pity-form mt-3 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSave({ ...track, count: value, guaranteed: hasGuarantee && guaranteed === 'yes' });
      }}
    >
      <Field label="Pulls since last 5★">
        <NumInput min={0} max={rule.hard} value={count} onChange={(e) => setCount(e.target.value)} className="w-24" />
      </Field>
      {hasGuarantee && (
        <div>
          <span className="mb-1 block text-caption text-muted">Next 5★ guaranteed</span>
          <Segmented
            ariaLabel="Next 5★ guaranteed"
            value={guaranteed}
            onChange={setGuaranteed}
            options={[
              { value: 'no', label: 'No' },
              { value: 'yes', label: 'Yes' },
            ]}
          />
        </div>
      )}
      <Btn type="submit" kind="primary" disabled={!valid}>
        Save
      </Btn>
      <Btn onClick={onCancel}>Cancel</Btn>
    </form>
  );
}

const LOG_HEIGHT = 120;
const LOG_PAD = { top: 10, bottom: 18, left: 28, right: 4 };

/** Each logged 5★ as a bar of the pull it came on, newest on the right. Lost 50/50s are grey. */
function PityLog({
  rule,
  log,
  ink,
  tz,
  onRemove,
}: {
  rule: PityRule;
  log: PityFiveStar[];
  ink: string;
  tz: string;
  onRemove: (id: string) => void;
}) {
  const [ref, width] = useElementWidth();
  const [hover, setHover] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const shown = log.slice(-40);
  const plotW = Math.max(width - LOG_PAD.left - LOG_PAD.right, 1);
  const plotH = LOG_HEIGHT - LOG_PAD.top - LOG_PAD.bottom;
  const slot = plotW / Math.max(shown.length, 8);
  const barW = Math.max(4, Math.min(18, slot - 4));
  const x = (i: number) => LOG_PAD.left + slot * i + (slot - barW) / 2;
  const y = (pity: number) => LOG_PAD.top + plotH - (pity / rule.hard) * plotH;
  const hovered = hover === null ? null : shown[hover];
  const date = (at: number) => DateTime.fromMillis(at, { zone: tz }).toLocaleString(DateTime.DATE_MED);
  const lostAny = shown.some((entry) => entry.outcome === 'lost');

  return (
    <div className="mt-2">
      <div ref={ref} className="history-chart" style={{ height: LOG_HEIGHT }}>
        {width > 0 && (
          <svg width={width} height={LOG_HEIGHT} role="img" aria-label={`Pull each ${rule.label} 5★ came on`}>
            {[rule.soft, rule.hard].map((tick) => (
              <g key={tick}>
                <line x1={LOG_PAD.left} x2={width - LOG_PAD.right} y1={y(tick)} y2={y(tick)} className="history-grid" />
                <text x={LOG_PAD.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" className="history-axis">
                  {tick}
                </text>
              </g>
            ))}
            <line x1={LOG_PAD.left} x2={width - LOG_PAD.right} y1={y(0)} y2={y(0)} className="history-grid" />
            {shown.map((entry, i) => (
              <rect
                key={entry.id}
                x={x(i)}
                y={y(entry.pity)}
                width={barW}
                height={Math.max(1, y(0) - y(entry.pity))}
                rx={Math.min(3, barW / 2)}
                fill={entry.outcome === 'lost' ? 'var(--color-muted)' : ink}
                opacity={hover === null || hover === i ? 1 : 0.55}
              />
            ))}
          </svg>
        )}
        {width > 0 &&
          shown.map((entry, i) => (
            <button
              key={entry.id}
              type="button"
              className="history-hit"
              style={{
                left: x(i) - Math.max(0, (24 - barW) / 2),
                top: LOG_PAD.top,
                width: Math.max(24, barW),
                height: plotH,
              }}
              aria-label={`${entry.name ?? '5★'} on pull ${entry.pity}, ${OUTCOME_LABEL[entry.outcome]}, ${date(entry.at)}`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            />
          ))}
        {hovered && hover !== null && (
          <ChartTip x={x(hover) + barW / 2} y={y(hovered.pity)} width={width}>
            <strong>Pull {hovered.pity}</strong>
            {hovered.name && <span>{hovered.name}</span>}
            <span>
              {OUTCOME_LABEL[hovered.outcome]} · {date(hovered.at)}
            </span>
          </ChartTip>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-caption text-muted">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="history-key-box" style={{ background: ink }} /> Featured
          </span>
          {lostAny && (
            <span className="flex items-center gap-1">
              <span className="history-key-box" style={{ background: 'var(--color-muted)' }} /> Lost 50/50
            </span>
          )}
        </span>
        <button
          type="button"
          className="text-caption text-muted underline"
          onClick={() => setListOpen(!listOpen)}
          aria-expanded={listOpen}
        >
          {listOpen ? 'Hide list' : 'Show list'}
        </button>
      </div>
      {listOpen && (
        <ul className="savings-goals mt-2" aria-label={`${rule.label} 5★ log`}>
          {[...log].reverse().map((entry) => (
            <li key={entry.id} className="savings-goal flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-body text-fg">{entry.name || '5★'}</div>
                <div className="text-caption text-muted tabular-nums">
                  Pull {entry.pity} · {OUTCOME_LABEL[entry.outcome]} · {date(entry.at)}
                </div>
              </div>
              <Btn
                onClick={() => onRemove(entry.id)}
                aria-label={`Remove ${entry.name || '5★'} from ${date(entry.at)}`}
              >
                Remove
              </Btn>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
