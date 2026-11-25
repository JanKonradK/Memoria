import { describe, expect, it } from 'vitest';
import {
  EVENT_STEPS,
  eventPartsDone,
  eventPartsPatch,
  eventProgress,
  eventProgressPatch,
  nextEventProgress,
  setEventProgress,
} from '../src/event-parts';
import type { GameEvent } from '../src/types';
import { makeEvent } from './helpers';

function eventOf(over: Partial<GameEvent> = {}): GameEvent {
  return makeEvent({ type: 'event', ...over });
}

describe('event progress', () => {
  it('has the same three states for every event, whatever its text says', () => {
    for (const name of ['7-day login', 'Event Gift — 420 Primogems', 'Spiral Abyss', 'Maintenance']) {
      expect(eventProgress(eventOf({ name }))).toBe('none');
    }
  });

  it('reads done as done, ticked parts short of done as partial, and nothing as not started', () => {
    expect(eventProgress(eventOf({ done: true }))).toBe('done');
    expect(eventProgress(eventOf({ done: true, partsDone: 0 }))).toBe('done');
    expect(eventProgress(eventOf({ partsDone: 3, parts: 7 }))).toBe('partial');
    expect(eventProgress(eventOf({ partsDone: 0 }))).toBe('none');
    expect(eventProgress(eventOf({ partsDone: Number.NaN }))).toBe('none');
  });

  it('counts steps as 0, 1 and 2', () => {
    expect(eventPartsDone(eventOf())).toBe(0);
    expect(eventPartsDone(eventOf({ partsDone: 5, parts: 7 }))).toBe(1);
    expect(eventPartsDone(eventOf({ done: true }))).toBe(EVENT_STEPS);
  });

  it('saves each state and clears an old part count', () => {
    expect(setEventProgress('none')).toEqual({ parts: undefined, partsDone: 0, done: false });
    expect(setEventProgress('partial')).toEqual({ parts: undefined, partsDone: 1, done: false });
    expect(setEventProgress('done')).toEqual({ parts: undefined, partsDone: 2, done: true });
  });

  it('cycles not started, partly done, done, then back', () => {
    let event = eventOf();
    const seen: string[] = [];
    for (let step = 0; step < 3; step++) {
      const next = nextEventProgress(event);
      seen.push(next);
      event = { ...event, ...setEventProgress(next) };
    }
    expect(seen).toEqual(['partial', 'done', 'none']);
  });

  it('keeps a stored part count when the state changes', () => {
    const story = eventOf({ parts: 5, partsDone: 3 });
    expect(eventProgressPatch(story, 'done')).toEqual({ parts: 5, partsDone: 5, done: true });
    expect(eventProgressPatch(story, 'partial')).toEqual({ parts: 5, partsDone: 3, done: false });
    expect(eventProgressPatch(eventOf({ parts: 5, partsDone: 5, done: true }), 'partial')).toEqual({
      parts: 5,
      partsDone: 4,
      done: false,
    });
    expect(eventProgressPatch(eventOf({ parts: 5 }), 'partial')).toEqual({ parts: 5, partsDone: 1, done: false });
    expect(eventProgressPatch(story, 'none')).toEqual({ parts: 5, partsDone: 0, done: false });
    // Without parts, the plain three states.
    expect(eventProgressPatch(eventOf(), 'done')).toEqual(setEventProgress('done'));
    expect(eventProgressPatch(eventOf({ parts: 0 }), 'partial')).toEqual(setEventProgress('partial'));
  });

  it('clamps a part tally and calls it done once every part is', () => {
    expect(eventPartsPatch({ parts: 4 }, 2)).toEqual({ parts: 4, partsDone: 2, done: false });
    expect(eventPartsPatch({ parts: 4 }, 4)).toEqual({ parts: 4, partsDone: 4, done: true });
    expect(eventPartsPatch({ parts: 4 }, 9)).toEqual({ parts: 4, partsDone: 4, done: true });
    expect(eventPartsPatch({ parts: 4 }, -2)).toEqual({ parts: 4, partsDone: 0, done: false });
    expect(eventPartsPatch({}, 1)).toEqual({ partsDone: 1, done: false });
    expect(eventPartsPatch({}, EVENT_STEPS)).toEqual({ partsDone: EVENT_STEPS, done: true });
  });
});
