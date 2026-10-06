import type { GameUrgency } from '@memoria/shared';
import { useDerived } from '../selectors';
import { useUI } from '../ui-store';
import { useApp } from '../store';
import { gameTitleInk } from '../game-color';
import { gameShellVars, useGround, useTheme } from '../theme';
import { fmtDur } from '../util';
import { titleFont } from '../fonts';
import { ProgressBar, ReactorTube } from './primitives';
import { AttentionIndicator } from './AttentionIndicator';
import { useIdentityColors } from './roster';
import { navigateWorkspace } from '../workspace-navigation';
import { serverRegionLabel } from './NexusLayout';

/** Compact overview for phones and smaller desktop windows. */
export function MobileRoster({ entries, now }: { entries: GameUrgency[]; now: number }) {
  const { state, checklistByGame, primaryEnergy } = useDerived(now);
  const setFocused = useUI((s) => s.setFocusedGameId);
  const updateGame = useApp((store) => store.updateGame);
  const colors = useIdentityColors(state.games);
  const ground = useGround();
  const theme = useTheme();

  return (
    <div className="mobile-game-roster" aria-label="Your games">
      {entries.map(({ game, next }) => {
        const dailies = (checklistByGame.get(game.id) ?? []).filter((item) => item.cadence === 'daily');
        const done = dailies.filter((item) => item.done).length;
        const identity = colors[game.id] ?? game;
        const { resource, projection } = primaryEnergy(game.id);
        const fraction = resource && projection?.hasSnapshot ? projection.precise / Math.max(1, resource.cap) : 0;
        const urgent = !game.paused && next && next.at - now < 2 * 60 * 60_000;
        const name = `${game.name}${game.accountLabel ? `, ${game.accountLabel}` : ''}`;
        return (
          <button
            key={game.id}
            type="button"
            data-roster-game={game.id}
            onClick={() => {
              if (game.paused) updateGame(game.id, { paused: false });
              navigateWorkspace(game.id, null, () => setFocused(game.id));
            }}
            aria-label={game.paused ? `Resume ${name} tracking` : `Open ${name} controls`}
            aria-describedby={`roster-summary-${game.id}`}
            data-paused={game.paused || undefined}
            className="card-shell game-card-surface mobile-game-row w-full text-left"
            style={gameShellVars(game, theme, identity)}
          >
            <span className="mobile-game-heading flex min-w-0 items-center gap-2">
              <span
                className="mobile-game-title min-w-0 flex-1 truncate font-semibold"
                style={{ fontFamily: titleFont(game.titleFont) }}
              >
                {game.name}
              </span>
              <span className="mobile-game-cta shrink-0" aria-hidden>
                {game.paused ? (
                  'Resume'
                ) : (
                  <svg viewBox="0 0 20 20" className="icon h-4 w-4" fill="none" stroke="currentColor">
                    <path d="m8 5 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
            </span>
            <span id={`roster-summary-${game.id}`} className="block">
              <span className="mobile-game-meta flex min-w-0 items-center justify-between gap-2 text-caption">
                <span className="flex min-w-0 items-center gap-1.5 text-muted">
                  <span className="mobile-game-region shrink-0">{serverRegionLabel(game.tz, now)}</span>
                  {game.accountLabel && <span className="min-w-0 truncate">{game.accountLabel}</span>}
                </span>
                {!game.paused && dailies.length > 0 && (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <ProgressBar
                      variant="ring"
                      value={done / dailies.length}
                      color={gameTitleInk(identity, ground)}
                      size={18}
                      stroke={2}
                      className="shrink-0"
                      aria-hidden
                    >
                      {done === dailies.length && (
                        <svg viewBox="0 0 16 16" className="icon h-2.5 w-2.5" fill="none" stroke="currentColor">
                          <path d="m4 8 2.5 2.5L12 5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </ProgressBar>
                    <span className={done === dailies.length ? 'text-ok-fg' : 'text-muted'}>
                      <span aria-hidden>
                        {done}/{dailies.length} dailies
                      </span>
                      <span className="sr-only">
                        {done} of {dailies.length} dailies done
                      </span>
                    </span>
                  </span>
                )}
              </span>
              {resource && !game.paused && (
                <span className="mobile-game-energy block">
                  <span className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-caption text-muted">{resource.name}</span>
                    <span className="mobile-game-value shrink-0 text-right tabular-nums">
                      {projection?.hasSnapshot ? projection.value : '—'}
                      <span className="mobile-game-cap text-muted"> / {resource.cap}</span>
                    </span>
                  </span>
                  <ReactorTube value={fraction} tone="var(--game-ink)" height={4} className="game-energy-track" />
                </span>
              )}
              <span className="mobile-game-next flex min-w-0 items-center justify-between gap-2 text-caption">
                <span className="flex min-w-0 items-center gap-1.5 text-fg-soft">
                  {urgent && <AttentionIndicator />}
                  <span className="min-w-0 truncate">
                    {next?.label ?? (game.paused ? 'Tracking paused' : 'No upcoming deadlines')}
                  </span>
                </span>
                {next && (
                  <span className="mobile-game-deadline shrink-0 tabular-nums text-fg-soft">
                    {next.at <= now ? 'Now' : fmtDur(next.at - now)}
                  </span>
                )}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
