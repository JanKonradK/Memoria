import { fireEvent, render, screen } from '@testing-library/react';
import { effectiveResourceKind, emptyState, latestSnapshots } from '@memoria/shared';
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
import { flushPersist, useApp } from '../src/store';

/** Drop everything the module-level store holds so nothing leaks between tests. */
async function freshStore(): Promise<void> {
  await flushPersist();
  idb.clear();
  useApp.setState({ state: emptyState(), loaded: false, loadError: '' });
  await useApp.getState().load();
}

function selectGenshin(): void {
  fireEvent.click(screen.getByRole('button', { name: /Genshin Impact/ }));
}

describe('Onboarding energy entry', () => {
  beforeEach(async () => {
    idb.clear();
    await freshStore();
  });

  // The rule CHANGED by owner decision. It used to be "a blank field means I
  // don't know yet, so write nothing", which left a new dashboard showing "—"
  // until every resource had been typed in by hand.
  //
  // Now every regen resource is seeded at 0 so the card counts from first sight.
  // The cost is real and is accepted deliberately: a seeded zero UNDER-reports,
  // and under-reporting is the direction that hides a cap. A counter or weekly
  // resource is still never seeded — those are not clocks, and a phantom zero
  // there would be plain wrong.
  it('seeds every regen resource at zero when the energy field is left blank', () => {
    render(<Onboarding onComplete={vi.fn()} />);
    selectGenshin();
    fireEvent.click(screen.getByRole('button', { name: 'Create dashboard' }));

    const state = useApp.getState().state;
    expect(state.games.filter((game) => !game.deleted)).toHaveLength(1);
    // Genshin ships two regen resources and one counter, so exactly two seeds.
    const regenIds = new Set(
      state.resources
        .filter((resource) => !resource.deleted && effectiveResourceKind(resource) === 'regen')
        .map((r) => r.id),
    );
    expect(state.snapshots).toHaveLength(regenIds.size);
    expect(state.snapshots.every((snapshot) => snapshot.value === 0)).toBe(true);
    expect(state.snapshots.every((snapshot) => regenIds.has(snapshot.resourceId))).toBe(true);
  });

  it('records a snapshot when a value is actually entered', () => {
    render(<Onboarding onComplete={vi.fn()} />);
    selectGenshin();
    fireEvent.change(screen.getByLabelText(/Current Original Resin/), { target: { value: '84' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create dashboard' }));

    const state = useApp.getState().state;
    // The typed value is what the resource now READS — assert through the same
    // helper the app resolves with, not on a total count. The seeded zeros for
    // the other regen resources are present and correct, and a count would also
    // pass for the wrong reason if the seed ever overwrote the typed value.
    const resin = state.resources.find((resource) => resource.name === 'Original Resin')!;
    expect(latestSnapshots(state.snapshots).get(resin.id)?.value).toBe(84);
  });

  it('treats a whitespace-only entry as blank, so the resource keeps its seeded zero', () => {
    render(<Onboarding onComplete={vi.fn()} />);
    selectGenshin();
    fireEvent.change(screen.getByLabelText(/Current Original Resin/), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create dashboard' }));

    const state = useApp.getState().state;
    const resin = state.resources.find((resource) => resource.name === 'Original Resin')!;
    const forResin = state.snapshots.filter((snapshot) => snapshot.resourceId === resin.id);
    // One seed, still zero — whitespace never counts as a reading.
    expect(forResin).toHaveLength(1);
    expect(forResin[0]?.value).toBe(0);
  });

  it('persists the detected timezone when setup is skipped', () => {
    render(<Onboarding onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));

    expect(useApp.getState().state.settings.localTz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
