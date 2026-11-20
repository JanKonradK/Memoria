import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { Guide } from '../src/components/Guide';
import { useUI } from '../src/ui-store';

beforeEach(() => useUI.setState({ sheet: { kind: 'guide' } }));

it('walks four cards, each a miniature and one line, and closes on Done', () => {
  render(<Guide open />);
  const cards = screen.getAllByRole('tab');
  expect(cards).toHaveLength(4);
  expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  for (const title of ['Bars', 'Your games', 'Overnight']) {
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  }
  // The last card shows the crescent the calendar uses for an end in the small hours.
  expect(document.querySelector('.night-mark')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(useUI.getState().sheet).toBeNull();
});

it('jumps to a card from its dot', () => {
  render(<Guide open />);
  fireEvent.click(screen.getByRole('tab', { name: 'Overnight' }));
  expect(screen.getByRole('tab', { name: 'Overnight' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
});
