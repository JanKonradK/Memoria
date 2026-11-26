import { useState } from 'react';
import { MAX_ALARM_FREE_WINDOWS, type AlarmFreeWindow } from '@memoria/shared';
import { useApp } from '../../store';
import { uid } from '../../util';
import { Btn, ConfirmDelete, TextInput } from '../ui';
import { SettingRow } from './SettingRow';
import { fromClock, toClock } from './clock';

const DAYS = [
  { day: 1, short: 'M', name: 'Monday' },
  { day: 2, short: 'T', name: 'Tuesday' },
  { day: 3, short: 'W', name: 'Wednesday' },
  { day: 4, short: 'T', name: 'Thursday' },
  { day: 5, short: 'F', name: 'Friday' },
  { day: 6, short: 'S', name: 'Saturday' },
  { day: 7, short: 'S', name: 'Sunday' },
];

/** A stable empty list, so the store selector does not re-render on every read. */
const NONE: AlarmFreeWindow[] = [];

/** The first window offered is work, the next sleep; after that, a copy of sleep to edit. */
function suggestion(existing: AlarmFreeWindow[]): AlarmFreeWindow {
  if (!existing.some((window) => window.label === 'Work'))
    return { id: uid(), label: 'Work', start: 9 * 60, end: 17 * 60, days: [1, 2, 3, 4, 5] };
  return { id: uid(), label: 'Sleep', start: 23 * 60, end: 7 * 60, days: [1, 2, 3, 4, 5, 6, 7] };
}

/**
 * Times when no alarm rings, such as work or sleep. An alarm that falls inside
 * one still arrives, silently, so nothing is lost. Shared by every device.
 */
export function AlarmFreeTimes() {
  const windows = useApp((s) => s.state.settings.alarmFreeWindows ?? NONE);
  const updateSettings = useApp((s) => s.updateSettings);
  // Rows on the page when it opened stay put; only ones added here settle in.
  const [initial] = useState(() => new Set(windows.map((window) => window.id)));
  const save = (next: AlarmFreeWindow[]) => updateSettings({ alarmFreeWindows: next });
  const change = (id: string, patch: Partial<AlarmFreeWindow>) =>
    save(windows.map((window) => (window.id === id ? { ...window, ...patch } : window)));

  return (
    <SettingRow label="No-alarm times" hint="Alarms inside these arrive silently." control="below">
      {/* The list takes the row's width and Add sits under it: side by side, the button squeezed the days. */}
      <div className="flex w-full max-w-xl flex-col items-start gap-2">
        {windows.length > 0 && (
          <ul className="w-full divide-y divide-line-hairline" aria-label="No-alarm times">
            {windows.map((window) => {
              const name = window.label.trim() || 'No-alarm time';
              return (
                <li
                  key={window.id}
                  className={`flex flex-col gap-2 py-3 ${initial.has(window.id) ? '' : 'row-arrive'}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <TextInput
                      className="min-w-0 flex-1 basis-32"
                      aria-label={`Name of ${name}`}
                      maxLength={40}
                      value={window.label}
                      placeholder="e.g. Work"
                      onChange={(e) => change(window.id, { label: e.target.value })}
                    />
                    <TextInput
                      type="time"
                      step={900}
                      className="!w-28"
                      aria-label={`${name} starts`}
                      value={toClock(window.start)}
                      onChange={(e) => {
                        const next = fromClock(e.target.value);
                        if (next != null && next !== window.end) change(window.id, { start: next });
                      }}
                    />
                    <span className="text-label text-dim">to</span>
                    <TextInput
                      type="time"
                      step={900}
                      className="!w-28"
                      aria-label={`${name} ends`}
                      value={toClock(window.end)}
                      onChange={(e) => {
                        const next = fromClock(e.target.value);
                        if (next != null && next !== window.start) change(window.id, { end: next });
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Seven equal days in one strip: on a 360px phone each is still a 44px target, and nothing overflows. */}
                    <div
                      className="grid w-full grid-cols-7 gap-px rounded-ui-full bg-line-hairline ring-1 ring-line-hairline sm:w-auto"
                      role="group"
                      aria-label={`Days for ${name}`}
                    >
                      {DAYS.map(({ day, short, name: dayName }) => {
                        const on = window.days.includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            aria-label={dayName}
                            aria-pressed={on}
                            // At least one day stays on: a window on no day would do nothing.
                            disabled={on && window.days.length === 1}
                            onClick={() =>
                              change(window.id, {
                                days: on ? window.days.filter((item) => item !== day) : [...window.days, day].sort(),
                              })
                            }
                            className={`grid h-(--control-h) min-w-0 place-items-center text-caption font-semibold transition-colors first:rounded-l-ui-full last:rounded-r-ui-full disabled:cursor-default sm:min-w-(--control-h) ${
                              on ? 'bg-accent text-on-accent' : 'bg-inset text-fg-soft hover:bg-surface-2'
                            }`}
                          >
                            {short}
                          </button>
                        );
                      })}
                    </div>
                    <ConfirmDelete
                      className="ml-auto"
                      what={name}
                      onConfirm={() => save(windows.filter((item) => item.id !== window.id))}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Btn
          disabled={windows.length >= MAX_ALARM_FREE_WINDOWS}
          onClick={() => save([...windows, suggestion(windows)])}
        >
          Add a no-alarm time
        </Btn>
      </div>
    </SettingRow>
  );
}
