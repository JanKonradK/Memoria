import { useEffect, useState } from 'react';
import type { EventType } from '@void/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { fmtDateTimeLocalInput, parseDateTimeLocalInput } from '../util';
import { Sheet } from './Sheet';
import { Btn, Field, Select, TextInput, Toggle } from './ui';

const DAY = 86_400_000;
const TYPES: EventType[] = ['banner', 'event', 'cycle', 'maintenance', 'custom'];

/** Add/edit an event from anywhere (Timeline, dashboard). */
export function EventSheet({ open, eventId, gameId }: { open: boolean; eventId?: string; gameId?: string }) {
  const state = useApp((s) => s.state);
  const upsertEvent = useApp((s) => s.upsertEvent);
  const deleteEvent = useApp((s) => s.deleteEvent);
  const closeSheet = useUI((s) => s.closeSheet);

  const games = state.games.filter((g) => !g.deleted).sort((a, b) => a.sort - b.sort);
  const existing = eventId ? state.events.find((e) => e.id === eventId && !e.deleted) : undefined;

  const [draft, setDraft] = useState({
    gameId: gameId ?? games[0]?.id ?? '',
    name: '',
    type: 'event' as EventType,
    start: Date.now(),
    end: Date.now() + 7 * DAY,
    dailyTouch: false,
    notify: true,
    done: false,
  });

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setDraft({
        gameId: existing.gameId,
        name: existing.name,
        type: existing.type,
        start: existing.start,
        end: existing.end,
        dailyTouch: existing.dailyTouch,
        notify: existing.notify,
        done: existing.done ?? false,
      });
    } else {
      setDraft((d) => ({
        ...d,
        gameId: gameId ?? games[0]?.id ?? '',
        name: '',
        start: Date.now(),
        end: Date.now() + 7 * DAY,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eventId]);

  const save = () => {
    if (!draft.gameId || !draft.name.trim()) return;
    upsertEvent({ ...(existing ? { id: existing.id } : {}), ...draft, name: draft.name.trim() });
    closeSheet();
  };

  return (
    <Sheet open={open} onClose={closeSheet} title={existing ? 'Edit event' : 'New event'}>
      <div className="space-y-3">
        <Field label="Game">
          <Select value={draft.gameId} onChange={(e) => setDraft({ ...draft, gameId: e.target.value })}>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name">
          <TextInput
            placeholder="e.g. Lantern Rite, Character banner…"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as EventType })}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <div />
          <Field label="Starts">
            <TextInput
              type="datetime-local"
              value={fmtDateTimeLocalInput(draft.start)}
              onChange={(e) => {
                const t = parseDateTimeLocalInput(e.target.value);
                if (t != null) setDraft({ ...draft, start: t });
              }}
            />
          </Field>
          <Field label="Ends">
            <TextInput
              type="datetime-local"
              value={fmtDateTimeLocalInput(draft.end)}
              onChange={(e) => {
                const t = parseDateTimeLocalInput(e.target.value);
                if (t != null) setDraft({ ...draft, end: t });
              }}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-5 pt-1">
          <Toggle
            checked={draft.dailyTouch}
            onChange={(v) => setDraft({ ...draft, dailyTouch: v })}
            label="Needs daily touch (pinned on card)"
          />
          <Toggle
            checked={draft.notify}
            onChange={(v) => setDraft({ ...draft, notify: v })}
            label="Include in next actions"
          />
          <Toggle checked={draft.done} onChange={(v) => setDraft({ ...draft, done: v })} label="Done (hide + mute)" />
        </div>
        <div className="flex gap-2 pt-2">
          {existing && (
            <Btn
              kind="danger"
              onClick={() => {
                deleteEvent(existing.id);
                closeSheet();
              }}
            >
              Delete
            </Btn>
          )}
          <Btn kind="primary" className="flex-1" onClick={save} disabled={!draft.name.trim() || !draft.gameId}>
            {existing ? 'Save' : 'Add event'}
          </Btn>
        </div>
      </div>
    </Sheet>
  );
}
