import { fireEvent, render, screen, within } from '@testing-library/react';
import { emptyState, type GameEvent } from '@memoria/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { makeEvent, makeGame } from '../../shared/test/helpers';
import { TimelinePage } from '../src/components/Timeline';
import { TooltipProvider } from '../src/components/ui';
import { useApp } from '../src/store';
import { useUI } from '../src/ui-store';
import { barCountdown, collapsedSummary, rangeWindow, shortLeft } from '../src/timeline-window';

const NOW = Date.UTC(2026, 10, 18, 12);
const DAY = 86_400_000;
const HOUR = 3_600_000;
const game = makeGame({ id: 'g', name: 'Testland', updatedAt: NOW });
const other = makeGame({ id: 'h', name: 'Otherland', short: 'OL', sort: 1, updatedAt: NOW });

function show(events: GameEvent[]) {
  useApp.setState({ state: { ...emptyState(), games: [game, other], events } });
  return render(
    <TooltipProvider>
      <TimelinePage now={NOW} />
    </TooltipProvider>,
  );
}

afterEach(() => {
  useApp.setState({ state: emptyState() });
  useUI.setState({ timelineView: null, timelineShowFinished: false, timelineHiddenGameIds: [], timelineRange: null });
});

const rowOf = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-event-id="${id}"]`)?.closest('.tl-row');

describe('the packed timeline', () => {
  it('puts events that do not overlap on one row, and banners on their own', () => {
    const { container } = show([
      makeEvent({ id: 'first', gameId: game.id, name: 'First', start: NOW - 3 * DAY, end: NOW + DAY }),
      makeEvent({ id: 'next', gameId: game.id, name: 'Next', start: NOW + 2 * DAY, end: NOW + 9 * DAY }),
      makeEvent({ id: 'over', gameId: game.id, name: 'Overlaps', start: NOW, end: NOW + 4 * DAY }),
      makeEvent({ id: 'banner', gameId: game.id, name: 'Banner', type: 'banner', start: NOW - DAY, end: NOW + DAY }),
    ]);
    expect(rowOf(container, 'first')).toBe(rowOf(container, 'next'));
    expect(rowOf(container, 'over')).not.toBe(rowOf(container, 'first'));
    expect(container.querySelector('[data-timeline-event-group="banners"] [data-event-id="banner"]')).not.toBeNull();
    expect(screen.getByText('Banners')).toBeInTheDocument();
  });

  it('ticks an event done from its bar, and it stays faded on its row', () => {
    const { container } = show([
      makeEvent({ id: 'e', gameId: game.id, name: 'Daily login', start: NOW - DAY, end: NOW + DAY }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Mark Daily login done' }));
    expect(useApp.getState().state.events[0]!.done).toBe(true);
    expect(container.querySelector('[data-event-id="e"]')).toHaveAttribute('data-done', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Restore Daily login' }));
    expect(useApp.getState().state.events[0]!.done).toBe(false);
  });

  it('opens the quick view from a bar', () => {
    show([makeEvent({ id: 'e', gameId: game.id, name: 'Story', start: NOW - DAY, end: NOW + DAY })]);
    fireEvent.click(screen.getByRole('button', { name: 'Open Testland event: Story' }));
    expect(useUI.getState().sheet).toEqual({ kind: 'eventPeek', eventId: 'e' });
  });

  it('collapses a game to one summary line', () => {
    show([
      makeEvent({ id: 'a', gameId: game.id, name: 'VOLT TRIP', start: NOW - DAY, end: NOW + 5 * HOUR }),
      makeEvent({ id: 'b', gameId: game.id, name: 'Other', start: NOW - DAY, end: NOW + 6 * HOUR }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: /^Testland 2 events/, expanded: true }));
    expect(screen.getByText('VOLT TRIP and 1 more end today')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Testland event: Other' })).not.toBeInTheDocument();
  });

  it('hides a game from its logo in the filter and shows it again', () => {
    show([makeEvent({ id: 'e', gameId: other.id, name: 'Elsewhere', start: NOW - DAY, end: NOW + DAY })]);
    const toggle = within(screen.getByRole('group', { name: 'Games shown' })).getByRole('button', {
      name: /^Otherland/,
    });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'Open Otherland event: Elsewhere' })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Open Otherland event: Elsewhere' })).toBeInTheDocument();
  });

  it('changes range and steps through weeks, with Today bringing now back', () => {
    const { container } = show([]);
    const days = () => container.querySelectorAll('[data-timeline-tick]').length;
    expect(days()).toBe(28);
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(days()).toBe(7);
    expect(container.querySelector('[data-timeline-now]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Later week' }));
    expect(container.querySelector('[data-timeline-now]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show today' }));
    expect(container.querySelector('[data-timeline-now]')).not.toBeNull();
  });

  it('draws maintenance as a band and a livestream as a milestone, both openable', () => {
    const { container } = show([
      makeEvent({
        id: 'm',
        gameId: game.id,
        name: 'v3.4 maintenance',
        type: 'maintenance',
        start: NOW + DAY,
        end: NOW + DAY + 5 * HOUR,
      }),
      makeEvent({
        id: 's',
        gameId: game.id,
        name: '3.4 Special Program',
        type: 'livestream',
        start: NOW + 2 * DAY,
        end: NOW + 2 * DAY + HOUR,
      }),
      makeEvent({
        id: 'p',
        gameId: game.id,
        name: '3.5 Special Program — predicted window',
        type: 'livestream',
        start: NOW + 9 * DAY,
        end: NOW + 12 * DAY,
      }),
    ]);
    expect(container.querySelector('.tl-maint[data-event-id="m"]')).not.toBeNull();
    expect(container.querySelector('.tl-milestone[data-event-id="s"]')).not.toBeNull();
    expect(container.querySelector('.tl-bar[data-event-id="p"]')).toHaveAttribute('data-predicted', 'true');
    expect(screen.getByRole('button', { name: 'Open Testland event: v3.4 maintenance' })).toBeInTheDocument();
  });
});

describe('timeline wording', () => {
  const tz = 'UTC';
  it('counts down inside the bar in urgency tones', () => {
    expect(barCountdown({ start: NOW - DAY, end: NOW + 5 * HOUR }, NOW, NOW + 20 * DAY, tz)).toEqual({
      label: '5h',
      tone: 'rose',
    });
    expect(barCountdown({ start: NOW - DAY, end: NOW + 2 * DAY + 4 * HOUR }, NOW, NOW + 20 * DAY, tz)).toEqual({
      label: '2d 4h',
      tone: 'warn',
    });
    expect(barCountdown({ start: NOW + 2 * DAY, end: NOW + 9 * DAY }, NOW, NOW + 20 * DAY, tz).label).toBe('in 2d 0h');
    expect(barCountdown({ start: NOW - DAY, end: NOW + 40 * DAY }, NOW, NOW + 20 * DAY, tz).label).toBe('to 28 Dec');
    expect(barCountdown({ start: NOW - DAY, end: NOW + DAY, done: true }, NOW, NOW + 20 * DAY, tz)).toEqual({
      label: 'done',
      tone: 'ok',
    });
    expect(shortLeft(12 * DAY + 5 * HOUR)).toBe('12d');
  });

  it('summarises a collapsed game by what ends first', () => {
    const e = (name: string, end: number) => ({ name, type: 'event', start: NOW - DAY, end });
    expect(collapsedSummary([e('A', NOW + HOUR), e('B', NOW + 2 * HOUR), e('C', NOW + 3 * DAY)], NOW, tz)).toBe(
      'A and 1 more end today',
    );
    expect(collapsedSummary([e('A', NOW + DAY)], NOW, tz, true)).toBe('A ends tomorrow at 12:00');
    expect(collapsedSummary([], NOW, tz)).toBe('Nothing running');
  });

  it('opens a week on yesterday and four weeks a week back', () => {
    const week = rangeWindow(NOW, tz, 'week');
    expect(week.start).toBe(Date.UTC(2026, 10, 17));
    expect(week.end - week.start).toBe(7 * DAY);
    const month = rangeWindow(NOW, tz, 'month', 1);
    expect(month.start).toBe(Date.UTC(2026, 10, 18));
    expect(month.end - month.start).toBe(28 * DAY);
  });
});
