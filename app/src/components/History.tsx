import { useEffect, useMemo, useState } from 'react';
import {
  PRESETS,
  presetForGame,
  summarizeVersions,
  VersionHistorySchema,
  versionRows,
  type VersionHistory,
  type VersionRow,
  type Game,
} from '@memoria/shared';
import { useApp } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { useElementWidth, useNow } from '../hooks';
import { useGround } from '../theme';
import { assignGameInks } from '../game-color';
import { SectionTitle, Tooltip } from './ui';
import { GameSavingsPanel, useOpenBanners } from './Savings';
import { GamePityPanel } from './Pity';
import { rosterGames } from './roster';
import { ChartTip, fmt, Legend, niceMax, shortDate, signed, spreadLabels, tickLabel, ticks } from './chart';
import { VERSION_HISTORY_GAMES } from './game-tabs/availability';
import '../history.css';

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

/** Each game's archived events, one chunk per game, so no single file outgrows the bundle budget. */
const archives = import.meta.glob<{ default: unknown[] }>('../data/feed/archive/*.json');

export function useHistory(): { history: VersionHistory | null; error: string } {
  const [result, setResult] = useState<{ history: VersionHistory | null; error: string }>({ history: null, error: '' });
  useEffect(() => {
    let live = true;
    Promise.all([import('../data/feed/history.json'), ...Object.values(archives).map((load) => load())])
      .then(([module, ...games]) => {
        const archive = games.flatMap((game) => (Array.isArray(game.default) ? game.default : []));
        const parsed = VersionHistorySchema.safeParse({ ...module.default, archive });
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

/**
 * A game's Pulls tab: its savings and its pity side by side, then what each of
 * its versions gave a free player, with other games beside it for comparison.
 * The history file loads only when this tab opens, so the timeline never
 * carries years of old patches.
 */
export function GamePullsView({ game }: { game: Game }) {
  const loaded = useHistory();
  const state = useApp(useShallow((s) => ({ games: s.state.games, settings: s.state.settings })));
  const ground = useGround();
  const now = useNow(60_000);
  const games = useMemo(() => rosterGames(state.games), [state.games]);
  const inks = useMemo(() => assignGameInks(games, ground), [games, ground]);
  const banners = useOpenBanners(now);
  const preset = game.presetKey ?? presetForGame(game)?.key;
  const ink = inks[game.id] ?? game.color;
  const title = game.accountLabel ? `${game.name} · ${game.accountLabel}` : game.name;

  return (
    <div className="history-page">
      {loaded.error && <p className="mb-4 text-body text-danger-fg">{loaded.error}</p>}
      <section className="pulls-game" aria-label={title}>
        <div className="pulls-game-grid">
          <GameSavingsPanel
            game={game}
            history={loaded.history}
            ink={ink}
            banners={banners.get(game.id) ?? []}
            tz={state.settings.localTz}
            now={now}
          />
          <GamePityPanel game={game} ink={ink} tz={state.settings.localTz} />
        </div>
        <details className="pulls-about mt-6">
          <summary>About free income</summary>
          <p>
            The currency per day of the game’s last six finished versions, from Version history: what the game gives
            out, not what you will collect. Enter your balance again whenever you pull or top up.
          </p>
        </details>
      </section>
      {preset && VERSION_HISTORY_GAMES.includes(preset) && (
        <section className="mt-10" aria-labelledby="pulls-version-history">
          <h2 id="pulls-version-history" className="tab-label">
            Version history
          </h2>
          <p className="mb-5 max-w-3xl text-meta text-muted">
            Free currency per version, for a player who spends nothing.
          </p>
          <HistoryView {...loaded} focus={preset} />
        </section>
      )}
    </div>
  );
}

function HistoryView({ history, error, focus }: { history: VersionHistory | null; error: string; focus: string }) {
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
  // Until the player chooses, compare this game with the others they track.
  const selected = useMemo(() => {
    if (picked) return picked;
    return new Set(games.filter((g) => g.key === focus || yours.has(g.key)).map((g) => g.key));
  }, [picked, games, yours, focus]);
  const own = games.find((g) => g.key === focus);
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
      {history && !own && <p className="py-8 text-center text-body text-dim">No version history is available yet.</p>}

      {own && <GameHistory game={own} />}

      {own && games.length > 1 && (
        <section className="mt-8" aria-labelledby="history-compare">
          <h3 id="history-compare" className="tab-label">
            Compare games
          </h3>
          <div className="history-filters mb-5 mt-3 flex flex-wrap gap-2" role="group" aria-label="Games to show">
            {games.map((game) => (
              <button
                key={game.key}
                type="button"
                aria-pressed={selected.has(game.key)}
                onClick={() => toggle(game.key)}
                className="history-chip min-h-11 rounded-ui-full border px-3 text-meta font-semibold fine:min-h-9"
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
              {shown
                .filter((game) => game.key !== focus)
                .map((game) => (
                  <GameHistory key={game.key} game={game} />
                ))}
            </>
          )}
        </section>
      )}

      {own && (
        <details className="pulls-about mt-6">
          <summary>About these totals</summary>
          <p>
            Community estimates unless marked official, checked {history!.reviewed}. Event and banner counts start from{' '}
            {shortDate(history!.archiveSince)}, when Memoria began keeping its feed.
          </p>
        </details>
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
  // The names stand in one column past the plot, each level with its line's end
  // where it can be and never on top of another.
  const labelY = spreadLabels(
    series.map((s) => y(s.points.at(-1)!.pulls!)),
    13,
    PAD.top,
    PAD.top + plotH,
  );

  return (
    <section className="history-card mb-5" aria-labelledby="history-pulls">
      <SectionTitle>
        <span id="history-pulls">Free pulls per version</span>
      </SectionTitle>
      <p className="say -mt-1 mb-3 text-caption text-dim">Free currency ÷ the cost of one pull.</p>
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
            {series.map(({ game, points }, index) => {
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
                  <text x={PAD.left + plotW + 10} y={labelY[index]} dy="0.32em" className="history-label">
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
        <SectionTitle>
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
      {game.methodology && (
        <details className="pulls-about mt-3">
          <summary>How this is counted</summary>
          <p>{game.methodology}</p>
        </details>
      )}
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
          {hovered.record.phases.map((phase) =>
            phase.featured.length ? (
              <span key={phase.phase}>
                Phase {phase.phase}: {phase.featured.join(', ')}
              </span>
            ) : null,
          )}
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
            <th scope="col">Limited banners</th>
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
                {row.record.phases.some((phase) => phase.featured.length)
                  ? row.record.phases.map((phase) => (
                      <span key={phase.phase} className="block">
                        <span className="text-dim">
                          {row.record.phases.length > 1 ? `Phase ${phase.phase}` : 'Banners'}
                          {phase.start ? ` · ${shortDate(phase.start)}` : ''}:{' '}
                        </span>
                        {phase.featured.join(', ') || '—'}
                        {phase.currency != null && <span className="text-dim"> · {fmt(phase.currency)}</span>}
                      </span>
                    ))
                  : '—'}
              </td>
              <td>
                {row.record.sources.map((source, index) => (
                  <Tooltip key={source.url} content={source.label}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${source.label}, ${new URL(source.url).hostname.replace(/^www\./, '')}`}
                      className="history-source"
                    >
                      {index > 0 && <span aria-hidden> · </span>}
                      {new URL(source.url).hostname.replace(/^www\./, '')}
                    </a>
                  </Tooltip>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
