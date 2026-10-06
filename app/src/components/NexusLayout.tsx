import type { CSSProperties } from 'react';
import type { AppState, EnergyProjection, GameEvent, GameUrgency, Resource } from '@memoria/shared';
import { DateTime } from 'luxon';
import { titleFont } from '../fonts';
import { gameTitleInk, type GameColors } from '../game-color';
import { useUI, type TonightPosition } from '../ui-store';
import { useDerived } from '../selectors';
import { gameShellVars, useGround, useTheme } from '../theme';
import { navigateWorkspace } from '../workspace-navigation';
import { ReactorTube } from './primitives';
import { AttentionIndicator } from './AttentionIndicator';
import { useIdentityColors } from './roster';
import { ServerChip } from './ui';
import { NexusHub } from './nexus/NexusHub';

const HOUR = 3_600_000;

type UrgencyTier = 'low' | 'med' | 'high';

/** The same time bands used by resource controls: red <2h, amber <8h, green beyond. */
function urgencyTier(entry: GameUrgency, now: number): UrgencyTier {
  if (entry.game.paused || !entry.next) return 'low';
  const remaining = entry.next.at - now;
  if (remaining < 2 * HOUR) return 'high';
  if (remaining < 8 * HOUR) return 'med';
  return 'low';
}

const SERVER_REGIONS: Record<string, string> = {
  'Etc/GMT+5': 'NA',
  'Etc/GMT-1': 'EU',
  'Etc/GMT-8': 'ASIA',
};

function offsetLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return 'UTC';

  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  const offset = minutes > 0 ? `${hours}:${String(minutes).padStart(2, '0')}` : String(hours);
  return `UTC${offsetMinutes > 0 ? '+' : '−'}${offset}`;
}

export function serverRegionLabel(tz: string, now: number): string {
  if (SERVER_REGIONS[tz]) return SERVER_REGIONS[tz];
  if (/^(?:Etc\/)?(?:UTC|GMT)$/i.test(tz)) return 'UTC';

  const serverNow = DateTime.fromMillis(now, { zone: tz });
  if (!serverNow.isValid) return 'Server';

  // Use the current offset so real IANA zones follow daylight-saving time.
  // The narrow ranges cover the supported server regions and their seasonal
  // offsets. Other offsets stay explicit instead of getting a regional guess.
  if (serverNow.offset >= -10 * 60 && serverNow.offset <= -4 * 60) return 'NA';
  if (serverNow.offset >= 0 && serverNow.offset <= 3 * 60) return 'EU';
  if (serverNow.offset >= 7 * 60 && serverNow.offset <= 9 * 60) return 'ASIA';
  return offsetLabel(serverNow.offset);
}

/** Card countdowns stay in hours until the value reaches three digits. */
export function formatCardTimeLeft(ms: number): string {
  if (ms <= 0) return 'now';
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 60) return totalMinutes > 0 ? `${totalMinutes}m` : '<1m';

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 100) return `${totalHours}h`;
  return `${Math.floor(totalHours / 24)}d ${totalHours % 24}h`;
}

type SharedNexusProps = {
  state: AppState;
  entries: GameUrgency[];
  displayIds: string[];
  now: number;
  onOpenEvent: (event: GameEvent) => void;
  onOpenTimeline: () => void;
};

/** A desktop summary opens the same integrated game page as the phone roster. */
function NexusNode({
  entry,
  now,
  primary,
  projection,
  identityColors,
  column,
  row,
  tonightPosition,
}: {
  entry: GameUrgency;
  now: number;
  primary: Resource | undefined;
  projection: EnergyProjection | null;
  identityColors: GameColors;
  column: 1 | 2;
  row: number;
  tonightPosition: TonightPosition;
}) {
  const { game, next } = entry;
  const theme = useTheme();
  const ground = useGround();
  const setFocused = useUI((store) => store.setFocusedGameId);
  const tier = urgencyTier(entry, now);
  const fraction = primary && projection ? projection.precise / Math.max(1, primary.cap) : 0;
  const titleInk = `var(--game-ink, ${gameTitleInk(identityColors, ground, 4.5)})`;
  const accountLabel = game.accountLabel?.trim();
  const serverLabel = serverRegionLabel(game.tz, now);
  return (
    <article
      className="card-shell game-card-surface nexus-node relative overflow-hidden rounded-ui-card"
      data-urgent={tier === 'high' ? 'true' : undefined}
      data-game-id={game.id}
      data-column={column}
      style={{
        ...gameShellVars(game, theme, identityColors),
        gridColumn: tonightPosition === 'left' ? column + 1 : tonightPosition === 'middle' && column === 2 ? 3 : column,
        gridRow: row,
      }}
    >
      <button
        type="button"
        data-roster-game={game.id}
        onClick={() => navigateWorkspace(game.id, null, () => setFocused(game.id))}
        aria-label={`Open ${game.name}${accountLabel ? `, ${accountLabel}` : ''} controls`}
        className="nexus-summary z-10 grid w-full grid-rows-3 rounded-ui-card px-4 py-2 text-left hover:bg-fill-1"
      >
        <span className="game-card-heading relative z-10 flex min-w-0 items-center gap-2">
          {/* Display faces set the same character count at different widths.
                One title step plus truncation keeps every card consistent. */}
          <span
            className="min-w-0 flex-1 truncate text-title font-semibold"
            style={{ fontFamily: titleFont(game.titleFont), color: titleInk }}
          >
            {game.name}
          </span>
          <ServerChip label={serverLabel} className="max-w-20 truncate" />
          {accountLabel && (
            <>
              <span aria-hidden className="h-3 w-px shrink-0 bg-line-edge" />
              <span className="min-w-0 max-w-[45%] shrink-0 truncate text-right text-body font-semibold text-fg-soft">
                {accountLabel}
              </span>
            </>
          )}
        </span>

        <span className="relative z-10 flex min-w-0 items-center">
          <span className="block w-full min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-body font-medium text-fg-soft">
                {primary?.name ?? (game.paused ? 'Tracking paused' : 'No regen resource')}
              </span>
              <span className="game-card-value numeral shrink-0 text-lead font-semibold text-fg">
                {primary && projection && projection.hasSnapshot ? projection.value : '—'}
                <span className="ml-0.5 text-body font-normal text-muted">/{primary?.cap ?? '—'}</span>
              </span>
            </span>

            <ReactorTube
              value={fraction}
              // The level keeps game identity; the status dot carries urgency.
              tone={titleInk}
              height={6}
              className="!mt-1"
            />
          </span>
        </span>

        <span className="game-card-status relative z-10 flex min-w-0 items-center gap-2">
          {!game.paused && tier === 'high' && <AttentionIndicator />}
          <span className="min-w-0 flex-1 truncate text-caption text-muted">
            {next?.label ?? (game.paused ? 'Tracking paused' : 'All clear')}
          </span>
          <span className="numeral shrink-0 text-caption text-muted">
            {next ? (next.at <= now ? 'NOW' : formatCardTimeLeft(next.at - now)) : '—'}
          </span>
        </span>
      </button>
    </article>
  );
}

export function NexusLayout({ state, entries, displayIds, now, onOpenEvent, onOpenTimeline }: SharedNexusProps) {
  const tonightPosition = useUI((store) => store.tonightPosition);
  const derived = useDerived(now);
  const entryById = new Map(entries.map((entry) => [entry.game.id, entry]));
  const identityColors = useIdentityColors(state.games);
  const visibleIds = displayIds.filter((id) => entryById.has(id));
  const leftCount = Math.ceil(visibleIds.length / 2);
  const rows = Math.max(1, leftCount);
  return (
    <div
      className="nexus-stage relative grid items-stretch gap-[clamp(0.75rem,1.4vw,1.5rem)]"
      data-tonight={tonightPosition}
    >
      <aside className="nexus-games-scroll scrollbar-thin min-h-0 min-w-0 overflow-y-auto" aria-label="Game controls">
        <div className="nexus-games" style={{ '--nexus-rows': rows } as CSSProperties}>
          {visibleIds.map((id, index) => {
            const entry = entryById.get(id)!;
            const energy = derived.primaryEnergy(id);
            return (
              <NexusNode
                key={id}
                entry={entry}
                now={now}
                column={index < leftCount ? 1 : 2}
                row={index < leftCount ? index + 1 : index - leftCount + 1}
                tonightPosition={tonightPosition}
                primary={energy.resource}
                projection={energy.projection}
                identityColors={identityColors[id] ?? entry.game}
              />
            );
          })}
          <NexusHub
            state={state}
            entries={entries}
            now={now}
            onOpenEvent={onOpenEvent}
            onOpenTimeline={onOpenTimeline}
          />
        </div>
      </aside>
    </div>
  );
}
