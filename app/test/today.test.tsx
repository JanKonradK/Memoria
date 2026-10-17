import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { emptyState, type AppState, type Game } from '@memoria/shared';
import { beforeEach, expect, it } from 'vitest';
import { TodayPage } from '../src/components/Today';
import { useApp } from '../src/store';
import { useUI } from '../src/ui-store';
import { TooltipProvider } from '../src/components/ui';

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
  useUI.setState({ tab: 'today', sheet: null, focusedGameId: null, todayGameId: null });
});

it('groups real deadlines and keeps paused games out of the priority lists', () => {
  show(<TodayPage now={NOW} />);
  const attention = screen.getByRole('region', { name: 'Needs attention' });
  const rest = screen.getByRole('region', { name: 'Can wait' });
  expect(within(attention).getByText('Near cap')).toBeInTheDocument();
  expect(within(attention).queryByText('Paused game')).not.toBeInTheDocument();
  expect(within(rest).getByText('Can rest')).toBeInTheDocument();
  expect(within(rest).getByText('Unknown reading')).toBeInTheDocument();
  expect(row('Unknown reading')).toHaveAccessibleDescription(/No Energy reading yet/);
  expect(within(screen.getByRole('region', { name: 'Paused' })).getByText('Paused game')).toBeInTheDocument();
});

it('says the attention window once and carries no explainer copy', () => {
  show(<TodayPage now={NOW} />);
  expect(screen.getByRole('region', { name: 'Needs attention' })).toHaveTextContent('next 8h');
  expect(screen.queryByText(/Caps and unfinished routines/)).not.toBeInTheDocument();
  expect(screen.queryByText(/header status shows device sync/)).not.toBeInTheDocument();
  expect(screen.queryByText('Your games')).not.toBeInTheDocument();
});

it('says when the value was entered and labels current projections as estimates', () => {
  show(<TodayPage now={NOW} />);
  expect(row('Near cap')).toHaveAccessibleDescription(/Estimated 195 of 200 Energy, entered 2m ago/);
  expect(within(row('Near cap')).getByText('195')).toBeInTheDocument();
  expect(screen.queryByText(/live/i)).not.toBeInTheDocument();
});

it('distinguishes starting estimates and clamps age when the device clock moves back', () => {
  const state = fixture();
  state.snapshots[0]!.provenance = {
    kind: 'estimate',
    observedAt: NOW + 60_000,
    importedAt: NOW,
  };
  useApp.setState({ state });
  show(<TodayPage now={NOW} />);
  expect(row('Near cap')).toHaveAccessibleDescription(/Estimated 195 of 200 Energy, from a starting estimate/);
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
  fireEvent.click(screen.getByRole('button', { name: 'Review Paused game, paused' }));
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

it('closes the list with the Tonight summary and opens the selected game on its own page', () => {
  show(<TodayPage now={NOW} />);
  expect(screen.getByRole('region', { name: 'Across every game' })).toBeInTheDocument();
  fireEvent.click(row('Can rest'));
  fireEvent.click(screen.getByRole('button', { name: 'Open full page' }));
  expect(useUI.getState().tab).toBe('home');
  expect(useApp.getState().state.games.find((game) => game.id === useUI.getState().focusedGameId)?.name).toBe(
    'Can rest',
  );
});
