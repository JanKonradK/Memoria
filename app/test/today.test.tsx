import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { completionId, emptyState, taskPeriodKey, type AppState, type Game } from '@memoria/shared';
import { beforeEach, expect, it } from 'vitest';
import { TodayPage } from '../src/components/Today';
import { useApp } from '../src/store';
import { useUI } from '../src/ui-store';
import { TooltipProvider } from '../src/components/ui';
import { gameAccountTag } from '../src/components/roster';
import { makeTask } from '../../shared/test/helpers';

const NOW = Date.UTC(2026, 9, 6, 12);
const game = (id: string, sort: number): Game => ({
  id,
  name: id,
  short: id.slice(0, 2),
  color: '#88bbff',
  icon: '',
  platform: 'both',
  tz: 'UTC',
  dailyResetHour: 4,
  weeklyResetDay: 1,
  monthlyResetDay: 1,
  paused: false,
  sort,
  updatedAt: NOW,
});

function fixture(): AppState {
  const state = emptyState();
  state.games = [
    game('Near cap', 0),
    game('Can rest', 1),
    { ...game('Paused game', 2), paused: true },
    game('Unknown reading', 3),
  ];
  state.resources = state.games.map((item) => ({
    id: `resource-${item.id}`,
    gameId: item.id,
    name: 'Energy',
    cap: 200,
    regenMinutes: 8,
    kind: 'regen',
    sort: 0,
    updatedAt: NOW,
  }));
  state.snapshots = [
    {
      id: 'near',
      resourceId: 'resource-Near cap',
      value: 195,
      takenAt: NOW - 120_000,
      provenance: { kind: 'account', observedAt: NOW - 120_000, importedAt: NOW, provider: 'hoyolab' },
    },
    { id: 'rest', resourceId: 'resource-Can rest', value: 10, takenAt: NOW },
    { id: 'paused', resourceId: 'resource-Paused game', value: 200, takenAt: NOW },
  ];
  return state;
}

// Rows and the embedded card carry tooltips, which the real app supplies at the root.
const show = (ui: ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);
const row = (name: string) => screen.getByRole('button', { name: `Review ${name}`, exact: true });

beforeEach(() => {
  useApp.setState({ state: fixture(), loaded: true });
  useUI.setState({ tab: 'today', sheet: null, focusedGameId: null, todayGameId: null, todayView: 'games' });
});

it('lists every game in one list, soonest first, with paused games last', () => {
  show(<TodayPage now={NOW} />);
  const list = screen.getByRole('list', { name: 'Games' });
  const names = within(list)
    .getAllByRole('button')
    .map((button) => button.getAttribute('data-roster-game'));
  expect(names[0]).toBe('Near cap');
  expect(names.at(-1)).toBe('Paused game');
  expect(names).toHaveLength(4);
  expect(row('Unknown reading')).toHaveAccessibleDescription(/No Energy reading yet/);
});

it('shows only games, with no group headings or cross-game panel', () => {
  show(<TodayPage now={NOW} />);
  expect(screen.queryByRole('region', { name: 'Needs attention' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Across every game' })).not.toBeInTheDocument();
  expect(screen.queryByText('Your games')).not.toBeInTheDocument();
});

it('says when the value was entered and labels current projections as estimates', () => {
  show(<TodayPage now={NOW} />);
  expect(row('Near cap')).toHaveAccessibleDescription(/Estimated 195 of 200 Energy, entered 2m ago/);
  expect(within(row('Near cap')).getByText('195')).toBeInTheDocument();
  expect(screen.queryByText(/live/i)).not.toBeInTheDocument();
});

it('treats a starting guess as no reading, and clamps age when the device clock moves back', () => {
  const state = fixture();
  state.snapshots[0]!.provenance = {
    kind: 'estimate',
    observedAt: NOW + 60_000,
    importedAt: NOW,
  };
  useApp.setState({ state });
  show(<TodayPage now={NOW} />);
  // A guess must not project a confident cap time (F2).
  expect(row('Near cap')).toHaveAccessibleDescription(/No Energy reading yet/);
  state.snapshots[0]!.provenance = { kind: 'manual', observedAt: NOW + 60_000, importedAt: NOW };
  act(() => useApp.setState({ state: { ...state, snapshots: [...state.snapshots] } }));
  expect(row('Near cap')).toHaveAccessibleDescription(/Estimated 195 of 200 Energy, entered just now/);
});

it('puts the real, editable card beside the list instead of a link to it', () => {
  show(<TodayPage now={NOW} />);
  expect(screen.getByRole('region', { name: 'Near cap card' })).toBeInTheDocument();
  fireEvent.click(row('Can rest'));
  expect(row('Can rest')).toHaveAttribute('aria-pressed', 'true');
  const card = screen.getByRole('region', { name: 'Can rest card' });
  expect(within(card).getByLabelText('Energy current value')).toHaveValue('10');
  expect(within(card).getByRole('button', { name: 'Edit Can rest' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Open game' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Readings' })).not.toBeInTheDocument();
  // Selecting stays on Today; the card is already here.
  expect(useUI.getState().tab).toBe('today');
});

it('selects a paused game so tracking can be resumed from its card', () => {
  show(<TodayPage now={NOW} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review Paused game', description: /^Paused\. / }));
  expect(
    within(screen.getByRole('region', { name: 'Paused game card' })).getByRole('button', { name: 'Resume tracking' }),
  ).toBeInTheDocument();
});

it('offers a first game and PC connection for an empty roster', () => {
  useApp.setState({ state: emptyState() });
  show(<TodayPage now={NOW} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add a game' }));
  expect(useUI.getState().sheet).toEqual({ kind: 'addGame' });
  fireEvent.click(screen.getByRole('button', { name: 'Connect to PC' }));
  expect(useUI.getState().tab).toBe('settings');
});

it('opens the selected game on its own page', () => {
  show(<TodayPage now={NOW} />);
  fireEvent.click(row('Can rest'));
  fireEvent.click(screen.getByRole('button', { name: 'Open full page' }));
  expect(useUI.getState().tab).toBe('home');
  expect(useApp.getState().state.games.find((game) => game.id === useUI.getState().focusedGameId)?.name).toBe(
    'Can rest',
  );
});

it('opens on Steps: one list ordered by deadline, and the switch keeps the ranked games', () => {
  useUI.setState({ todayView: 'steps' });
  show(<TodayPage now={NOW} />);
  const view = screen.getByRole('group', { name: 'Today view' });
  expect(within(view).getByRole('button', { name: 'Steps' })).toHaveAttribute('aria-pressed', 'true');
  // 195 of 200 at 8 minutes a point caps within the hour; 10 of 200 caps after a day.
  const hour = screen.getByRole('region', { name: 'Within the hour' });
  expect(within(hour).getAllByRole('button', { name: /^Energy / })).toHaveLength(1);
  // Every other bar is still here to enter, under its own heading, and never counted as a step.
  const other = screen.getByRole('region', { name: 'Other bars' });
  expect(within(other).getAllByRole('button', { name: /^Energy / })).toHaveLength(2);
  expect(within(other).getByText('Enter reading')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'This week' })).toHaveTextContent('Energy caps');
  // Paused games have no steps.
  expect(screen.queryByText(/Paused game/)).not.toBeInTheDocument();
  fireEvent.click(within(view).getByRole('button', { name: 'Games' }));
  expect(useUI.getState().todayView).toBe('games');
  expect(screen.getByRole('list', { name: 'Games' })).toBeInTheDocument();
});

it('keeps a step in place while its value is typed, and commits through the store', () => {
  useUI.setState({ todayView: 'steps' });
  show(<TodayPage now={NOW} />);
  const input = within(screen.getByRole('region', { name: 'Within the hour' })).getByLabelText('Energy current value');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '20' } });
  // Still the same row while typing, even though 20 no longer caps within the day.
  expect(screen.getByRole('region', { name: 'Within the hour' })).toContainElement(input);
  fireEvent.keyDown(input, { key: 'Enter' });
  const snap = useApp
    .getState()
    .state.snapshots.find((item) => item.resourceId === 'resource-Near cap' && item.value === 20);
  expect(snap).toBeDefined();
});

it('moves Enter from one reading to the next in Steps, and Shift+Enter back', () => {
  useUI.setState({ todayView: 'steps' });
  show(<TodayPage now={NOW} />);
  const inputs = screen.getAllByLabelText('Energy current value');
  expect(inputs.length).toBeGreaterThan(1);
  const [first, second] = inputs as [HTMLElement, HTMLElement];
  act(() => second.focus());
  fireEvent.keyDown(second, { key: 'Enter', shiftKey: true });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: 'Enter' });
  expect(second).toHaveFocus();
});

it('counts only steps as done or open, never the other bars', () => {
  useUI.setState({ todayView: 'steps' });
  show(<TodayPage now={NOW} />);
  // Two other bars are listed, one of them never read, with no fake countdown.
  const other = screen.getByRole('region', { name: 'Other bars' });
  expect(within(other).getAllByText('Enter reading')).toHaveLength(1);
  expect(within(other).getByText(/not read yet/)).toBeInTheDocument();
  expect(screen.getByText('0 of 1 done')).toBeInTheDocument();
});

it('says when the order is held, and re-sorts on request', () => {
  const state = fixture();
  state.tasks = [makeTask({ id: 'commissions', gameId: 'Can rest', name: 'Commissions' })];
  useApp.setState({ state });
  useUI.setState({ todayView: 'steps' });
  show(<TodayPage now={NOW} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  const tick = screen.getByRole('button', { name: 'Mark Commissions done' });
  fireEvent.focus(tick);
  fireEvent.click(tick);
  // Ticked in place: the row stays where it was until asked.
  const pill = screen.getByRole('status');
  expect(pill).toHaveTextContent('Order paused · Re-sort now');
  fireEvent.click(within(pill).getByRole('button'));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Done today' })).toBeInTheDocument();
});

it('opens a game from its row on Games, and never ticks its dailies', () => {
  const state = fixture();
  state.tasks = [makeTask({ id: 'commissions', gameId: 'Can rest', name: 'Commissions' })];
  useApp.setState({ state });
  show(<TodayPage now={NOW} />);
  expect(screen.queryByRole('button', { name: /^Tick all Can rest dailies/ })).not.toBeInTheDocument();
  fireEvent.click(row('Can rest'));
  expect(row('Can rest')).toHaveAttribute('aria-pressed', 'true');
  expect(useApp.getState().state.completions).toHaveLength(0);
});

it('tells two accounts of one game apart everywhere', () => {
  const state = fixture();
  state.games = [
    { ...state.games[0]!, presetKey: 'genshin', tz: 'Etc/GMT-1' },
    { ...state.games[1]!, presetKey: 'genshin', tz: 'Etc/GMT+5' },
    { ...state.games[3]!, accountLabel: 'Alt' },
  ];
  expect(gameAccountTag(state.games[0]!, state.games, NOW)).toBe('EU');
  expect(gameAccountTag(state.games[1]!, state.games, NOW)).toBe('NA');
  expect(gameAccountTag(state.games[2]!, state.games, NOW)).toBe('Alt');
  // A game tracked once, with no label of its own, needs no tag.
  expect(gameAccountTag({ ...state.games[2]!, accountLabel: '  ' }, state.games, NOW)).toBe('');
  // A deleted twin no longer counts.
  expect(gameAccountTag(state.games[0]!, [state.games[0]!, { ...state.games[1]!, deleted: true }], NOW)).toBe('');
  useApp.setState({ state });
  useUI.setState({ todayView: 'steps' });
  show(<TodayPage now={NOW} />);
  const hour = screen.getByRole('region', { name: 'Within the hour' });
  expect(within(hour).getByRole('button', { name: /^Energy .* · EU/ })).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Other bars' })).getByText('Alt')).toBeInTheDocument();
});

it('offers undo after resetting a done count task or restarting a timer task on Today', () => {
  const state = fixture();
  const targetGame = state.games[1]!;
  const domains = makeTask({
    id: 'domains',
    gameId: targetGame.id,
    name: 'Domains',
    mode: 'count',
    countTarget: 3,
  });
  const expeditions = makeTask({
    id: 'expeditions',
    gameId: targetGame.id,
    name: 'Expeditions',
    mode: 'timer',
    timerDurationMinutes: 1200,
    timerEndsAt: NOW - 60_000,
  });
  const domainsPeriod = taskPeriodKey(targetGame, domains, NOW);
  state.tasks = [domains, expeditions];
  state.completions = [
    {
      id: completionId(domains.id, domainsPeriod),
      taskId: domains.id,
      periodKey: domainsPeriod,
      done: true,
      countDone: 3,
      updatedAt: NOW,
    },
  ];
  useApp.setState({ state, loaded: true });
  useUI.getState().dismissUndo();
  useUI.setState({ todayView: 'steps' });
  show(<TodayPage now={NOW} />);

  fireEvent.click(screen.getByRole('button', { name: /Done today/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Domains: 3 of 3 done/ }));
  const countNotice = useUI.getState().undoNotice;
  expect(countNotice?.text).toBe('Domains reset');
  expect(useApp.getState().state.completions.find((c) => c.taskId === domains.id)?.countDone).toBe(0);
  act(() => countNotice?.undo());
  expect(useApp.getState().state.completions.find((c) => c.taskId === domains.id)?.countDone).toBe(3);

  fireEvent.click(screen.getByRole('button', { name: /^Expeditions:/ }));
  const timerNotice = useUI.getState().undoNotice;
  expect(timerNotice?.text).toBe('Expeditions timer started');
  expect(useApp.getState().state.tasks.find((t) => t.id === expeditions.id)?.timerEndsAt).toBeGreaterThan(NOW);
  act(() => timerNotice?.undo());
  expect(useApp.getState().state.tasks.find((t) => t.id === expeditions.id)?.timerEndsAt).toBe(NOW - 60_000);
});
