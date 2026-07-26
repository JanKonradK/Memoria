import { useDerived } from '../selectors';
import { useUI } from '../ui-store';
import { useNow } from '../hooks';
import { tint } from '../util';
import { GameControls } from './GameCard';
import { Sheet } from './Sheet';

/**
 * The game's live card in a dialog — the same control surface the Nexus opens
 * in place, for entry points that are not on the Nexus stage (the "Up next"
 * hero). Settings live in GameDetailSheet and stay one click away, on the title.
 */
export function GameCardSheet({ gameId, open }: { gameId: string; open: boolean }) {
  const closeSheet = useUI((s) => s.closeSheet);
  const now = useNow(30_000);
  const entry = useDerived(now).entryById.get(gameId);
  if (!entry) return null;
  const { game } = entry;

  return (
    <Sheet open={open} onClose={closeSheet} title={game.name} wide hideTitle>
      <div
        className="relative -mx-2 overflow-hidden rounded-ui-card p-4"
        style={{
          background: `linear-gradient(155deg, ${tint(game.color, 0.2)} 0%, transparent 46%), linear-gradient(335deg, ${tint(game.color2 ?? game.color, 0.13)} 0%, transparent 42%), #07060c`,
          boxShadow: `inset 0 0 0 1px ${tint(game.color, 0.32)}, inset 0 1px 0 rgba(255,255,255,0.07), 0 0 56px -22px ${tint(game.color, 0.55)}`,
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-4 top-0 h-[3px] rounded-ui-full"
          style={{
            background: `linear-gradient(90deg, transparent, ${game.color}, ${game.color2 ?? game.color}, transparent)`,
          }}
        />
        <GameControls entry={entry} now={now} layout="focus" />
      </div>
    </Sheet>
  );
}
