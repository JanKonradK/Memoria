import { useMemo } from 'react';
import { homeTimeZoneOptions, SYSTEM_TIMEZONE_VALUE, utcOffsetLabel } from '../timezone';
import { Select } from './ui';

/**
 * The home timezone picker, with the offset it currently resolves to.
 *
 * Onboarding asks for it before there is any state to write to and Settings
 * edits the stored value, so the control takes the choice and the resolved zone
 * rather than reaching for either one itself: `value` is what the select shows
 * (possibly the "system" sentinel) and `resolvedTz` is the real zone the option
 * list and the offset line are built from.
 */
export function HomeTimeZoneField({
  value,
  resolvedTz,
  detectedTz,
  onChange,
}: {
  value: string;
  resolvedTz: string;
  detectedTz: string;
  onChange: (value: string) => void;
}) {
  const options = useMemo(() => homeTimeZoneOptions(resolvedTz), [resolvedTz]);
  return (
    <div className="flex min-w-0 flex-col items-end gap-1 sm:min-w-80">
      <Select aria-label="Home timezone" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value={SYSTEM_TIMEZONE_VALUE}>Use system timezone ({detectedTz})</option>
        {options.map((option) => (
          <option key={option.tz} value={option.tz}>
            {option.label}
          </option>
        ))}
      </Select>
      <span className="numeral text-label text-dim">Current offset {utcOffsetLabel(resolvedTz)}</span>
    </div>
  );
}
