import { useEffect, useMemo, useState } from 'react';
import {
  PRESETS,
  summarizeVersions,
  VersionHistorySchema,
  versionRows,
  type VersionHistory,
  type VersionRow,
} from '@memoria/shared';
import { useApp } from '../store';
import { useElementWidth } from '../hooks';
import { useGround } from '../theme';
import { assignGameInks } from '../game-color';
import { Page, SectionTitle, Segmented } from './ui';
import { SavingsView } from './Savings';
import { PityView } from './Pity';
import { ChartTip, fmt, Legend, niceMax, shortDate, signed, tickLabel, ticks } from './chart';
import '../history.css';

/**
 * The Pulls page: Savings (can I afford my next banner?) and Version history
 * (what did each version give a free player?). The history file loads only when
 * this page opens, so the timeline never carries years of old patches.
 */

interface GameMeta {
  key: string;
  name: string;
  short: string;
  currency: string;
  pullCost: number | null;
  methodology?: string;
  ink: string;
  rows: VersionRow[];
}

export function useHistory(): { history: VersionHistory | null; error: string } {
  const [result, setResult] = useState<{ history: VersionHistory | null; error: string }>({ history: null, error: '' });
  useEffect(() => {
    let live = true;
    import('../data/feed/history.json')
      .then((module) => {
        const parsed = VersionHistorySchema.safeParse(module.default);
        if (live)
          setResult(
            parsed.success
              ? { history: parsed.data, error: '' }
              : { history: null, error: 'The version history file is damaged.' },
          );
      })
      .catch(() => live && setResult({ history: null, error: 'The version history could not be loaded.' }));
    return () => {
      live = false;
    };
  }, []);
  return result;
}

type PullsView = 'savings' | 'pity' | 'history';

const VIEW_TEXT: Record<PullsView, { title: string; lead: string }> = {
  savings: {
    title: 'Savings',
    lead: 'How many pulls you have, and how many you can expect by each banner you are saving for.',
  },
  pity: {
    title: 'Pity',
    lead: 'Pulls since your last 5★ on each banner, whether the next one is guaranteed, and where past 5★s landed.',
  },
  history: {
    title: 'Version history',
    lead: 'Free premium currency each version gave a player who spends nothing, version by version.',
  },
};

export function PullsPage() {
  const loaded = useHistory();
  const [view, setView] = useState<PullsView>('savings');
  return (
    <Page className="history-page">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold text-fg">{VIEW_TEXT[view].title}</h1>
          <p className="mt-1 text-meta text-muted">{VIEW_TEXT[view].lead}</p>
        </div>
        <Segmented<PullsView>
          ariaLabel="Pulls view"
          value={view}
          onChange={setView}
          options={[
            { value: 'savings', label: 'Savings' },
            { value: 'pity', label: 'Pity' },
            { value: 'history', label: 'Version history' },
          ]}
        />
      </header>
      {loaded.error && <p className="mb-4 text-body text-danger-fg">{loaded.error}</p>}
      {view === 'savings' && <SavingsView history={loaded.history} />}
      {view === 'pity' && <PityView />}
      {view === 'history' && <HistoryView {...loaded} />}
    </Page>
  );
}

function HistoryView({ history, error }: { history: VersionHistory | null; error: string }) {
  const ground = useGround();
  const tracked = useApp((s) => s.state.games);
  const games = useMemo<GameMeta[]>(() => {
    if (!history) return [];
    const keys = Object.keys(history.games).filter((key) => history.versions.some((v) => v.game === key));
    const presets = keys.flatMap((key) => {
      const preset = PRESETS.find((p) => p.key === key);
      return preset ? [preset] : [];
    });
    const inks = assignGameInks(
      presets.map((p) => ({
        id: p.key,
        name: p.name,
        short: p.short,
        presetKey: p.key,
        color: p.color,
        color2: p.color2,
        color3: p.color3,
      })),
      ground,
    );
    return presets.map((preset) => {
      const meta = history.games[preset.key]!;
      return {
        key: preset.key,
        name: preset.name,
        short: preset.short,
        currency: meta.currency,
        pullCost: meta.pullCost,
        methodology: meta.methodology,
        ink: inks[preset.key]!,
        rows: versionRows(history, preset.key),
      };
    });
  }, [history, ground]);

  const yours = useMemo(
    () => new Set(tracked.filter((g) => !g.deleted && g.presetKey).map((g) => g.presetKey!)),
    [tracked],
  );
  const [picked, setPicked] = useState<Set<string> | null>(null);
  // Until the player chooses, show the games they track, or every game when none have history.
  const selected = useMemo(() => {
    if (picked) return picked;
    const own = games.filter((g) => yours.has(g.key)).map((g) => g.key);
    return new Set(own.length ? own : games.map((g) => g.key));
  }, [picked, games, yours]);
  const shown = games.filter((g) => selected.has(g.key));

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };

  return (
    <>
      {!history && !error && <p className="py-8 text-center text-body text-dim">Loading version history…</p>}
      {history && games.length === 0 && (
        <p className="py-8 text-center text-body text-dim">No version history is available yet.</p>
      )}

      {games.length > 0 && (
        <>
          <div className="history-filters mb-5 flex flex-wrap gap-2" role="group" aria-label="Games to show">
            {games.map((game) => (
              <button
                key={game.key}
                type="button"
                aria-pressed={selected.has(game.key)}
                onClick={() => toggle(game.key)}
                className="history-chip min-h-9 rounded-ui-full border px-3 text-meta font-semibold"
              >
                <span aria-hidden className="history-chip-dot" style={{ background: game.ink }} />
                {game.short}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="py-8 text-center text-body text-dim">Choose a game above.</p>
          ) : (
            <>
              <PullsComparison games={shown} />
              {shown.map((game) => (
                <GameHistory key={game.key} game={game} />
              ))}
              <p className="mt-6 text-caption text-dim">
                Totals are community estimates unless marked official, checked {history!.reviewed}. Event and banner
                counts start from {shortDate(history!.archiveSince)}, when Memoria began keeping its feed.
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------ cross-game */

const PAD = { top: 12, right: 64, bottom: 28, left: 40 };

/** Free pulls per version, every selected game on one time axis. Pulls are the one unit all games share. */
function PullsComparison({ games }: { games: GameMeta[] }) {
  const [ref, width] = useElementWidth();
  const [hover, setHover] = useState<{ game: GameMeta; row: VersionRow } | null>(null);
  const series = games
    .filter((g) => g.pullCost)
    .map((g) => ({ game: g, points: g.rows.filter((row) => row.pulls !== null) }))
    .filter((s) => s.points.length > 0);
  if (series.length === 0) return null;

  const height = 240;
  const days = series.flatMap((s) => s.points.map((p) => Date.parse(p.record.start)));
  const [x0, x1] = [Math.min(...days), Math.max(...days)];
  const yMax = niceMax(Math.max(...series.flatMap((s) => s.points.map((p) => p.pulls!))));
  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (day: string) => PAD.left + (x1 === x0 ? plotW / 2 : ((Date.parse(day) - x0) / (x1 - x0)) * plotW);
  const y = (value: number) => PAD.top + plotH - (value / yMax) * plotH;
  const years = [];
  for (let year = new Date(x0).getUTCFullYear() + 1; Date.UTC(year, 0, 1) <= x1; year++) years.push(year);

  return (
    <section className="history-card mb-5" aria-labelledby="history-pulls">
      <SectionTitle level={2}>
        <span id="history-pulls">Free pulls per version</span>
      </SectionTitle>
      <p className="-mt-1 mb-3 text-caption text-dim">
        Each game's free currency divided by the cost of one pull, so games with different currencies compare fairly.
      </p>
      <Legend items={series.map((s) => ({ label: s.game.short, color: s.game.ink, line: true }))} />
      <div ref={ref} className="history-chart" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="Free pulls per version for each selected game">
            {ticks(yMax).map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} className="history-grid" />
                <text x={PAD.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" className="history-axis">
                  {tickLabel(tick, yMax)}
                </text>
              </g>
            ))}
            {years.map((year) => {
              const at = x(`${year}-01-01`);
              return (
                <text key={year} x={at} y={height - 8} textAnchor="middle" className="history-axis">
                  {year}
                </text>
              );
            })}
            {series.map(({ game, points }) => {
              const last = points.at(-1)!;
              return (
                <g key={game.key}>
                  <polyline
                    points={points.map((p) => `${x(p.record.start)},${y(p.pulls!)}`).join(' ')}
                    fill="none"
                    stroke={game.ink}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {points.map((p) => (
                    <circle
                      key={p.record.version}
                      cx={x(p.record.start)}
                      cy={y(p.pulls!)}
                      r={hover?.row === p ? 5.5 : 4}
                      fill={game.ink}
                      className="history-dot"
                    />
                  ))}
                  <text x={x(last.record.start) + 10} y={y(last.pulls!)} dy="0.32em" className="history-label">
                    {game.short}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {width > 0 &&
          series.flatMap(({ game, points }) =>
            points.map((p) => (
              <button
                key={`${game.key}-${p.record.version}`}
                type="button"
                className="history-hit history-hit-dot"
                style={{ left: x(p.record.start) - 12, top: y(p.pulls!) - 12 }}
                aria-label={`${game.short} ${p.record.version}: ${fmt(p.pulls)} free pulls`}
                onPointerEnter={() => setHover({ game, row: p })}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover({ game, row: p })}
                onBlur={() => setHover(null)}
              />
            )),
          )}
        {hover && (
          <ChartTip x={x(hover.row.record.start)} y={y(hover.row.pulls!)} width={width}>
            <strong>{fmt(hover.row.pulls)} pulls</strong>
            <span>
              {hover.game.short} {hover.row.record.version}
              {hover.row.record.title ? ` · ${hover.row.record.title}` : ''}
            </span>
            <span>
              {fmt(hover.row.record.currency.total)} {hover.game.currency}
            </span>
          </ChartTip>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- per game */

function GameHistory({ game }: { game: GameMeta }) {
  const summary = summarizeVersions(game.rows);
  const [table, setTable] = useState(false);
  return (
    <section className="history-card mb-5" aria-labelledby={`history-${game.key}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <SectionTitle level={2}>
          <span id={`history-${game.key}`}>
            <span aria-hidden className="history-chip-dot" style={{ background: game.ink }} />
            {game.name} · {game.currency} per version
          </span>
        </SectionTitle>
      </div>

      <dl className="history-tiles mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Average per version" value={fmt(summary.average)} note={game.currency} />
        <Tile
          label="Average free pulls"
          value={fmt(summary.averagePulls)}
          note={game.pullCost ? `at ${game.pullCost} per pull` : 'pull cost unknown'}
        />
        <Tile
          label={summary.latest ? `Latest, ${summary.latest.record.version}` : 'Latest'}
          value={fmt(summary.latest?.record.currency.total)}
          note={summary.latestVsAverage === null ? undefined : `${signed(summary.latestVsAverage)} vs earlier average`}
        />
        <Tile
          label="Most generous"
          value={summary.best ? summary.best.record.version : '—'}
          note={summary.best ? `${fmt(summary.best.record.currency.total)} ${game.currency}` : undefined}
        />
      </dl>

      <Columns game={game} />

      <button
        type="button"
        className="mt-3 min-h-9 text-meta font-semibold text-accent-fg underline underline-offset-4"
        aria-expanded={table}
        onClick={() => setTable((open) => !open)}
      >
        {table ? 'Hide table' : 'Show table'}
      </button>
      {table && <VersionTable game={game} />}
      {game.methodology && <p className="mt-3 text-caption text-dim">{game.methodology}</p>}
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="history-tile rounded-ui-md px-3 py-2">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="text-heading font-semibold text-fg">{value}</dd>
      {note && <dd className="text-caption text-dim">{note}</dd>}
    </div>
  );
}

const COLUMN_PAD = { top: 16, right: 8, bottom: 30, left: 44 };

/** One column per version. A version without a sourced total keeps its slot and says so. */
function Columns({ game }: { game: GameMeta }) {
  const [ref, width] = useElementWidth();
  const [hover, setHover] = useState<number | null>(null);
  const rows = game.rows;
  const height = 220;
  const yMax = niceMax(Math.max(1, ...rows.map((row) => row.record.currency.total ?? 0)));
  const plotW = Math.max(width - COLUMN_PAD.left - COLUMN_PAD.right, 1);
  const plotH = height - COLUMN_PAD.top - COLUMN_PAD.bottom;
  const slot = plotW / Math.max(rows.length, 1);
  const barW = Math.min(24, Math.max(slot - 2, 2));
  const cx = (i: number) => COLUMN_PAD.left + slot * i + slot / 2;
  const y = (value: number) => COLUMN_PAD.top + plotH - (value / yMax) * plotH;
  // Label every version when there is room, otherwise every second or third one.
  const every = Math.max(1, Math.ceil(34 / slot));
  const hovered = hover === null ? null : rows[hover];

  return (
    <div ref={ref} className="history-chart" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${game.currency} per ${game.name} version`}>
          {ticks(yMax).map((tick) => (
            <g key={tick}>
              <line
                x1={COLUMN_PAD.left}
                x2={width - COLUMN_PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                className="history-grid"
              />
              <text x={COLUMN_PAD.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" className="history-axis">
                {tickLabel(tick, yMax)}
              </text>
            </g>
          ))}
          {rows.map((row, i) => {
            const total = row.record.currency.total;
            const top = total === null ? y(0) : y(total);
            const h = y(0) - top;
            const r = Math.min(4, h, barW / 2);
            const left = cx(i) - barW / 2;
            return (
              <g key={row.record.version} opacity={hover === null || hover === i ? 1 : 0.55}>
                {total === null ? (
                  <line x1={left} x2={left + barW} y1={y(0) - 1} y2={y(0) - 1} className="history-missing" />
                ) : (
                  // Rounded data end, square at the baseline.
                  <path
                    d={`M${left},${y(0)} V${top + r} Q${left},${top} ${left + r},${top} H${left + barW - r} Q${left + barW},${top} ${left + barW},${top + r} V${y(0)} Z`}
                    fill={game.ink}
                  />
                )}
                {i % every === 0 && (
                  <text x={cx(i)} y={height - 10} textAnchor="middle" className="history-axis">
                    {row.record.version}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {width > 0 &&
        rows.map((row, i) => (
          <button
            key={row.record.version}
            type="button"
            className="history-hit"
            style={{ left: COLUMN_PAD.left + slot * i, width: slot, top: COLUMN_PAD.top, height: plotH }}
            aria-label={`${row.record.version}: ${row.record.currency.total === null ? 'no sourced total' : `${fmt(row.record.currency.total)} ${game.currency}`}`}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          />
        ))}
      {hovered && hover !== null && (
        <ChartTip
          x={cx(hover)}
          y={hovered.record.currency.total === null ? y(0) : y(hovered.record.currency.total)}
          width={width}
        >
          <strong>
            {hovered.record.currency.total === null
              ? 'No sourced total'
              : `${fmt(hovered.record.currency.total)} ${game.currency}`}
          </strong>
          <span>
            {hovered.record.version}
            {hovered.record.title ? ` · ${hovered.record.title}` : ''}
          </span>
          {hovered.pulls !== null && <span>{fmt(hovered.pulls)} free pulls</span>}
          <Breakdown row={hovered} />
          {hovered.events !== null && (
            <span>
              {hovered.events} events · {hovered.banners} banners
            </span>
          )}
          {hovered.record.newCharacters.length > 0 && <span>New: {hovered.record.newCharacters.join(', ')}</span>}
        </ChartTip>
      )}
    </div>
  );
}

function Breakdown({ row }: { row: VersionRow }) {
  const { events, daily, endgame, other } = row.record.currency;
  const parts = [
    ['Events', events],
    ['Daily', daily],
    ['Endgame', endgame],
    ['Other', other],
  ].filter((part): part is [string, number] => typeof part[1] === 'number');
  if (!parts.length) return null;
  return <span>{parts.map(([label, value]) => `${label} ${fmt(value)}`).join(' · ')}</span>;
}

function VersionTable({ game }: { game: GameMeta }) {
  return (
    <div className="history-table-wrap mt-3 overflow-x-auto">
      <table className="history-table w-full text-meta">
        <thead>
          <tr>
            <th scope="col">Version</th>
            <th scope="col">Released</th>
            <th scope="col" className="num">
              {game.currency}
            </th>
            <th scope="col" className="num">
              Pulls
            </th>
            <th scope="col" className="num">
              Per day
            </th>
            <th scope="col" className="num">
              Change
            </th>
            <th scope="col" className="num">
              Events
            </th>
            <th scope="col" className="num">
              Banners
            </th>
            <th scope="col">New characters</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {[...game.rows].reverse().map((row) => (
            <tr key={row.record.version}>
              <th scope="row">
                {row.record.version}
                {row.record.title && <span className="block font-normal text-dim">{row.record.title}</span>}
              </th>
              <td>{row.record.start}</td>
              <td className="num">
                {fmt(row.record.currency.total)}
                {row.record.currency.basis === 'official' && <span className="block text-dim">official</span>}
              </td>
              <td className="num">{fmt(row.pulls)}</td>
              <td className="num">{fmt(row.perDay)}</td>
              <td className="num">{signed(row.change)}</td>
              <td className="num">{fmt(row.events)}</td>
              <td className="num">{fmt(row.banners)}</td>
              <td>{row.record.newCharacters.join(', ') || '—'}</td>
              <td>
                {row.record.sources.map((source, index) => (
                  <a
                    key={source.url}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    title={source.label}
                    aria-label={source.label}
                    className="history-source"
                  >
                    {index > 0 && <span aria-hidden> · </span>}
                    {new URL(source.url).hostname.replace(/^www\./, '')}
                  </a>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
