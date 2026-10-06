import { fireEvent, render, screen, within } from '@testing-library/react';
import { emptyState, type AppState, type Game } from '@memoria/shared';
import { beforeEach, expect, it, vi } from 'vitest';
import { TodayPage } from '../src/components/Today';
import { useApp } from '../src/store';
import { useUI } from '../src/ui-store';

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

beforeEach(() => {
  useApp.setState({ state: fixture(), loaded: true });
  useUI.setState({ tab: 'today', sheet: null, focusedGameId: null });
});

it('groups real deadlines and keeps paused games out of the priority lists', () => {
  render(<TodayPage now={NOW} />);
  const attention = screen.getByRole('region', { name: 'Needs attention' });
  const rest = screen.getByRole('region', { name: 'Can wait' });
  expect(within(attention).getByText('Near cap')).toBeInTheDocument();
  expect(within(attention).queryByText('Paused game')).not.toBeInTheDocument();
  expect(within(rest).getByText('Can rest')).toBeInTheDocument();
  expect(within(rest).getByText('Unknown reading')).toBeInTheDocument();
  expect(within(rest).getByText('No reading yet')).toBeInTheDocument();
});

it('uses the observation time and labels current projections as estimates', () => {
  render(<TodayPage now={NOW} />);
  const attention = screen.getByRole('region', { name: 'Needs attention' });
  expect(within(attention).getByText('Account · 2m ago · Estimated 195/200')).toBeInTheDocument();
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
  render(<TodayPage now={NOW} />);
  expect(
    within(screen.getByRole('region', { name: 'Needs attention' })).getByText(
      'Starting estimate · just recorded · Estimated 195/200',
    ),
  ).toBeInTheDocument();
});

it('opens complete controls from a priority and emits a scoped import request', () => {
  render(<TodayPage now={NOW} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open Near cap', exact: true }));
  expect(useUI.getState().tab).toBe('home');
  expect(useUI.getState().focusedGameId).toBe('Near cap');
  const listener = vi.fn();
  document.addEventListener('memoria:open-import', listener);
  fireEvent.click(
    within(screen.getByRole('region', { name: 'Near cap next check-in' })).getByRole('button', {
      name: 'Import readings',
    }),
  );
  expect((listener.mock.calls[0]![0] as CustomEvent).detail).toEqual({ gameId: 'Near cap' });
  document.removeEventListener('memoria:open-import', listener);
});

it('offers a first game and PC connection for an empty roster', () => {
  useApp.setState({ state: emptyState() });
  render(<TodayPage now={NOW} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add your first game' }));
  expect(useUI.getState().sheet).toEqual({ kind: 'addGame' });
  fireEvent.click(screen.getByRole('button', { name: 'Connect my PC' }));
  expect(useUI.getState().tab).toBe('settings');
});
