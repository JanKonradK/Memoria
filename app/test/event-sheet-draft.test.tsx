import { act, fireEvent, render, screen } from '@testing-library/react';
import { emptyState } from '@memoria/shared';
import { afterEach, expect, it } from 'vitest';
import { makeEvent, makeGame } from '../../shared/test/helpers';
import { EventSheet } from '../src/components/EventSheet';
import { useApp } from '../src/store';

afterEach(() => useApp.setState({ state: emptyState() }));

it('a new event starts with fresh rules after editing a finished banner', () => {
  const game = makeGame();
  const event = makeEvent({
    gameId: game.id,
    name: 'Old banner',
    type: 'banner',
    bannerKind: 'weapon',
    dailyTouch: true,
    notify: false,
    done: true,
    notes: 'Old notes',
  });
  useApp.setState({ state: { ...emptyState(), games: [game], events: [event] } });
  const { rerender } = render(<EventSheet open eventId={event.id} gameId={game.id} />);
  expect(screen.getByLabelText('Name')).toHaveValue('Old banner');
  fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
  rerender(<EventSheet open={false} eventId={event.id} gameId={game.id} />);
  rerender(<EventSheet open gameId={game.id} />);
  expect(screen.getByLabelText('Name')).toHaveValue('');
  expect(screen.getByLabelText('Notes')).toHaveValue('');
  expect(screen.getByRole('combobox', { name: 'Type' })).toHaveTextContent('event');
  expect(screen.getByRole('switch', { name: 'Needs a daily check-in' })).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('switch', { name: 'Include in next actions' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('switch', { name: 'Mark done' })).toHaveAttribute('aria-checked', 'false');
  expect(screen.queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument();
  expect(useApp.getState().state.events).toEqual([event]);
});

it('keeps a draft when its event is deleted and requires an explicit new copy', () => {
  const game = makeGame();
  const event = makeEvent({
    gameId: game.id,
    name: 'Original event',
    start: Date.UTC(2026, 9, 6),
    end: Date.UTC(2026, 9, 10),
  });
  useApp.setState({ state: { ...emptyState(), games: [game], events: [event] } });
  render(<EventSheet open eventId={event.id} gameId={game.id} />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My pending change' } });

  act(() => useApp.getState().deleteEvent(event.id));

  expect(screen.getByLabelText('Name')).toHaveValue('My pending change');
  expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('This event is no longer available');
  expect(useApp.getState().state.events).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Add as new event', exact: true }));
  expect(useApp.getState().state.events).toEqual([
    expect.objectContaining({ id: event.id, deleted: true }),
    expect.objectContaining({ name: 'My pending change', gameId: game.id }),
  ]);
  expect(useApp.getState().state.events[1]!.id).not.toBe(event.id);
});

it('keeps the event draft timezone when home timezone changes during editing', () => {
  const state = emptyState();
  const game = makeGame();
  useApp.setState({ state: { ...state, games: [game], settings: { ...state.settings, localTz: 'Etc/UTC' } } });
  render(<EventSheet open gameId={game.id} />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fixed time event' } });
  fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-10-07T10:00' } });
  fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-10-07T12:00' } });
  act(() => useApp.getState().updateSettings({ localTz: 'Asia/Tokyo' }));
  fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-10-07T13:00' } });

  expect(screen.getByText('Dates and times use Etc/UTC.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add event', exact: true }));
  expect(useApp.getState().state.events[0]).toEqual(
    expect.objectContaining({ start: Date.UTC(2026, 9, 7, 10), end: Date.UTC(2026, 9, 7, 13) }),
  );
});
