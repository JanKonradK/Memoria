import type { Game, GameEvent } from '@memoria/shared';

/** What every Calendar view receives: the shown games and their undeleted events. */
export interface CalendarViewProps {
  games: Game[];
  events: GameEvent[];
  now: number;
  /** The player's home time zone (settings.localTz): every day boundary is drawn in it. */
  localTz: string;
  /** The page bar's Show finished switch. */
  showFinished: boolean;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
}
