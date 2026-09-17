import { useEffect, useState } from 'react';
import { presetForGame, type EventType, type BannerKind } from '@memoria/shared';
import { eventCategory, eventBannerKind } from '../event-category';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { fmtDateTimeLocalInput, fmtDur, parseDateTimeLocalInput } from '../util';
import { rosterGames } from './roster';
import { Sheet } from './Sheet';
import { Btn, Field, Select, TextArea, TextInput, Toggle } from './ui';

const DAY = 86_400_000;
const TYPES: EventType[] = ['banner', 'event', 'cycle', 'maintenance', 'livestream', 'custom'];

/** Add/edit an event from anywhere (Timeline, dashboard). */
export function EventSheet({ open, eventId, gameId }: { open: boolean; eventId?: string; gameId?: string }) {
  const state = useApp((s) => s.state);
  const upsertEvent = useApp((s) => s.upsertEvent);
  const deleteEvent = useApp((s) => s.deleteEvent);
  const closeSheet = useUI((s) => s.closeSheet);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const games = rosterGames(state.games);
  const existing = eventId ? state.events.find((e) => e.id === eventId && !e.deleted) : undefined;

  const [draft, setDraft] = useState({
    gameId: gameId ?? games[0]?.id ?? '',
    name: '',
    type: 'event' as EventType,
    bannerKind: '' as BannerKind | '',
    category: 'teyvat' as 'teyvat' | 'miliastra',
    start: Date.now(),
    end: Date.now() + 7 * DAY,
    dailyTouch: false,
    notify: true,
    done: false,
    notes: '',
  });
  const [dateInputs, setDateInputs] = useState(() => ({
    start: fmtDateTimeLocalInput(draft.start, state.settings.localTz),
    end: fmtDateTimeLocalInput(draft.end, state.settings.localTz),
  }));
  const invalidDates = {
    start: parseDateTimeLocalInput(dateInputs.start, state.settings.localTz) == null,
    end: parseDateTimeLocalInput(dateInputs.end, state.settings.localTz) == null,
  };
  // One verdict on the window, read by the error line, the save button and save
  // itself — three places that must never disagree about whether this is savable.
  const badWindow = invalidDates.start || invalidDates.end || draft.end <= draft.start;

  /** A typed date keeps the user's text even when it does not parse yet. */
  const setDate = (edge: 'start' | 'end', text: string) => {
    const parsed = parseDateTimeLocalInput(text, state.settings.localTz);
    setDateInputs((inputs) => ({ ...inputs, [edge]: text }));
    if (parsed != null) setDraft((current) => ({ ...current, [edge]: parsed }));
  };

  useEffect(() => {
    if (!open) return;
    setDateInputs({
      start: fmtDateTimeLocalInput(existing?.start ?? Date.now(), state.settings.localTz),
      end: fmtDateTimeLocalInput(existing?.end ?? Date.now() + 7 * DAY, state.settings.localTz),
    });
    if (existing) {
      setDraft({
        gameId: existing.gameId,
        name: existing.name,
        type: existing.type,
        bannerKind: eventBannerKind(existing) ?? '',
        category:
          eventCategory(
            games.find((game) => game.id === existing.gameId),
            existing,
          ) === 'miliastra'
            ? 'miliastra'
            : 'teyvat',
        start: existing.start,
        end: existing.end,
        dailyTouch: existing.dailyTouch,
        notify: existing.notify,
        done: existing.done ?? false,
        notes: existing.notes ?? '',
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
    if (!draft.gameId || !draft.name.trim() || badWindow) return;
    const selectedGame = games.find((game) => game.id === draft.gameId);
    upsertEvent({
      ...(existing ? { id: existing.id } : {}),
      ...draft,
      category: selectedGame && presetForGame(selectedGame)?.key === 'genshin' ? draft.category : undefined,
      bannerKind: draft.type === 'banner' ? draft.bannerKind || undefined : undefined,
      name: draft.name.trim(),
    });
    closeSheet();
  };

  return (
    <Sheet open={open} onClose={closeSheet} title={existing ? 'Edit event' : 'New event'}>
      <div className="space-y-3">
        <p className="text-caption text-dim">Dates and times use {state.settings.localTz}.</p>
        <Field label="Game">
          <Select value={draft.gameId} onChange={(e) => setDraft({ ...draft, gameId: e.target.value })}>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.accountLabel ? ` · ${g.accountLabel}` : ''}
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Type">
            <Select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as EventType })}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          {draft.type === 'banner' && (
            <Field label="Banner tag">
              <Select
                value={draft.bannerKind}
                onChange={(event) => setDraft({ ...draft, bannerKind: event.target.value as BannerKind | '' })}
              >
                <option value="">Choose tag</option>
                <option value="other">Banner (other)</option>
                <option value="character">Character banner</option>
                <option value="weapon">Weapon banner</option>
                <option value="support">Support banner</option>
                <option value="memory">Memory banner</option>
              </Select>
            </Field>
          )}
          {draft.type !== 'maintenance' &&
          draft.type !== 'livestream' &&
          games.some((game) => game.id === draft.gameId && presetForGame(game)?.key === 'genshin') ? (
            <Field label="Genshin world">
              <Select
                value={draft.category}
                onChange={(event) => setDraft({ ...draft, category: event.target.value as 'teyvat' | 'miliastra' })}
              >
                <option value="teyvat">Teyvat</option>
                <option value="miliastra">Miliastra Wonderland</option>
              </Select>
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}
          <Field label="Starts">
            <TextInput
              type="datetime-local"
              value={dateInputs.start}
              onChange={(e) => setDate('start', e.target.value)}
            />
          </Field>
          <Field label="Ends">
            <TextInput type="datetime-local" value={dateInputs.end} onChange={(e) => setDate('end', e.target.value)} />
          </Field>
        </div>
        {badWindow ? (
          <p role="alert" className="text-caption text-danger-fg">
            Enter valid dates. The end must be after the start.
          </p>
        ) : (
          <p className="text-caption text-dim">Duration: {fmtDur(draft.end - draft.start)}</p>
        )}
        <div className="flex flex-wrap items-center gap-2" aria-label="Set event duration">
          <span className="text-caption text-dim">Set duration</span>
          {[1, 3, 7, 14, 42].map((days) => (
            <Btn
              key={days}
              disabled={invalidDates.start}
              onClick={() => {
                setDraft({ ...draft, end: draft.start + days * DAY });
                setDateInputs((inputs) => ({
                  ...inputs,
                  end: fmtDateTimeLocalInput(draft.start + days * DAY, state.settings.localTz),
                }));
              }}
            >
              {days}d
            </Btn>
          ))}
        </div>
        <Field label="Notes">
          <TextArea
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="Rewards, links, or anything to remember…"
          />
        </Field>
        <div className="flex flex-wrap gap-5 pt-1">
          <Toggle
            checked={draft.dailyTouch}
            onChange={(v) => setDraft({ ...draft, dailyTouch: v })}
            label="Needs a daily check-in"
          />
          <Toggle
            checked={draft.notify}
            onChange={(v) => setDraft({ ...draft, notify: v })}
            label="Include in next actions"
          />
          <Toggle checked={draft.done} onChange={(v) => setDraft({ ...draft, done: v })} label="Mark done" />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          {existing && (
            <Btn
              kind="danger"
              className="mr-auto"
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                deleteEvent(existing.id);
                closeSheet();
              }}
            >
              {confirmDelete ? 'Confirm delete' : 'Delete'}
            </Btn>
          )}
          {confirmDelete && <Btn onClick={() => setConfirmDelete(false)}>Keep event</Btn>}
          <Btn onClick={closeSheet}>Cancel</Btn>
          <Btn kind="primary" onClick={save} disabled={!draft.name.trim() || !draft.gameId || badWindow}>
            {existing ? 'Save' : 'Add event'}
          </Btn>
        </div>
      </div>
    </Sheet>
  );
}
