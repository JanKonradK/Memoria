import { describe, expect, it } from 'vitest';
import { eventParts, eventPartsDone, inferEventParts, MAX_EVENT_PARTS, setEventPartsDone } from '../src/event-parts';
import type { GameEvent } from '../src/types';
import { makeEvent } from './helpers';

// makeEvent defaults to a banner, which is always one part; these cases need an ordinary event.
function eventOf(over: Partial<GameEvent> = {}): GameEvent {
  return makeEvent({ type: 'event', ...over });
}

describe('inferEventParts', () => {
  it.each(['banner', 'maintenance', 'livestream', 'cycle'] as const)(
    'counts a %s as one part even when its text reads like a login or a reward',
    (type) => {
      expect(inferEventParts(eventOf({ type, name: '7-day login', notes: '420 Primogems' }))).toBe(1);
    },
  );

  it('counts a plain event as one part', () => {
    expect(inferEventParts(eventOf({ type: 'event', name: 'Spring Festival', notes: '' }))).toBe(1);
  });

  it('reads an explicit day count on a login event', () => {
    expect(inferEventParts(eventOf({ name: 'Resplendent Starlight — 7-day login rewards' }))).toBe(7);
    expect(inferEventParts(eventOf({ name: '14 Day Sign-In' }))).toBe(14);
  });

  it('accepts the day count at both ends of its range', () => {
    expect(inferEventParts(eventOf({ name: '1-day login' }))).toBe(1);
    expect(inferEventParts(eventOf({ name: '60-day login' }))).toBe(60);
  });

  it('falls back to 7 when the day count is out of range', () => {
    expect(inferEventParts(eventOf({ name: '61-day login' }))).toBe(7);
    expect(inferEventParts(eventOf({ name: '120 days login' }))).toBe(7);
  });

  it.each(['login', 'log-in', 'log in', 'sign-in', 'sign in', 'check-in', 'check in', 'daily reward'])(
    'counts a login event written as "%s" with no day count as 7 parts',
    (keyword) => {
      expect(inferEventParts(eventOf({ name: `Monthly ${keyword} bonus` }))).toBe(7);
    },
  );

  it('does not read a day count as a login unless a login keyword is present', () => {
    expect(inferEventParts(eventOf({ name: 'Spend 14 days in the Abyss' }))).toBe(1);
  });

  it('does not match a login keyword inside a longer word', () => {
    expect(inferEventParts(eventOf({ name: 'Redesign in progress' }))).toBe(1);
  });

  it('reads the notes as well as the name', () => {
    expect(inferEventParts(eventOf({ name: 'Login Calendar', notes: '' }))).toBe(7);
    expect(inferEventParts(eventOf({ name: 'Anniversary', notes: 'Daily reward for 7 days' }))).toBe(7);
  });

  it('counts 420 Primogems as 5 parts', () => {
    expect(inferEventParts(eventOf({ name: 'Event Gift', notes: '420 Primogems' }))).toBe(5);
  });

  it('counts 1,600 Primogems as 4 parts', () => {
    expect(inferEventParts(eventOf({ name: 'Event Gift', notes: '1,600 Primogems' }))).toBe(4);
  });

  it('counts 100 Primogems as 1 part', () => {
    expect(inferEventParts(eventOf({ name: 'Event Gift', notes: '100 Primogems' }))).toBe(1);
  });

  it('places the reward thresholds at 300 and 1000', () => {
    expect(inferEventParts(eventOf({ notes: '299 Primogems' }))).toBe(1);
    expect(inferEventParts(eventOf({ notes: '300 Primogems' }))).toBe(5);
    expect(inferEventParts(eventOf({ notes: '999 Primogems' }))).toBe(5);
    expect(inferEventParts(eventOf({ notes: '1000 Primogems' }))).toBe(4);
  });

  it.each([
    'Stellar Jades',
    'Polychromes',
    'Astrites',
    'Oneiric Shards',
    'Gems',
    'Jewels',
    'Diamonds',
    'Carats',
    'Origeometry',
    'Annulith',
  ])('counts a reward listed in %s', (currency) => {
    expect(inferEventParts(eventOf({ notes: `2,000 ${currency}` }))).toBe(4);
  });

  it('uses the largest reward when several are listed', () => {
    expect(inferEventParts(eventOf({ notes: '100 Primogems and 420 Stellar Jades' }))).toBe(5);
    expect(inferEventParts(eventOf({ notes: '420 Primogems and 1,600 Gems' }))).toBe(4);
  });

  it('lets a login day count win over a reward it lists', () => {
    expect(inferEventParts(eventOf({ name: '7-day login', notes: '1,600 Primogems' }))).toBe(7);
  });
});

describe('eventParts', () => {
  it('uses the stored count over the inferred one', () => {
    expect(eventParts(eventOf({ name: '7-day login', parts: 3 }))).toBe(3);
  });

  it('uses the inferred count when none is stored', () => {
    expect(eventParts(eventOf({ name: '7-day login' }))).toBe(7);
  });

  it('clamps a stored count to at least 1', () => {
    expect(eventParts(eventOf({ parts: 0 }))).toBe(1);
    expect(eventParts(eventOf({ parts: -5 }))).toBe(1);
  });

  it('clamps a stored count to at most MAX_EVENT_PARTS', () => {
    expect(MAX_EVENT_PARTS).toBe(60);
    expect(eventParts(eventOf({ parts: 99 }))).toBe(60);
  });

  it('rounds a fractional stored count', () => {
    expect(eventParts(eventOf({ parts: 2.6 }))).toBe(3);
  });

  it('ignores a non-finite stored count and infers instead', () => {
    expect(eventParts(eventOf({ name: '7-day login', parts: Number.NaN }))).toBe(7);
  });
});

describe('eventPartsDone', () => {
  it('counts every part when the event is done', () => {
    expect(eventPartsDone(eventOf({ name: '7-day login', parts: 7, partsDone: 2, done: true }))).toBe(7);
  });

  it('counts every inferred part for an event marked done before parts existed', () => {
    expect(eventPartsDone(eventOf({ name: '7-day login', done: true }))).toBe(7);
  });

  it('returns the stored ticks when the event is not done', () => {
    expect(eventPartsDone(eventOf({ name: '7-day login', parts: 7, partsDone: 2, done: false }))).toBe(2);
  });

  it('clamps ticks above the total to the total', () => {
    expect(eventPartsDone(eventOf({ parts: 3, partsDone: 9 }))).toBe(3);
  });

  it('clamps negative ticks to 0', () => {
    expect(eventPartsDone(eventOf({ parts: 3, partsDone: -2 }))).toBe(0);
  });

  it('treats NaN ticks as 0', () => {
    expect(eventPartsDone(eventOf({ parts: 3, partsDone: Number.NaN }))).toBe(0);
  });

  it('treats absent ticks as 0', () => {
    expect(eventPartsDone(eventOf({ parts: 3 }))).toBe(0);
  });

  it('rounds fractional ticks', () => {
    expect(eventPartsDone(eventOf({ parts: 7, partsDone: 2.4 }))).toBe(2);
  });
});

describe('setEventPartsDone', () => {
  it('saves a partial count below the total without marking the event done', () => {
    expect(setEventPartsDone(eventOf({ name: '7-day login' }), 2)).toEqual({ partsDone: 2, done: false });
  });

  it('marks the event done when the count reaches the total', () => {
    expect(setEventPartsDone(eventOf({ name: '7-day login' }), 7)).toEqual({ partsDone: 7, done: true });
  });

  it('clamps a count above the total to the total and marks it done', () => {
    expect(setEventPartsDone(eventOf({ parts: 3 }), 9)).toEqual({ partsDone: 3, done: true });
  });

  it('clamps a negative count to 0 and leaves the event open', () => {
    expect(setEventPartsDone(eventOf({ parts: 3 }), -1)).toEqual({ partsDone: 0, done: false });
  });

  it('saves 0 for a NaN count', () => {
    expect(setEventPartsDone(eventOf({ parts: 3 }), Number.NaN)).toEqual({ partsDone: 0, done: false });
  });

  it('reopens the event when a tick is taken back below the total', () => {
    expect(setEventPartsDone(eventOf({ parts: 3 }), 2)).toEqual({ partsDone: 2, done: false });
  });
});
