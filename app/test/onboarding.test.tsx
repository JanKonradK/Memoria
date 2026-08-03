import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const idb = vi.hoisted(() => new Map<string, unknown>());

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idb.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    idb.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    idb.delete(key);
  }),
}));

import { Onboarding } from '../src/components/Onboarding';
import { useApp } from '../src/store';

let identitySequence = 0;

/** Each test gets its own identity so nothing leaks through the module-level store. */
async function freshStore(): Promise<void> {
  await useApp.getState().setIdentity(`onboarding-test:${identitySequence++}`);
}

function selectGenshin(): void {
  fireEvent.click(screen.getByRole('button', { name: /Genshin Impact/ }));
}

describe('Onboarding energy entry', () => {
  beforeEach(async () => {
    idb.clear();
    await freshStore();
  });

  // A blank field means "I don't know yet". Committing 0 would let Void project a
  // confident refill time — and tick its own "Enter energy" setup step — from a
  // reading the user never gave it.
  it('creates the game but no snapshot when the energy field is left blank', () => {
    render(<Onboarding onComplete={vi.fn()} />);
    selectGenshin();
    fireEvent.click(screen.getByRole('button', { name: 'Create dashboard' }));

    const state = useApp.getState().state;
    expect(state.games.filter((game) => !game.deleted)).toHaveLength(1);
    expect(state.snapshots).toHaveLength(0);
  });

  it('records a snapshot when a value is actually entered', () => {
    render(<Onboarding onComplete={vi.fn()} />);
    selectGenshin();
    fireEvent.change(screen.getByLabelText(/Current Original Resin/), { target: { value: '84' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create dashboard' }));

    const state = useApp.getState().state;
    expect(state.snapshots).toHaveLength(1);
    expect(state.snapshots[0]?.value).toBe(84);
  });

  it('treats a whitespace-only entry as blank', () => {
    render(<Onboarding onComplete={vi.fn()} />);
    selectGenshin();
    fireEvent.change(screen.getByLabelText(/Current Original Resin/), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create dashboard' }));

    expect(useApp.getState().state.snapshots).toHaveLength(0);
  });
});
