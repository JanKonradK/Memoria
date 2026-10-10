import type { Game } from '@memoria/shared';
import { chooseLaunchTarget, clearLaunchTarget, launchGame, useGameLaunch } from '../game-launch';
import { Btn, TOUCH_BUTTON, Tooltip } from './ui';

/**
 * Starts the game itself. Only the Windows app can, so nothing renders anywhere
 * else: a button that opens a card must never be labelled as if it opened a game.
 */
export function LaunchButton({ game }: { game: Game }) {
  const available = useGameLaunch((store) => store.available);
  const target = useGameLaunch((store) => store.targets[game.id]);
  const busy = useGameLaunch((store) => store.busy === game.id);
  if (!available) return null;
  if (!target)
    return (
      <Btn className={TOUCH_BUTTON} disabled={busy} onClick={() => void chooseLaunchTarget(game.id)}>
        Set up launch
      </Btn>
    );
  return (
    <Tooltip content={`Starts ${target}`}>
      <Btn
        kind="primary"
        className={`${TOUCH_BUTTON} inline-flex items-center gap-1.5`}
        disabled={busy}
        aria-label={`Launch ${game.name}`}
        onClick={() => void launchGame(game.id)}
      >
        <svg viewBox="0 0 20 20" aria-hidden className="h-3.5 w-3.5" fill="currentColor">
          <path d="M6.5 4.6v10.8a.6.6 0 0 0 .92.5l8.3-5.4a.6.6 0 0 0 0-1L7.42 4.1a.6.6 0 0 0-.92.5Z" />
        </svg>
        Launch
      </Btn>
    </Tooltip>
  );
}

/** Lives with the card's other settings: what Launch starts, and a way to change it. */
export function LaunchSettings({ game }: { game: Game }) {
  const available = useGameLaunch((store) => store.available);
  const target = useGameLaunch((store) => store.targets[game.id]);
  const busy = useGameLaunch((store) => store.busy === game.id);
  if (!available) return null;
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-2"
      role="group"
      aria-label={`Launch settings for ${game.name}`}
    >
      <p className="mr-auto min-w-0 text-meta text-muted">
        Launch starts <span className="break-all font-medium text-fg-soft">{target ?? 'nothing yet'}</span>
      </p>
      <Btn className={TOUCH_BUTTON} disabled={busy} onClick={() => void chooseLaunchTarget(game.id)}>
        {target ? 'Change' : 'Choose'}
      </Btn>
      {target && (
        <Btn className={TOUCH_BUTTON} disabled={busy} onClick={() => void clearLaunchTarget(game.id)}>
          Remove
        </Btn>
      )}
    </div>
  );
}
