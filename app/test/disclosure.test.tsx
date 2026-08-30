import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Disclosure } from '../src/components/Disclosure';

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <Disclosure
      open={open}
      onOpenChange={setOpen}
      title="Details"
      triggerLabel={`${open ? 'Collapse' : 'Expand'} details`}
    >
      <button type="button">Inside action</button>
    </Disclosure>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Disclosure', () => {
  it('wires the trigger, makes the closed panel inert, restores focus, and unmounts after the exit timer', () => {
    const { container } = render(<Harness />);
    const inside = screen.getByRole('button', { name: 'Inside action' });
    inside.focus();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse details' }));

    const trigger = screen.getByRole('button', { name: 'Expand details' });
    const panel = container.querySelector<HTMLElement>('[role="region"]')!;
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-hidden', 'true');
    expect(panel).toHaveAttribute('inert');
    expect(trigger).toHaveFocus();
    expect(inside).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(400));
    expect(screen.queryByRole('button', { name: 'Inside action', hidden: true })).not.toBeInTheDocument();
  });
});
