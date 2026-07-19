import { fireEvent, render, screen } from '@testing-library/react';
import type { EnergyProjection, Resource } from '@technogg/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnergyRow } from '../src/components/EnergyRow';
import { useUI } from '../src/ui-store';

const now = new Date('2026-07-19T12:00:00Z').getTime();

const resource: Resource = {
  id: 'trailblaze',
  gameId: 'hsr',
  name: 'Trailblaze Power',
  icon: 'comet',
  cap: 300,
  regenMinutes: 6,
  reserveCap: 2400,
  reserveLabel: 'Reserve TB Power',
  kind: 'regen',
  sort: 0,
  updatedAt: 1,
};

const projection: EnergyProjection = {
  value: 300,
  precise: 300,
  isFull: true,
  fullAt: null,
  msToFull: 0,
  overflow: 0,
  hasSnapshot: true,
  reserve: 320,
};

function renderRow({
  proj = projection,
  reserve = 320,
  onCommit = vi.fn(),
}: {
  proj?: EnergyProjection;
  reserve?: number;
  onCommit?: (value: number, reserve?: number) => void;
} = {}) {
  return render(
    <EnergyRow
      res={resource}
      color="#f2a7c8"
      reserveColor="#74d8e6"
      proj={proj}
      reserve={reserve}
      now={now}
      onCommit={onCommit}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  useUI.setState({ reserveOpen: {} });
});

describe('EnergyRow reserve controls', () => {
  it('auto-expands a non-empty reserve when the main resource is full', () => {
    const { container } = renderRow();

    expect(screen.getByRole('textbox', { name: 'Reserve TB Power for Trailblaze Power' })).toBeInTheDocument();
    expect(screen.getByText(/\+1 \/ 12m · full/)).toBeInTheDocument();
    expect(container.querySelectorAll('div[aria-hidden="true"]')).toHaveLength(2);
    expect(screen.queryByText(/charging/i)).not.toBeInTheDocument();
  });

  it('commits an edited reserve value on blur', () => {
    const onCommit = vi.fn();
    renderRow({ onCommit });

    const input = screen.getByRole('textbox', { name: 'Reserve TB Power for Trailblaze Power' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '400' } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledWith(300, 400);
  });

  it('starts collapsed when the main resource is not full and reserve is empty', () => {
    renderRow({
      proj: {
        ...projection,
        value: 200,
        precise: 200,
        isFull: false,
        fullAt: now + 100 * 6 * 60_000,
        msToFull: 100 * 6 * 60_000,
        reserve: 0,
      },
      reserve: 0,
    });

    const inputName = 'Reserve TB Power for Trailblaze Power';
    const indicator = screen.getByRole('button', { name: /Reserve TB Power 0\/2400/ });
    expect(screen.queryByRole('textbox', { name: inputName })).not.toBeInTheDocument();
    expect(indicator).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(indicator);
    expect(screen.getByRole('textbox', { name: inputName })).toBeInTheDocument();
    expect(indicator).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(indicator);
    expect(screen.queryByRole('textbox', { name: inputName })).not.toBeInTheDocument();
    expect(indicator).toHaveAttribute('aria-expanded', 'false');
  });

  it('focuses the main input when its cap text is pressed', () => {
    renderRow();

    fireEvent.mouseDown(screen.getByText('/ 300'));

    expect(screen.getByRole('textbox', { name: 'Trailblaze Power current value' })).toHaveFocus();
  });

  it('increments reserve from its step button', () => {
    const onCommit = vi.fn();
    renderRow({ onCommit });
    const reserveIncrement = screen.getByRole('button', { name: 'Increase Reserve TB Power' });

    fireEvent.mouseDown(reserveIncrement);
    fireEvent.mouseUp(reserveIncrement);

    expect(onCommit).toHaveBeenCalledWith(300, 321);
  });

  it('steps via keyboard activation of the step button', () => {
    const onCommit = vi.fn();
    renderRow({ onCommit });

    // Keyboard activation surfaces as a click with detail 0.
    fireEvent.click(screen.getByRole('button', { name: 'Decrease Reserve TB Power' }), { detail: 0 });

    expect(onCommit).toHaveBeenCalledWith(300, 319);
  });

  it('does not commit when focus passes through without an edit', () => {
    const onCommit = vi.fn();
    renderRow({ onCommit });

    const main = screen.getByRole('textbox', { name: 'Trailblaze Power current value' });
    fireEvent.focus(main);
    fireEvent.blur(main);

    const reserveInput = screen.getByRole('textbox', { name: 'Reserve TB Power for Trailblaze Power' });
    fireEvent.focus(reserveInput);
    fireEvent.blur(reserveInput);

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('cancels an edited reserve value with Escape', () => {
    const onCommit = vi.fn();
    renderRow({ onCommit });

    const input = screen.getByRole('textbox', { name: 'Reserve TB Power for Trailblaze Power' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '400' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue('320');
  });

  it('cancels an edited main value with Escape', () => {
    const onCommit = vi.fn();
    renderRow({ onCommit });

    const input = screen.getByRole('textbox', { name: 'Trailblaze Power current value' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '100' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue('300');
  });
});
