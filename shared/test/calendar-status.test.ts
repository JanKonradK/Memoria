import { describe, expect, it } from 'vitest';
import { calendarBehind, versionOf } from '../src';
import { makeEvent, utc } from './helpers';

const now = utc('2026-11-13T19:00:00Z');
const DAY = 86_400_000;
const feed = (over: Parameters<typeof makeEvent>[0]) => makeEvent({ sourceKey: `k:${over?.id ?? 'x'}`, ...over });

describe('calendar behind', () => {
  it('reads the version from a maintenance row', () => {
    expect(versionOf('v4.7 update maintenance')).toBe('4.7');
    expect(versionOf('October 21 update maintenance')).toBeNull();
  });

  it('flags a version update that went live with no banner or event starting from it', () => {
    const update = utc('2026-11-11T06:00:00Z');
    const events = [
      feed({
        id: 'm',
        type: 'maintenance',
        name: 'v4.7 update maintenance',
        start: update,
        end: update + 5 * 3_600_000,
      }),
      feed({ id: 'old', type: 'banner', start: update - 20 * DAY, end: update }),
      feed({ id: 'cycle', type: 'cycle', start: update - DAY, end: update + 30 * DAY }),
    ];
    expect(calendarBehind(events, events[0]!.gameId, now)).toEqual({
      gameId: events[0]!.gameId,
      version: '4.7',
      since: update,
    });
    events.push(feed({ id: 'new', type: 'banner', start: update + 5 * 3_600_000, end: update + 21 * DAY }));
    expect(calendarBehind(events, events[0]!.gameId, now)).toBeNull();
  });

  it('flags an empty calendar, but not a game that never had feed rows', () => {
    const ended = feed({ id: 'e', type: 'event', start: now - 30 * DAY, end: now - DAY });
    expect(calendarBehind([ended], ended.gameId, now)).toMatchObject({ version: null });
    const mine = makeEvent({ id: 'mine', type: 'custom', start: now - 30 * DAY, end: now - DAY });
    expect(calendarBehind([mine], mine.gameId, now)).toBeNull();
    const coming = feed({ id: 'c', type: 'event', start: now + 2 * DAY, end: now + 9 * DAY });
    expect(calendarBehind([ended, coming], ended.gameId, now)).toBeNull();
  });
});
