import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Game, GameEvent } from '@memoria/shared';
import { describe, expect, it, vi } from 'vitest';
import { partitionTimelineEvents, TimelineList, timelineListStatus } from '../src/components/TimelineList';

const NOW = Date.UTC(2026, 8, 8, 12);
const HOUR = 3_600_000;
const game: Game = {
  id: 'genshin',
  name: 'Genshin Impact',
  short: 'Genshin',
  color: '#f8efdb',
  icon: '',
  platform: 'both',
  tz: 'Etc/GMT-1',
  dailyResetHour: 4,
  weeklyResetDay: 1,
  monthlyResetDay: 1,
  paused: false,
  sort: 0,
  updatedAt: NOW,
};
function event(id: string, overrides: Partial<GameEvent> = {}): GameEvent {
  return {
    id,
    gameId: game.id,
    name: id,
    type: 'event',
    start: NOW - HOUR,
    end: NOW + HOUR,
    dailyTouch: false,
    notify: true,
    notes: '',
    updatedAt: NOW,
    ...overrides,
  };
}
function props(events: GameEvent[]) {
  return {
    games: [game],
    events,
    now: NOW,
    localTz: 'UTC',
    showFinished: false,
    onOpenEvent: vi.fn(),
    onToggleEvent: vi.fn(),
  };
}

describe('timeline agenda ordering', () => {
  it('moves events at their exact opening and closing times, and treats completion as finished', () => {
    expect(timelineListStatus(event('opens', { start: NOW }), NOW)).toBe('active');
    expect(timelineListStatus(event('later', { start: NOW + 1 }), NOW)).toBe('upcoming');
    expect(timelineListStatus(event('ends', { end: NOW }), NOW)).toBe('finished');
    expect(timelineListStatus(event('done', { done: true, start: NOW + HOUR }), NOW)).toBe('finished');
  });

  it('orders open windows by deadline and future windows by arrival without changing the input', () => {
    const events = [
      event('later-end', { end: NOW + 4 * HOUR }),
      event('later-arrival', { start: NOW + 3 * HOUR, end: NOW + 4 * HOUR }),
      event('older-finished', { start: NOW - 4 * HOUR, end: NOW - 3 * HOUR }),
      event('soon-end'),
      event('soon-arrival', { start: NOW + HOUR, end: NOW + 8 * HOUR }),
      event('recent-finished', { start: NOW - 4 * HOUR, end: NOW - HOUR }),
    ];
    const input = [...events];
    const buckets = partitionTimelineEvents(events, NOW);
    expect(buckets.active.map((item) => item.id)).toEqual(['soon-end', 'later-end']);
    expect(buckets.upcoming.map((item) => item.id)).toEqual(['soon-arrival', 'later-arrival']);
    expect(buckets.finished.map((item) => item.id)).toEqual(['recent-finished', 'older-finished']);
    expect(events).toEqual(input);
  });

  it('keeps equal deadlines in the same order when the feed order changes', () => {
    const events = [event('b', { name: 'Alpha' }), event('z', { name: 'Zulu' }), event('a', { name: 'Alpha' })];
    expect(partitionTimelineEvents(events, NOW).active.map((item) => item.id)).toEqual(['a', 'b', 'z']);
    expect(partitionTimelineEvents([...events].reverse(), NOW).active.map((item) => item.id)).toEqual(['a', 'b', 'z']);
  });
});

describe('timeline agenda controls', () => {
  it('keeps completed and expired events behind history and limits rows to the focused games', () => {
    const options = props([
      event('Running'),
      event('Completed', { done: true }),
      event('Expired', { end: NOW }),
      event('Other game', { gameId: 'other' }),
    ]);
    const view = render(<TimelineList {...options} />);
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
    expect(screen.queryByText('Other game')).not.toBeInTheDocument();
    view.rerender(<TimelineList {...options} showFinished />);
    const finished = screen.getByRole('region', { name: /Finished\s*2/ });
    expect(within(finished).getByText('Completed')).toBeInTheDocument();
    expect(within(finished).getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText('Other game')).not.toBeInTheDocument();
  });

  it('provides separate named Edit and completion controls and passes the selected event', () => {
    const item = event('Spiral Abyss');
    const options = props([item]);
    const view = render(<TimelineList {...options} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Mark done: Genshin Impact event Spiral Abyss' });
    expect(checkbox).not.toBeChecked();
    expect(checkbox.tagName).toBe('BUTTON');
    fireEvent.click(checkbox);
    expect(options.onToggleEvent).toHaveBeenCalledExactlyOnceWith(item);
    expect(options.onOpenEvent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Genshin Impact event: Spiral Abyss' }));
    expect(options.onOpenEvent).toHaveBeenCalledExactlyOnceWith(item);
    const done = { ...item, done: true };
    view.rerender(<TimelineList {...options} events={[done]} showFinished />);
    const restore = screen.getByRole('checkbox', { name: 'Restore: Genshin Impact event Spiral Abyss' });
    expect(restore).toBeChecked();
    fireEvent.click(restore);
    expect(options.onToggleEvent).toHaveBeenLastCalledWith(done);
  });

  it('distinguishes account controls and shows schedules in the selected local timezone', () => {
    const main = { ...game, accountLabel: 'Main' };
    const alt = { ...game, id: 'alt', accountLabel: 'Alt' };
    const options = props([event('Abyss'), event('alt-abyss', { name: 'Abyss', gameId: alt.id })]);
    render(<TimelineList {...options} games={[main, alt]} localTz="Asia/Tokyo" />);
    expect(screen.getByRole('button', { name: 'Edit Genshin Impact (Main) event: Abyss' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Genshin Impact (Alt) event: Abyss' })).toBeInTheDocument();
    expect(screen.getAllByText('8 Sep 20:00 → 22:00')).toHaveLength(2);
  });

  it('explains hidden history instead of presenting an empty list as missing data', () => {
    render(<TimelineList {...props([event('Completed', { done: true })])} />);
    expect(screen.getByText(/1 finished event is hidden.*history control/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
