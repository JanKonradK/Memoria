import { fireEvent, render, screen } from '@testing-library/react';
import { PRESETS } from '@void/shared';
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

import { AddGameSheet } from '../src/components/AddGame';
import { useApp } from '../src/store';

let identitySequence = 0;

/** Each test gets its own identity so nothing leaks through the module-level store. */
async function freshStore(): Promise<void> {
  await useApp.getState().setIdentity(`add-account-test:${identitySequence++}`);
}

describe('Add another account', () => {
  beforeEach(async () => {
    idb.clear();
    await freshStore();
  });

  it('creates a distinct preset account without inventing an energy reading', () => {
    const genshin = PRESETS.find((preset) => preset.key === 'genshin')!;
    const firstId = useApp.getState().addGameFromPreset(genshin, {
      accountLabel: 'Main EU',
      tz: 'Etc/GMT+5',
    });

    render(<AddGameSheet open />);
    // Match on the account label: the preset grid below has its own Genshin
    // button, so /Genshin Impact/ alone is ambiguous.
    fireEvent.click(screen.getByRole('button', { name: /Main EU/ }));
    fireEvent.change(screen.getByLabelText(/^Account label/), { target: { value: 'Alt NA' } });
    fireEvent.change(screen.getByLabelText(/^Badge/), { target: { value: 'G2' } });
    expect(screen.getByRole('combobox')).toHaveTextContent('HoYo/Kuro America (UTC-5)');
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));

    const state = useApp.getState().state;
    const accounts = state.games.filter((game) => !game.deleted && game.presetKey === genshin.key);
    expect(accounts).toHaveLength(2);
    expect(accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstId, name: genshin.name, presetKey: genshin.key }),
        expect.objectContaining({
          name: genshin.name,
          presetKey: genshin.key,
          short: 'G2',
          accountLabel: 'Alt NA',
          tz: 'Etc/GMT+5',
        }),
      ]),
    );
    expect(state.snapshots).toHaveLength(0);

    const accountIds = accounts.map((game) => game.id);
    useApp.getState().replaceState({
      ...state,
      tasks: state.tasks.filter((task) => !accountIds.includes(task.gameId)),
    });

    expect(useApp.getState().addMissingPresetTasksEverywhere()).toBe(genshin.tasks.length * 2);
    for (const gameId of accountIds) {
      expect(
        useApp
          .getState()
          .state.tasks.filter((task) => task.gameId === gameId && !task.deleted)
          .map((task) => task.name),
      ).toEqual(genshin.tasks.map((task) => task.name));
    }
  });
});
