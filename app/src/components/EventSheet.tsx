import { useEffect, useId, useState } from 'react';
import { presetForGame, type EventType, type BannerKind } from '@memoria/shared';
import { eventCategory, eventBannerKind } from '../event-category';
import { calendarSchedule } from '../event-schedule';
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
  const trackingHelp = useId();
  const formId = useId();
  const dateErrorId = useId();

  const games = rosterGames(state.games);
  const existing = eventId ? state.events.find((e) => e.id === eventId && !e.deleted) : undefined;
  const unavailable = Boolean(eventId && !existing);
  const calendar = existing ? calendarSchedule(existing) : undefined;
  const [draftZone, setDraftZone] = useState(state.settings.localTz);

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
    start: fmtDateTimeLocalInput(draft.start, draftZone),
    end: fmtDateTimeLocalInput(draft.end, draftZone),
  }));
  const [savedDraft, setSavedDraft] = useState(() => JSON.stringify({ draft, dateInputs }));
  const dirty = JSON.stringify({ draft, dateInputs }) !== savedDraft;
  const invalidDates = {
    start: parseDateTimeLocalInput(dateInputs.start, draftZone) == null,
    end: parseDateTimeLocalInput(dateInputs.end, draftZone) == null,
  };
  // One verdict on the window, read by the error line, the save button and save
  // itself — three places that must never disagree about whether this is savable.
  const badWindow = invalidDates.start || invalidDates.end || draft.end <= draft.start;
  const selectedGame = games.find((game) => game.id === draft.gameId);
  const validDraft = Boolean(selectedGame && draft.name.trim() && !badWindow);

  /** A typed date keeps the user's text even when it does not parse yet. */
  const setDate = (edge: 'start' | 'end', text: string) => {
    const parsed = parseDateTimeLocalInput(text, draftZone);
    setDateInputs((inputs) => ({ ...inputs, [edge]: text }));
    if (parsed != null) setDraft((current) => ({ ...current, [edge]: parsed }));
  };

  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setDraftZone(state.settings.localTz);
    const nextDates = {
      start: fmtDateTimeLocalInput(existing?.start ?? Date.now(), state.settings.localTz),
      end: fmtDateTimeLocalInput(existing?.end ?? Date.now() + 7 * DAY, state.settings.localTz),
    };
    setDateInputs(nextDates);
    if (existing) {
      const nextDraft: typeof draft = {
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
      };
      setDraft(nextDraft);
      setSavedDraft(JSON.stringify({ draft: nextDraft, dateInputs: nextDates }));
    } else {
      const nextDraft = {
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
      };
      setDraft(nextDraft);
      setSavedDraft(JSON.stringify({ draft: nextDraft, dateInputs: nextDates }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eventId]);

  const save = (asNew = false) => {
    if (!validDraft || (unavailable && !asNew)) return;
    upsertEvent({
      ...(existing && !asNew ? { id: existing.id } : {}),
      ...draft,
      category: selectedGame && presetForGame(selectedGame)?.key === 'genshin' ? draft.category : undefined,
      bannerKind: draft.type === 'banner' ? draft.bannerKind || undefined : undefined,
      name: draft.name.trim(),
    });
    closeSheet();
  };

  return (
    <Sheet
      open={open}
      onClose={closeSheet}
      dirty={dirty}
      title={eventId ? 'Edit event' : 'New event'}
      footer={
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
          <Btn
            onClick={() => {
              if (!dirty || window.confirm('Discard your unsaved changes?')) closeSheet();
            }}
          >
            Cancel
          </Btn>
          <Btn kind="primary" type="submit" form={formId} disabled={!validDraft || unavailable}>
            {eventId ? 'Save' : 'Add event'}
          </Btn>
          {unavailable && (
            <Btn kind="primary" onClick={() => save(true)} disabled={!validDraft}>
              Add as new event
            </Btn>
          )}
        </div>
      }
    >
      <form
        id={formId}
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        {unavailable && (
          <p role="alert" className="text-meta text-warn-fg">
            This event is no longer available. Your draft is kept here. Add it as a new event to save it.
          </p>
        )}
        {!selectedGame && (
          <p role="alert" className="text-meta text-warn-fg">
            {games.length ? 'Choose an available game to save this event.' : 'Add a game before creating an event.'}
          </p>
        )}
        <fieldset className="min-w-0 space-y-3">
          <legend className="mb-3 text-body font-semibold">Event details</legend>
          <Field label="Game">
            <Select value={draft.gameId} onChange={(e) => setDraft({ ...draft, gameId: e.target.value })}>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.accountLabel ? ` · ${g.accountLabel}` : ''}
                  {g.paused ? ' · Paused' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name">
            <TextInput
              placeholder="e.g. Lantern Rite, Character banner…"
              maxLength={500}
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
              games.some((game) => game.id === draft.gameId && presetForGame(game)?.key === 'genshin') && (
                <Field label="Genshin world" className="sm:col-span-2">
                  <Select
                    value={draft.category}
                    onChange={(event) => setDraft({ ...draft, category: event.target.value as 'teyvat' | 'miliastra' })}
                  >
                    <option value="teyvat">Teyvat</option>
                    <option value="miliastra">Miliastra Wonderland</option>
                  </Select>
                </Field>
              )}
          </div>
        </fieldset>
        <fieldset className="min-w-0 space-y-3 border-t border-line-edge pt-4">
          <legend className="pr-2 text-body font-semibold">Schedule</legend>
          <p className="text-caption text-muted">Dates and times use {draftZone}.</p>
          {calendar && (
            <p className="text-caption text-muted">
              Official calendar: {calendar.label} ({calendar.zone}). The fields below let you set personal times.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Starts">
              <TextInput
                type="datetime-local"
                value={dateInputs.start}
                onChange={(e) => setDate('start', e.target.value)}
                aria-invalid={invalidDates.start || undefined}
                aria-describedby={invalidDates.start ? dateErrorId : undefined}
              />
            </Field>
            <Field label="Ends">
              <TextInput
                type="datetime-local"
                value={dateInputs.end}
                onChange={(e) => setDate('end', e.target.value)}
                aria-invalid={invalidDates.end || draft.end <= draft.start || undefined}
                aria-describedby={badWindow ? dateErrorId : undefined}
              />
            </Field>
          </div>
          {badWindow ? (
            <p id={dateErrorId} role="alert" className="text-caption text-danger-fg">
              Enter valid dates. The end must be after the start.
            </p>
          ) : (
            <p className="text-caption text-dim">Duration: {fmtDur(draft.end - draft.start)}</p>
          )}
          <div className="flex flex-wrap items-center gap-2" aria-label="Set event duration">
            <span className="text-caption text-muted">End after</span>
            {[1, 3, 7, 14, 42].map((days) => (
              <Btn
                key={days}
                aria-label={`End ${days} ${days === 1 ? 'day' : 'days'} after start`}
                disabled={invalidDates.start}
                onClick={() => {
                  setDraft({ ...draft, end: draft.start + days * DAY });
                  setDateInputs((inputs) => ({
                    ...inputs,
                    end: fmtDateTimeLocalInput(draft.start + days * DAY, draftZone),
                  }));
                }}
              >
                {days}d
              </Btn>
            ))}
          </div>
        </fieldset>
        <Field label="Notes">
          <TextArea
            maxLength={20_000}
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="Rewards, links, or anything to remember…"
          />
        </Field>
        <fieldset className="min-w-0 space-y-4 border-t border-line-edge pt-4">
          <legend className="pr-2 text-body font-semibold">Tracking</legend>
          {games.find((game) => game.id === draft.gameId)?.paused && (
            <p className="text-caption text-muted">
              This game is paused. Saved events stay hidden from Timeline until you resume tracking.
            </p>
          )}
          <div>
            <Toggle
              checked={draft.dailyTouch}
              onChange={(v) => setDraft({ ...draft, dailyTouch: v })}
              label="Needs a daily check-in"
              ariaDescribedBy={`${trackingHelp}-daily`}
            />
            <p id={`${trackingHelp}-daily`} className="mt-1 text-caption text-muted">
              Keep this event near the top of the card while it is active.
            </p>
          </div>
          <div>
            <Toggle
              checked={draft.notify}
              onChange={(v) => setDraft({ ...draft, notify: v })}
              label="Include in next actions"
              ariaDescribedBy={`${trackingHelp}-next`}
            />
            <p id={`${trackingHelp}-next`} className="mt-1 text-caption text-muted">
              Use its end time when choosing the game’s next action.
            </p>
          </div>
          <div>
            <Toggle
              checked={draft.done}
              onChange={(v) => setDraft({ ...draft, done: v })}
              label="Mark done"
              ariaDescribedBy={`${trackingHelp}-done`}
            />
            <p id={`${trackingHelp}-done`} className="mt-1 text-caption text-muted">
              Move this event to Finished. Its details stay saved.
            </p>
          </div>
        </fieldset>
      </form>
    </Sheet>
  );
}
