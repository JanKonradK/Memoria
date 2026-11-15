import { useEffect, useId, useState } from 'react';
import { NOTIFICATION_STYLES, notificationStyle, type NotificationStyle } from '@memoria/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { fmtDateTimeLocalInput, parseDateTimeLocalInput } from '../util';
import { rosterGames } from './roster';
import { Sheet } from './Sheet';
import { Btn, Field, Select, TextInput } from './ui';
import { REPEAT_OPTIONS } from './settings/reminder-repeat';
import { STYLE_HINTS, STYLE_LABELS } from './settings/ReminderStyles';

export function ReminderSheet({ open }: { open: boolean }) {
  const state = useApp((s) => s.state);
  const addReminder = useApp((s) => s.addReminder);
  const closeSheet = useUI((s) => s.closeSheet);

  const games = rosterGames(state.games);
  const [draftZone, setDraftZone] = useState(state.settings.localTz);
  const [message, setMessage] = useState('');
  const [when, setWhen] = useState(() => fmtDateTimeLocalInput(Date.now() + 3600_000, draftZone));
  const at = parseDateTimeLocalInput(when, draftZone);
  const [gameId, setGameId] = useState('');
  const [repeatDays, setRepeatDays] = useState(0);
  const [style, setStyle] = useState<NotificationStyle | ''>('');
  const usual = notificationStyle(state.settings, 'reminder');
  const formId = useId();
  const dateErrorId = useId();
  const unavailableGame = Boolean(gameId && !games.some((game) => game.id === gameId));
  const [savedDraft, setSavedDraft] = useState(() => JSON.stringify({ message, when, gameId }));

  useEffect(() => {
    if (open) {
      setDraftZone(state.settings.localTz);
      const nextWhen = fmtDateTimeLocalInput(Date.now() + 3600_000, state.settings.localTz);
      setMessage('');
      setWhen(nextWhen);
      setGameId('');
      setRepeatDays(0);
      setStyle('');
      setSavedDraft(JSON.stringify({ message: '', when: nextWhen, gameId: '' }));
    }
    // The editor owns its draft until it closes, including during background sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={closeSheet}
      dirty={JSON.stringify({ message, when, gameId }) !== savedDraft || repeatDays !== 0 || style !== ''}
      title="New reminder"
      footer={
        <Btn
          kind="primary"
          type="submit"
          form={formId}
          className="w-full"
          disabled={!message.trim() || at == null || unavailableGame}
        >
          Add reminder
        </Btn>
      }
    >
      <form
        id={formId}
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!message.trim() || at == null || unavailableGame) return;
          addReminder(message.trim(), at, gameId || null, repeatDays || undefined, style || undefined);
          closeSheet();
        }}
      >
        <Field label="Message">
          <TextInput
            placeholder="e.g. Spend starglitter before maintenance"
            maxLength={20_000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Field label="When">
              <TextInput
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                aria-invalid={at == null || undefined}
                aria-describedby={at == null ? dateErrorId : undefined}
              />
            </Field>
            {at == null && (
              <span id={dateErrorId} role="alert" className="mt-2 block text-caption text-danger-fg">
                Enter a valid date and time.
              </span>
            )}
          </div>
          <Field label="Game (optional)">
            <Select value={gameId} onChange={(e) => setGameId(e.target.value)}>
              <option value="">No game</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.accountLabel ? ` · ${g.accountLabel}` : ''}
                  {g.paused ? ' · Paused' : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Repeat">
          <Select value={String(repeatDays)} onChange={(e) => setRepeatDays(Number(e.target.value))}>
            {REPEAT_OPTIONS.map((option) => (
              <option key={option.days} value={option.days}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Arrives as">
          <Select value={style} onChange={(e) => setStyle(e.target.value as NotificationStyle | '')}>
            <option value="">Usual: {STYLE_LABELS[usual]}</option>
            {NOTIFICATION_STYLES.map((option) => (
              <option key={option} value={option}>
                {STYLE_LABELS[option]}: {STYLE_HINTS[option]}
              </option>
            ))}
          </Select>
        </Field>
        {unavailableGame && (
          <p role="alert" className="text-meta text-warn-fg">
            This game was removed. Pick another game or No game.
          </p>
        )}
        <p className="text-label text-muted">Times in {draftZone}</p>
      </form>
    </Sheet>
  );
}
