import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { Hint } from '../src/components/Hint';
import { useUI } from '../src/ui-store';

beforeEach(() => useUI.setState({ hintsArmed: false, hintsSeen: {} }));

it('shows nothing to someone who did not just set up the app', () => {
  render(<Hint id="energy" />);
  expect(screen.queryByRole('note')).toBeNull();
});

it('shows each hint once after setup, and again on request', () => {
  useUI.getState().armHints();
  const { rerender } = render(
    <>
      <Hint id="energy" />
      <Hint id="tasks" />
    </>,
  );
  expect(screen.getAllByRole('note')).toHaveLength(2);
  fireEvent.click(screen.getAllByRole('button', { name: 'Got it' })[0]!);
  expect(screen.getAllByRole('note')).toHaveLength(1);
  expect(screen.getByRole('note')).toHaveTextContent('Tick a task');
  useUI.getState().armHints();
  rerender(<Hint id="energy" />);
  expect(screen.getByRole('note')).toHaveTextContent('Type the number your game shows');
});
