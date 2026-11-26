import { useApp } from '../../store';
import { TextInput, Toggle } from '../ui';
import { SettingRow } from './SettingRow';
import { fromClock, toClock } from './clock';

/** Optional: one evening notification with what is still open. Adds to the reset reminders. */
export function DigestField() {
  const digestAt = useApp((s) => s.state.settings.digestAt ?? null);
  const updateSettings = useApp((s) => s.updateSettings);
  const on = digestAt != null;
  const at = digestAt ?? 20 * 60;
  return (
    <SettingRow
      label="Evening digest"
      hintKind={on ? 'fact' : 'say'}
      hint={
        on
          ? `One notification at ${toClock(at)} with what is still open.`
          : 'Off: one notification a day with what is still open.'
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Toggle
          checked={on}
          onChange={(next) => updateSettings({ digestAt: next ? at : null })}
          ariaLabel="Evening digest"
        />
        {on && (
          <TextInput
            type="time"
            step={900}
            className="!w-28"
            aria-label="Evening digest time"
            value={toClock(at)}
            onChange={(e) => {
              const next = fromClock(e.target.value);
              if (next != null) updateSettings({ digestAt: next });
            }}
          />
        )}
      </div>
    </SettingRow>
  );
}
