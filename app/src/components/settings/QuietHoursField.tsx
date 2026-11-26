import { useApp } from '../../store';
import { TextInput, Toggle } from '../ui';
import { SettingRow } from './SettingRow';
import { fromClock, toClock } from './clock';

/**
 * Off by default: a reminder at 02:00 that saves a reset beats a quiet night
 * that loses it. When set, reminders inside them arrive just before they begin.
 */
export function QuietHoursField() {
  const settings = useApp((s) => s.state.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const on = settings.quietStart != null && settings.quietEnd != null;
  const start = settings.quietStart ?? 23 * 60;
  const end = settings.quietEnd ?? 7 * 60;
  const set = (quietStart: number | null, quietEnd: number | null) =>
    updateSettings({ quietStart, quietEnd, quietHoursChosen: quietStart != null });
  return (
    <SettingRow
      label="Quiet hours"
      hintKind="fact"
      hint={
        on
          ? `Reminders due inside them arrive at ${toClock((start + 1439) % 1440)} instead.`
          : 'Off: reminders arrive at any hour.'
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Toggle checked={on} onChange={(next) => (next ? set(start, end) : set(null, null))} ariaLabel="Quiet hours" />
        {on && (
          <>
            <TextInput
              type="time"
              step={900}
              className="!w-28"
              aria-label="Quiet hours start"
              value={toClock(start)}
              onChange={(e) => {
                const next = fromClock(e.target.value);
                if (next != null && next !== end) set(next, end);
              }}
            />
            <span className="text-label text-dim">to</span>
            <TextInput
              type="time"
              step={900}
              className="!w-28"
              aria-label="Quiet hours end"
              value={toClock(end)}
              onChange={(e) => {
                const next = fromClock(e.target.value);
                if (next != null && next !== start) set(start, next);
              }}
            />
          </>
        )}
      </div>
    </SettingRow>
  );
}
