import { useId, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Game, Reminder } from '@memoria/shared';
import { useApp } from '../../store';
import { fmtDateTimeLocalInput, parseDateTimeLocalInput } from '../../util';
import { Btn, Field, SectionTitle, TextInput } from '../ui';

export type ReminderDraft = {
  editing: string | null;
  message: string;
  when: string;
  zone: string;
  status: string;
  saved: { message: string; when: string };
};

export function createReminderDraft(zone: string): ReminderDraft {
  const when = fmtDateTimeLocalInput(Date.now() + 3600_000, zone);
  return { editing: null, message: '', when, zone, status: '', saved: { message: '', when } };
}

export function reminderDraftChanged(draft: ReminderDraft): boolean {
  return draft.message !== draft.saved.message || draft.when !== draft.saved.when;
}

export function GameReminders({
  game,
  draft,
  setDraft,
}: {
  game: Game;
  draft: ReminderDraft;
  setDraft: Dispatch<SetStateAction<ReminderDraft>>;
}) {
  const state = useApp((store) => store.state);
  const addReminder = useApp((store) => store.addReminder);
  const updateReminder = useApp((store) => store.updateReminder);
  const deleteReminder = useApp((store) => store.deleteReminder);
  const { editing, message, when, zone, status } = draft;
  const messageRef = useRef<HTMLInputElement>(null);
  const dateErrorId = useId();
  const patch = (values: Partial<ReminderDraft>) => setDraft((current) => ({ ...current, ...values }));
  const reminders = state.reminders
    .filter((item) => item.gameId === game.id && !item.deleted)
    .sort((a, b) => a.at - b.at);
  const at = parseDateTimeLocalInput(when, zone);
  const unavailable = Boolean(editing && !reminders.some((reminder) => reminder.id === editing));
  const canDiscard = () => !reminderDraftChanged(draft) || window.confirm('Discard your unsaved changes?');
  const clear = () => {
    patch({ editing: null, message: '', saved: { message: '', when } });
  };
  const edit = (reminder: Reminder) => {
    if (!canDiscard()) return;
    const nextZone = state.settings.localTz;
    const nextWhen = fmtDateTimeLocalInput(reminder.at, nextZone);
    patch({
      editing: reminder.id,
      message: reminder.message,
      when: nextWhen,
      zone: nextZone,
      status: '',
      saved: { message: reminder.message, when: nextWhen },
    });
    messageRef.current?.focus();
  };
  const save = (asNew = false) => {
    if (!message.trim() || at == null || (unavailable && !asNew)) return;
    if (editing && !asNew) updateReminder(editing, { message, at });
    else addReminder(message.trim(), at, game.id);
    patch({ status: editing && !asNew ? 'Reminder saved' : 'Reminder added' });
    clear();
  };

  return (
    <section>
      <SectionTitle>Reminders</SectionTitle>
      <p className="mb-4 text-meta text-muted">
        Reminders for {game.name} appear in Tonight. Times use {zone}.
      </p>
      {reminders.length === 0 && (
        <p className="mb-5 text-body text-muted">
          No reminders yet. Add a check-in or something you want to do before reset.
        </p>
      )}
      <div className="mb-5 divide-y divide-line-hairline">
        {reminders.map((reminder) => (
          <div key={reminder.id} className="flex flex-wrap items-center gap-2 py-3">
            <div className="min-w-0 flex-1 basis-48">
              <p className="break-words text-body text-fg">{reminder.message}</p>
              <p className="mt-1 text-label text-muted">
                {fmtDateTimeLocalInput(reminder.at, zone).replace('T', ' · ')}
              </p>
            </div>
            <Btn aria-label={`Edit reminder ${reminder.message}`} onClick={() => edit(reminder)}>
              Edit
            </Btn>
            <Btn
              kind="danger"
              aria-label={`Delete reminder ${reminder.message}`}
              onClick={() => {
                deleteReminder(reminder.id);
                if (editing === reminder.id) clear();
                patch({ status: 'Reminder deleted' });
              }}
            >
              Delete
            </Btn>
          </div>
        ))}
      </div>
      <form
        className="space-y-3 border-t border-line-hairline pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        {unavailable && (
          <p role="alert" className="text-meta text-warn-fg">
            This reminder is no longer available. Your draft is kept here. Add it as a new reminder to save it.
          </p>
        )}
        <Field label="Reminder message">
          <TextInput
            ref={messageRef}
            maxLength={20_000}
            value={message}
            onChange={(event) => patch({ message: event.target.value, status: '' })}
            placeholder="e.g. Claim rewards before reset"
            required
          />
        </Field>
        <Field label="When">
          <TextInput
            type="datetime-local"
            value={when}
            onChange={(event) => patch({ when: event.target.value, status: '' })}
            aria-invalid={at == null || undefined}
            aria-describedby={at == null ? dateErrorId : undefined}
            required
          />
        </Field>
        {at == null && (
          <p id={dateErrorId} role="alert" className="text-caption text-danger-fg">
            Enter a valid date and time.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Btn type="submit" kind="primary" disabled={!message.trim() || at == null || unavailable}>
            {editing ? 'Save reminder' : 'Add reminder'}
          </Btn>
          {unavailable && (
            <Btn kind="primary" onClick={() => save(true)} disabled={!message.trim() || at == null}>
              Add as new reminder
            </Btn>
          )}
          {editing && <Btn onClick={() => canDiscard() && clear()}>Cancel</Btn>}
        </div>
        <p role="status" className="min-h-5 text-label text-muted">
          {status}
        </p>
        <p className="text-label text-muted">These are in-app reminders. Keep Memoria open to see them.</p>
      </form>
    </section>
  );
}
