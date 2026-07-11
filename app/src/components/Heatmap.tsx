import type { HeatDay } from '@technogg/shared';
import { tint } from '../util';

/** 7-row calendar heatmap of daily-task completion (columns = weeks). */
export function Heatmap({ days, color }: { days: HeatDay[]; color: string }) {
  return (
    <div className="grid grid-flow-col grid-rows-7 gap-[3px]" style={{ width: 'fit-content' }}>
      {days.map((d) => {
        const ratio = d.total > 0 ? d.done / d.total : 0;
        return (
          <span
            key={d.date}
            title={`${d.date}: ${d.done}/${d.total}`}
            className="h-3 w-3 rounded-[3px]"
            style={{
              background: ratio > 0 ? tint(color, 0.2 + 0.65 * ratio) : 'rgba(255,255,255,0.06)',
              boxShadow: ratio >= 1 ? `0 0 4px ${tint(color, 0.5)}` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
