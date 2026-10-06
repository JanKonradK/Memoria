import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { emptyState } from '@memoria/shared';
import { afterEach, expect, it } from 'vitest';
import { makeGame } from '../../shared/test/helpers';
import { createReminderDraft, GameReminders } from '../src/components/settings/GameReminders';
import { ReminderSheet } from '../src/components/ReminderSheet';
import { useApp } from '../src/store';

const game = makeGame();
function Editor() {
  const [draft, setDraft] = useState(() => createReminderDraft('Etc/UTC'));
  return <GameReminders game={game} draft={draft} setDraft={setDraft} />;
}

afterEach(() => useApp.setState({ state: emptyState() }));

it('keeps an edited reminder if it is deleted elsewhere and can save a new copy', () => {
  useApp.setState({ state: { ...emptyState(), games: [game] } });
  useApp.getState().addReminder('Claim rewards', Date.now() + 3_600_000, game.id);
  const id = useApp.getState().state.reminders[0]!.id;
  render(<Editor />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit reminder Claim rewards' }));
  fireEvent.change(screen.getByLabelText('Reminder message'), { target: { value: 'Claim all rewards' } });

  act(() => useApp.getState().deleteReminder(id));

  expect(screen.getByLabelText('Reminder message')).toHaveValue('Claim all rewards');
  expect(screen.getByRole('button', { name: 'Save reminder', exact: true })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('This reminder is no longer available');
  fireEvent.click(screen.getByRole('button', { name: 'Add as new reminder', exact: true }));
  expect(useApp.getState().state.reminders).toEqual([
    expect.objectContaining({ id, deleted: true }),
    expect.objectContaining({ message: 'Claim all rewards', gameId: game.id }),
  ]);
  expect(useApp.getState().state.reminders[1]!.id).not.toBe(id);
  expect(screen.getByLabelText('Reminder message')).toHaveValue('');
});

it('moves focus to the selected reminder and explains an invalid date', () => {
  useApp.setState({ state: { ...emptyState(), games: [game] } });
  useApp.getState().addReminder('Claim rewards', Date.now() + 3_600_000, game.id);
  render(<Editor />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit reminder Claim rewards' }));
  expect(screen.getByLabelText('Reminder message')).toHaveFocus();
  fireEvent.change(screen.getByLabelText('When'), { target: { value: '' } });
  expect(screen.getByLabelText('When')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('When')).toHaveAccessibleDescription('Enter a valid date and time.');
  expect(screen.getByRole('button', { name: 'Save reminder', exact: true })).toBeDisabled();
});

it('distinguishes reminder accounts and saves the chosen account', () => {
  useApp.setState({
    state: {
      ...emptyState(),
      games: [
        makeGame({ id: 'main', name: 'Same game', accountLabel: 'Main EU' }),
        makeGame({ id: 'alt', name: 'Same game', accountLabel: 'Alt NA', paused: true }),
      ],
    },
  });
  render(<ReminderSheet open />);
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Game (optional)' }), { key: 'Enter' });
  expect(screen.getByRole('option', { name: 'Same game · Main EU' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Same game · Alt NA · Paused' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: 'Same game · Alt NA · Paused' }));
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Account reminder' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add reminder', exact: true }));
  expect(useApp.getState().state.reminders[0]?.gameId).toBe('alt');
});

it('can change a selected account back to No game inside the reminder form', () => {
  useApp.setState({ state: { ...emptyState(), games: [game] } });
  render(<ReminderSheet open />);
  const select = screen.getByRole('combobox', { name: 'Game (optional)' });
  fireEvent.keyDown(select, { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name: game.name }));
  expect(select).toHaveTextContent(game.name);
  fireEvent.keyDown(select, { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name: 'No game' }));
  expect(select).toHaveTextContent('No game');
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Unassigned reminder' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add reminder', exact: true }));
  expect(useApp.getState().state.reminders[0]).toEqual(
    expect.objectContaining({ message: 'Unassigned reminder', gameId: null }),
  );
});

it('keeps a new reminder time fixed when home timezone changes and uses the new zone next time', () => {
  const state = emptyState();
  useApp.setState({ state: { ...state, settings: { ...state.settings, localTz: 'Etc/UTC' } } });
  const { rerender } = render(<ReminderSheet open />);
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Fixed reminder time' } });
  fireEvent.change(screen.getByLabelText('When'), { target: { value: '2026-10-07T10:00' } });
  act(() => useApp.getState().updateSettings({ localTz: 'Asia/Tokyo' }));
  expect(screen.getByText('Times use Etc/UTC.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add reminder', exact: true }));
  expect(useApp.getState().state.reminders[0]?.at).toBe(Date.UTC(2026, 9, 7, 10));

  rerender(<ReminderSheet open={false} />);
  rerender(<ReminderSheet open />);
  expect(screen.getByText('Times use Asia/Tokyo.')).toBeInTheDocument();
});

it('does not move an existing reminder when a timezone sync arrives during editing', () => {
  const state = emptyState();
  const at = Date.UTC(2026, 9, 7, 10);
  useApp.setState({ state: { ...state, games: [game], settings: { ...state.settings, localTz: 'Etc/UTC' } } });
  useApp.getState().addReminder('Keep this time', at, game.id);
  render(<Editor />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit reminder Keep this time' }));
  act(() => useApp.getState().updateSettings({ localTz: 'Asia/Tokyo' }));
  fireEvent.change(screen.getByLabelText('Reminder message'), { target: { value: 'Same time, new message' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save reminder', exact: true }));
  expect(useApp.getState().state.reminders[0]).toEqual(
    expect.objectContaining({ message: 'Same time, new message', at }),
  );
});
