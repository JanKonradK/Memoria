import type { Game, GameEvent } from '@memoria/shared';
import { eventBannerKind, eventCategory } from '../event-category';

const BANNER_LABELS = {
  character: 'Character',
  weapon: 'Weapon',
  support: 'Support',
  memory: 'Memory',
  other: 'Banner',
} as const;

/** Compact labels shared by the timeline, list and dashboard. */
export function EventTags({
  game,
  event,
  inherit = false,
  availableWidth,
}: {
  game?: Game;
  event: GameEvent;
  inherit?: boolean;
  availableWidth?: number;
}) {
  const kind = eventBannerKind(event);
  const labels = [
    ...(eventCategory(game, event) === 'miliastra' ? [{ text: 'MW', title: 'Miliastra Wonderland' }] : []),
    ...(event.type === 'banner'
      ? [
          {
            text: kind ? BANNER_LABELS[kind] : 'Banner',
            title: kind && kind !== 'other' ? `${BANNER_LABELS[kind]} banner` : 'Banner',
          },
        ]
      : []),
  ];
  // Keep at least 40px for the event name on clipped timeline bars.
  // Full tags remain available in the list and event editor.
  const tagBudget = labels.reduce((width, label) => width + label.text.length * 7 + 14, 0);
  if (availableWidth !== undefined && availableWidth < tagBudget + 40) return null;
  return labels.map(({ text, title }) => (
    <span
      key={text}
      data-event-tag
      title={title}
      aria-label={title}
      className={`shrink-0 rounded-ui-sm border px-1 text-caption font-semibold leading-tight ${inherit ? 'border-current' : 'border-line-edge bg-fill-2 text-fg-soft'}`}
    >
      {text}
    </span>
  ));
}
