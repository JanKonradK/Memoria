import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Game, GameEvent } from '@memoria/shared';
import { describe, expect, it, vi } from 'vitest';
import { TimelineList } from '../src/components/TimelineList';
import { MonthView } from '../src/components/calendar/MonthView';
import { SoonView } from '../src/components/calendar/SoonView';

// Wednesday 18 November 2026, 14:00 in Warsaw.
const NOW = Date.UTC(2026, 10, 18, 13);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TZ = 'Europe/Warsaw';
const game: Game = {
  id: 'nikke',
  name: 'NIKKE',
  short: 'NIKKE',
  color: '#ff6b70',
  icon: '',
  platform: 'both',
  tz: 'UTC',
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
    start: NOW - DAY,
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
    localTz: TZ,
    showFinished: false,
    onOpenEvent: vi.fn(),
    onToggleEvent: vi.fn(),
  };
}

describe('agenda', () => {
  it('groups rows by day with what happens and when', () => {
    render(
      <TimelineList
        {...props([
          event('Launch gift', { end: NOW + HOUR }),
          event('Clash of the Crumbs', { start: NOW + DAY, end: NOW + 20 * DAY }),
          event('Special Program', { type: 'livestream', start: NOW + 2 * DAY, end: NOW + 2 * DAY + HOUR }),
          event('Update', { type: 'maintenance', start: NOW + DAY - HOUR, end: NOW + DAY + HOUR }),
        ])}
      />,
    );
    const today = screen.getByRole('region', { name: /Today\s+Wednesday 18 November/ });
    expect(within(today).getByText('15:00')).toBeInTheDocument();
    expect(within(today).getByText('ends')).toBeInTheDocument();
    const tomorrow = screen.getByRole('region', { name: /Tomorrow\s+Thursday 19 November/ });
    expect(within(tomorrow).getByText('down')).toBeInTheDocument();
    expect(within(tomorrow).getByText(/down until 15:00/)).toBeInTheDocument();
    expect(within(tomorrow).getByText('starts')).toBeInTheDocument();
    expect(within(tomorrow).getByText(/to 8 Dec/)).toBeInTheDocument();
    const friday = screen.getByRole('region', { name: /Friday\s+20 November/ });
    expect(within(friday).getByText('live')).toBeInTheDocument();
    // Only rows that end carry a tick.
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('folds one game’s events ending together and opens the fold to tick each one', () => {
    const end = NOW + 6 * HOUR;
    const options = props(['VOLT TRIP', 'Outpost', 'Login'].map((name) => event(name, { end })));
    render(<TimelineList {...options} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText(/and 2 more NIKKE events/)).toBeInTheDocument();
    const more = screen.getByRole('button', { name: '+2 more NIKKE events ending 20:00' });
    expect(more).toHaveTextContent('+2');
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark done: NIKKE event Outpost' }));
    expect(options.onToggleEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'Outpost' }));
  });

  it('opens the quick view from a row and ticks from its own control', () => {
    const item = event('Spiral Abyss');
    const options = props([item]);
    const view = render(<TimelineList {...options} />);
    fireEvent.click(screen.getByRole('button', { name: /^15:00 ends Spiral Abyss NIKKE · event/ }));
    expect(options.onOpenEvent).toHaveBeenCalledExactlyOnceWith(item);
    const tick = screen.getByRole('checkbox', { name: 'Mark done: NIKKE event Spiral Abyss' });
    fireEvent.click(tick);
    expect(options.onToggleEvent).toHaveBeenCalledExactlyOnceWith(item);
    const done = { ...item, done: true };
    view.rerender(<TimelineList {...options} events={[done]} showFinished />);
    expect(screen.getByRole('checkbox', { name: 'Completed — Restore: NIKKE event Spiral Abyss' })).toBeChecked();
  });

  it('keeps finished events behind Show finished and explains what is hidden', () => {
    const options = props([event('Completed', { done: true }), event('Yesterday', { end: NOW - DAY })]);
    const view = render(<TimelineList {...options} />);
    expect(screen.getByText('Nothing running. 2 finished hidden.')).toBeInTheDocument();
    view.rerender(<TimelineList {...options} showFinished />);
    const finished = screen.getByRole('region', { name: /Finished\s*1/ });
    expect(within(finished).getByText('Yesterday')).toBeInTheDocument();
    expect(within(finished).getByText('17 Nov')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toHaveClass('cal-name-done');
  });

  it('tells two accounts apart and leaves out other games’ events', () => {
    const main = { ...game, accountLabel: 'Main' };
    const alt = { ...game, id: 'alt', accountLabel: 'Alt' };
    render(
      <TimelineList
        {...props([
          event('Abyss'),
          event('alt-abyss', { name: 'Abyss', gameId: alt.id }),
          event('x', { gameId: 'gone' }),
        ])}
        games={[main, alt]}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Mark done: NIKKE (Main) event Abyss' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Mark done: NIKKE (Alt) event Abyss' })).toBeInTheDocument();
    expect(screen.queryByText('x')).not.toBeInTheDocument();
  });

  it('draws the day boundary in the home time zone', () => {
    const late = event('Late', { end: Date.UTC(2026, 10, 18, 22, 30) });
    const view = render(<TimelineList {...props([late])} />);
    expect(screen.getByRole('region', { name: /Today/ })).toHaveTextContent('23:30');
    view.rerender(<TimelineList {...props([late])} localTz="Asia/Tokyo" />);
    expect(screen.getByRole('region', { name: /Thursday 19 November/ })).toHaveTextContent('07:30');
  });
});

describe('ending soon', () => {
  it('puts unfinished events in four columns, folds shared ends and hides what is done', async () => {
    const end = NOW + 6 * HOUR;
    const options = props([
      ...['VOLT TRIP', 'Outpost', 'Login'].map((name) => event(name, { end })),
      event('Marian: Queen Pick Up', { type: 'banner', bannerKind: 'character', end }),
      event('Deadly Assault', { end: NOW + 2 * DAY }),
      event('Pure Fiction', { end: NOW + 11 * DAY }),
      event('Clash', { start: NOW + DAY, end: NOW + 20 * DAY }),
      event('Done one', { end: NOW + 2 * DAY, done: true }),
    ]);
    render(<SoonView {...options} />);
    const today = await screen.findByRole('region', { name: /Today\s*4/ });
    expect(within(today).getByText('Before midnight')).toBeInTheDocument();
    expect(within(today).getByRole('button', { name: /and 2 more NIKKE events at 20:00/ })).toBeInTheDocument();
    expect(within(today).getByText('Character')).toBeInTheDocument();
    expect(within(today).getAllByText('20:00 · 6h')).toHaveLength(2);
    const week = screen.getByRole('region', { name: /By Sunday\s*2/ });
    expect(within(week).getByText('Thursday 19 to Sunday 22 November')).toBeInTheDocument();
    expect(within(week).getByText('Fri 14:00 · 2d 0h')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Next week\s*1/ })).toHaveTextContent('Sun 29 · 11d');
    expect(screen.getByRole('region', { name: /Later\s*1/ })).toHaveTextContent('From Monday 30 November');
    expect(screen.getByRole('meter', { name: 'Clash: time elapsed' })).toHaveAttribute('aria-valuenow', '0');

    fireEvent.click(within(today).getByRole('checkbox', { name: 'Mark done: all 3 NIKKE events ending 20:00' }));
    expect(options.onToggleEvent).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole('switch', { name: 'Hide what is done' }));
    expect(screen.getByRole('region', { name: /By Sunday\s*1/ })).not.toHaveTextContent('Done one');
  });
});

describe('month', () => {
  it('draws the month in Monday-first weeks with bars, today and a panel for the chosen day', async () => {
    const options = props([
      event('VOLT TRIP', { end: NOW + 6 * HOUR }),
      event('FLIGHT D-DAY', { start: NOW + DAY, end: NOW + 8 * DAY }),
      event('Update', { type: 'maintenance', start: NOW + DAY - HOUR, end: NOW + DAY + HOUR }),
    ]);
    render(<MonthView {...options} />);
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    const today = screen.getByRole('button', { name: /^Wednesday 18 November, today/ });
    expect(today).toHaveAttribute('aria-pressed', 'true');
    expect(today).toHaveAttribute('aria-current', 'date');
    expect(screen.getByRole('heading', { name: 'Wednesday 18 November' })).toBeInTheDocument();
    expect(screen.getByText('Today · 1 event running, 1 ends today')).toBeInTheDocument();
    const starts = screen.getByRole('heading', { name: 'Starts tomorrow' });
    expect(starts).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Thursday 19 November, 1 event, maintenance/ })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /^FLIGHT D-DAY, NIKKE, 19 Nov/ })[0]!);
    expect(options.onOpenEvent).toHaveBeenCalledWith(expect.objectContaining({ name: 'FLIGHT D-DAY' }));

    // Arrow keys move the chosen day; Page Down turns the month.
    fireEvent.keyDown(today, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: 'Thursday 19 November' })).toBeInTheDocument();
    expect(screen.getByText('Also that day')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'December 2026' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tuesday 1 December' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wednesday 18 November' })).toBeInTheDocument();
  });
});
