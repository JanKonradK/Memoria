import { useEffect, useId, useState } from 'react';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { fmtDateTimeLocalInput, parseDateTimeLocalInput } from '../util';
import { rosterGames } from './roster';
import { Sheet } from './Sheet';
import { Btn, Field, Select, TextInput } from './ui';

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
      setSavedDraft(JSON.stringify({ message: '', when: nextWhen, gameId: '' }));
    }
    // The editor owns its draft until it closes, including during background sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={closeSheet}
      dirty={JSON.stringify({ message, when, gameId }) !== savedDraft}
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
          addReminder(message.trim(), at, gameId || null);
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
        {unavailableGame && (
          <p role="alert" className="text-meta text-warn-fg">
            This game is no longer available. Choose another game or select No game to keep this reminder.
          </p>
        )}
        <p className="text-label text-muted">Times use {draftZone}.</p>
        <p className="text-label text-dim">Shown in the in-app reminder lists until you delete it.</p>
      </form>
    </Sheet>
  );
}
