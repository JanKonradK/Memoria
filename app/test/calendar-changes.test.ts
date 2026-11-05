import { beforeEach, expect, it } from 'vitest';
import { makeEvent, makeGame, makeState } from '../../shared/test/helpers';
import { type RemoteEventFeed } from '@memoria/shared';
import {
  planCalendarImport,
  useCalendarChanges,
  confirmCalendarChange,
  clearCalendarChanges,
} from '../src/data/calendar-changes';
import { seedFingerprint } from '../src/data/seed-events';

const now = Date.parse('2026-11-09T12:00:00Z');
const seed = {
  game: 'genshin',
  sourceKey: 'test:calendar',
  name: 'Feed event',
  type: 'event' as const,
  start: '2026-11-10 10:00',
  end: '2026-11-13 10:00',
  timezone: 'UTC',
  notes: 'Feed notes',
};
const start = Date.parse('2026-11-10T10:00Z');
const end = Date.parse('2026-11-13T10:00Z');
const feed: RemoteEventFeed = {
  version: 2,
  generatedAt: '2026-11-09T10:00:00Z',
  seedUpdated: '2026-11-09',
  revision: '1',
  events: [seed],
  withdrawn: [],
};
const game = makeGame({ presetKey: 'genshin', tz: 'UTC' });
beforeEach(() => {
  localStorage.clear();
  useCalendarChanges.setState({ baseline: {}, unread: [] });
});
it('records additions once and confirmation survives repeated deliveries', () => {
  const state = makeState({ games: [game] });
  expect(planCalendarImport(state, now, feed)).toHaveLength(1);
  const first = useCalendarChanges.getState().unread;
  expect(first).toHaveLength(1);
  expect(first[0].kind).toBe('added');
  planCalendarImport(state, now, feed);
  expect(useCalendarChanges.getState().unread).toHaveLength(1);
  confirmCalendarChange(first[0].id);
  planCalendarImport(state, now, feed);
  expect(useCalendarChanges.getState().unread).toEqual([]);
  expect(JSON.parse(localStorage.getItem('memoria-calendar-changes')!).unread).toEqual([]);
});
it('shows rescheduled and withdrawn feed values while preserving user edits', () => {
  const event = makeEvent({
    sourceKey: seed.sourceKey,
    name: seed.name,
    start,
    end,
    notes: seed.notes,
    seedHash: seedFingerprint(seed, start, end),
  });
  const state = makeState({ games: [game], events: [event] });
  planCalendarImport(state, now, feed);
  expect(useCalendarChanges.getState().unread).toEqual([]);
  const edited = { ...event, name: 'My name', notes: 'My notes' };
  const own = { ...state, events: [edited] };
  const correction = { ...feed, events: [{ ...seed, end: '2026-11-14 10:00' }] };
  expect(planCalendarImport(own, now, correction)).toEqual([]);
  expect(useCalendarChanges.getState().unread[0]).toMatchObject({
    kind: 'rescheduled',
    kept: { name: 'My name', notes: 'My notes' },
    after: { end: end + 86400000 },
  });
  planCalendarImport(own, now, { ...feed, events: [], withdrawn: [seed.sourceKey] });
  expect(useCalendarChanges.getState().unread[1]).toMatchObject({ kind: 'withdrawn', kept: { name: 'My name' } });
  expect(own.events[0]).toEqual(edited);
});
it('does not treat a partial delivery or an own edit as feed news', () => {
  const event = makeEvent({
    sourceKey: seed.sourceKey,
    name: 'My name',
    start,
    end,
    seedHash: seedFingerprint(seed, start, end),
  });
  const state = makeState({ games: [game], events: [event] });
  planCalendarImport(state, now, feed);
  planCalendarImport(state, now, { ...feed, events: [] });
  expect(useCalendarChanges.getState().unread).toEqual([]);
});
it('keeps changes from the bundle unread across a repeat import', () => {
  const state = makeState({ games: [game] });
  planCalendarImport(state, now);
  const count = useCalendarChanges.getState().unread.length;
  expect(count).toBeGreaterThan(0);
  planCalendarImport(state, now);
  expect(useCalendarChanges.getState().unread).toHaveLength(count);
});

it('clears event details with local data', () => {
  planCalendarImport(makeState({ games: [game] }), now, feed);
  clearCalendarChanges();
  expect(useCalendarChanges.getState()).toEqual({ baseline: {}, unread: [] });
  expect(JSON.parse(localStorage.getItem('memoria-calendar-changes')!)).toEqual({ baseline: {}, unread: [] });
});
it('keeps separate unread entries when same-day corrections revert', () => {
  const event = makeEvent({
    sourceKey: seed.sourceKey,
    name: seed.name,
    start,
    end,
    notes: seed.notes,
    seedHash: seedFingerprint(seed, start, end),
  });
  const state = makeState({ games: [game], events: [event] });
  const correction = { ...feed, events: [{ ...seed, end: '2026-11-14 10:00' }] };
  planCalendarImport(state, now, feed);
  planCalendarImport(state, now, correction);
  planCalendarImport(state, now, feed);
  confirmCalendarChange(useCalendarChanges.getState().unread[0].id);
  planCalendarImport(state, now, correction);
  confirmCalendarChange(useCalendarChanges.getState().unread[1].id);
  planCalendarImport(state, now, feed);
  const unread = useCalendarChanges.getState().unread;
  expect(unread).toHaveLength(2);
  expect(new Set(unread.map((item) => item.id)).size).toBe(2);
});
