import type { AlertType, Game } from '@technogg/shared';
import { alertTypeLabel, DEFAULT_THRESHOLDS } from '@technogg/shared';
import { useApp } from '../../store';
import { intOr } from '../../util';
import { Btn, NumInput, Toggle } from '../ui';

const ALERT_TYPES: AlertType[] = ['energy_cap', 'daily_undone', 'weekly_undone', 'monthly_undone', 'event_end'];

export function GameAlerts({ game }: { game: Game }) {
  const app = useApp();
  const globalRule = (type: AlertType) =>
    app.state.alertRules.find((rule) => rule.type === type && rule.gameId === null && !rule.deleted);

  return (
    <div className="space-y-2">
      {ALERT_TYPES.map((type) => {
        const override = app.state.alertRules.find(
          (rule) => rule.type === type && rule.gameId === game.id && !rule.deleted,
        );
        const inherited = globalRule(type);
        const enabled = override?.enabled ?? inherited?.enabled ?? true;
        const minutes = override?.thresholdMinutes ?? inherited?.thresholdMinutes ?? DEFAULT_THRESHOLDS[type];
        const label = alertTypeLabel(type);

        return (
          <div
            key={type}
            className="flex flex-wrap items-center gap-2 rounded-ui-lg bg-white/[0.03] px-3 py-2 ring-1 ring-white/10"
          >
            <Toggle
              checked={enabled}
              onChange={(value) => app.upsertRule({ type, gameId: game.id, enabled: value, thresholdMinutes: minutes })}
              ariaLabel={`${enabled ? 'Disable' : 'Enable'} ${label}`}
            />
            <span className="min-w-40 flex-1 text-body text-fg-soft">{label}</span>
            <div className="ml-auto flex items-center gap-2">
              <NumInput
                className="!w-24"
                value={String(minutes)}
                aria-label={`${label} minutes before for ${game.name}`}
                onChange={(e) =>
                  app.upsertRule({
                    type,
                    gameId: game.id,
                    enabled,
                    thresholdMinutes: Math.max(5, intOr(e.target.value, minutes)),
                  })
                }
              />
              <span className="text-label text-dim">min</span>
              {override && (
                <Btn className="!px-2 text-xs" onClick={() => app.clearRule(type, game.id)}>
                  Reset
                </Btn>
              )}
            </div>
          </div>
        );
      })}
      <p className="pt-1 text-label text-dim">Overrides the global defaults in Settings → Alert timing.</p>
    </div>
  );
}
