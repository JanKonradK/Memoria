import type { Game, GameEvent } from '@memoria/shared';

/** What every Calendar view receives: the shown games and their undeleted events. */
export interface CalendarViewProps {
  games: Game[];
  events: GameEvent[];
  now: number;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
}
