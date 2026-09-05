import { createElement, type ReactElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { emptyState, type Game, type GameUrgency, type Task } from '@memoria/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameControlsView, type GameControlActions } from '../src/components/GameCard';
import { TooltipProvider } from '../src/components/ui';
import { useApp } from '../src/store';

const HOUR = 3_600_000;
const now = Date.UTC(2026, 8, 4, 12);

const game: Game = {
  id: 'hsr',
  name: 'Honkai: Star Rail',
  short: 'HSR',
  color: '#ff8fc0',
  icon: '',
  platform: 'both',
  tz: 'Etc/GMT-1',
  dailyResetHour: 4,
  weeklyResetDay: 1,
  monthlyResetDay: 1,
  paused: false,
  sort: 0,
  updatedAt: 1,
};

function task(patch: Partial<Task>): Task {
  return {
    id: 'assignments',
    gameId: game.id,
    name: 'Assignments',
    cadence: 'daily',
    intervalDays: 1,
    anchorAt: 0,
    sort: 0,
    mode: 'timer',
    timerDurationMinutes: 20 * 60,
    updatedAt: 1,
    ...patch,
  };
}

const actions: GameControlActions = {
  setTaskDone: vi.fn(),
  restartTaskTimer: vi.fn(),
  advanceTaskTimer: vi.fn(),
  setTaskCount: vi.fn(),
  setEnergy: vi.fn(),
  adjustEnergy: vi.fn(),
};

function renderCard(element: ReactElement) {
  return render(createElement(TooltipProvider, null, element));
}

function renderTasks(tasks: Task[], completions: ReturnType<typeof emptyState>['completions'] = []) {
  const state = { ...emptyState(), games: [game], tasks, completions };
  useApp.setState({ state });
  const entry: GameUrgency = { game, next: null, actions: [] };
  renderCard(
    createElement(GameControlsView, {
      entry,
      state,
      actions,
      now,
      onEditGame: () => {},
      onOpenEvent: () => {},
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
  useApp.setState({ state: emptyState() });
});

describe('dispatch task rows', () => {
  it('asks to be collected when the run has come back, rather than reporting itself done', () => {
    // The bug this replaces: a returned dispatch rendered struck through with a
    // filled tick — i.e. finished — at exactly the moment there was something to
    // go and do.
    renderTasks([task({ timerEndsAt: now - HOUR })]);

    expect(screen.getByText('Collect')).toBeInTheDocument();
    expect(screen.getByText('Assignments')).not.toHaveAttribute('data-done', 'true');
    expect(screen.getByRole('button', { name: /collect and resend/ })).toBeInTheDocument();
  });

  it('states the return time, not an urgency countdown, while a run is out', () => {
    renderTasks([task({ timerEndsAt: now + 6 * HOUR })]);

    expect(screen.getByText('back 6h 00m')).toBeInTheDocument();
    expect(screen.queryByText('Collect')).not.toBeInTheDocument();
  });

  it('counts toward the day only once the collect is actually recorded', () => {
    // A timer that ran out overnight used to satisfy the new day's period on
    // its own, so the card opened with the day already part-done.
    const returned = task({ timerEndsAt: now - HOUR });
    renderTasks([returned]);
    expect(screen.getAllByText('0/1').length).toBeGreaterThan(0);
    expect(screen.queryByText('1/1')).not.toBeInTheDocument();
    cleanup();

    renderTasks(
      [returned],
      [{ id: 'assignments|D2026-09-04', taskId: 'assignments', periodKey: 'D2026-09-04', done: true, updatedAt: now }],
    );
    expect(screen.getAllByText('1/1').length).toBeGreaterThan(0);
  });

  it('records a collect-and-resend as one act', () => {
    renderTasks([task({ timerEndsAt: now - HOUR })]);

    fireEvent.click(screen.getByRole('button', { name: /collect and resend/ }));

    expect(actions.restartTaskTimer).toHaveBeenCalledTimes(1);
  });
});

describe('cadence bands', () => {
  it('names each cadence once instead of tagging every row', () => {
    renderTasks([
      task({ id: 'daily-1', name: 'Daily Training', mode: 'check', timerDurationMinutes: undefined }),
      task({ id: 'weekly-1', name: 'Echo of War', cadence: 'weekly', mode: 'check', timerDurationMinutes: undefined }),
      task({
        id: 'weekly-2',
        name: 'Divergent Universe',
        cadence: 'weekly',
        mode: 'check',
        timerDurationMinutes: undefined,
      }),
    ]);

    expect(screen.getAllByText('Weekly')).toHaveLength(1);
    expect(screen.getByText('Daily')).toBeInTheDocument();
    // One tally per band, not one countdown per row.
    expect(screen.getByText('0/2')).toBeInTheDocument();
  });

  it('leads a band with the tasks that pay pull currency', () => {
    renderTasks([
      task({ id: 'side', name: 'Side chore', mode: 'check', timerDurationMinutes: undefined, sort: 0 }),
      task({ id: 'core', name: 'Core daily', mode: 'check', timerDurationMinutes: undefined, sort: 1, core: true }),
    ]);

    const names = screen.getAllByRole('button').map((button) => button.textContent ?? '');
    expect(names.findIndex((name) => name.includes('Core daily'))).toBeLessThan(
      names.findIndex((name) => name.includes('Side chore')),
    );
  });
});
