import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Btn } from '../ui';

/** Letters, digits, F1–F12 and PrintScreen, named as the Windows app reads them; null for any other key. */
function shortcutKey(event: ReactKeyboardEvent): string | null {
  const code = event.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  if (code === 'PrintScreen' || event.key === 'PrintScreen') return 'PrintScreen';
  return null;
}

/** Function keys and PrintScreen may stand alone; a letter or digit needs Ctrl or Alt. */
function standsAlone(key: string): boolean {
  return key === 'PrintScreen' || /^F[0-9]+$/.test(key);
}

/**
 * Click, then press the keys. Esc cancels; Tab moves on, so the keyboard is
 * never trapped. Shared by the screenshot and quick card shortcuts.
 */
export function ShortcutRecorder({
  accelerator,
  disabled,
  onChange,
  name = 'shortcut',
  unset = 'Choose keys',
}: {
  /** Blank when none is set yet. */
  accelerator: string;
  disabled: boolean;
  onChange: (next: string) => void;
  /** What it records, in its accessible name: "Change quick card shortcut". */
  name?: string;
  /** Shown while no keys are set. */
  unset?: string;
}) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState('');
  const stop = () => {
    setRecording(false);
    setHint('');
  };

  const record = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    if (event.key === 'Tab') {
      stop();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      stop();
      return;
    }
    const key = shortcutKey(event);
    if (!key) return;
    const modifiers = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift'].filter(
      (part): part is string => typeof part === 'string',
    );
    if (!event.ctrlKey && !event.altKey && !standsAlone(key)) {
      setHint('Add Ctrl or Alt to that key.');
      return;
    }
    stop();
    const next = [...modifiers, key].join('+');
    if (next !== accelerator) onChange(next);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Btn
        className="min-w-36 font-mono"
        aria-label={
          recording
            ? 'Press shortcut… (Esc cancels)'
            : accelerator
              ? `Change ${name}, now ${accelerator}`
              : `Choose ${name}`
        }
        aria-pressed={recording}
        disabled={disabled}
        onClick={() => {
          setHint('');
          setRecording((value) => !value);
        }}
        onKeyDown={record}
        onKeyUp={(event) => {
          // Windows hands PrintScreen to a page only on key up.
          if (recording && event.key === 'PrintScreen') record(event);
        }}
        onBlur={stop}
      >
        {recording ? 'Press shortcut… (Esc cancels)' : accelerator || unset}
      </Btn>
      {hint && (
        <span role="status" className="text-caption text-warn-fg">
          {hint}
        </span>
      )}
    </div>
  );
}
