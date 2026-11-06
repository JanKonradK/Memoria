import { fireEvent, render, screen } from '@testing-library/react';
import { emptyState, PRESETS } from '@memoria/shared';
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

import { GameRosterRow } from '../src/components/settings/GameRosterRow';
import { flushPersist, useApp } from '../src/store';

describe('Settings game roster', () => {
  beforeEach(async () => {
    await flushPersist();
    idb.clear();
    useApp.setState({ state: emptyState(), loaded: false, loadError: '' });
    await useApp.getState().load();
  });

  it('edits the nickname and server in place', () => {
    const genshin = PRESETS.find((preset) => preset.key === 'genshin')!;
    const id = useApp.getState().addGameFromPreset(genshin, { tz: 'Etc/GMT-1' });
    const game = () => useApp.getState().state.games.find((g) => g.id === id)!;

    const { rerender } = render(
      <ul>
        <GameRosterRow game={game()} colors={game()} localTz="Europe/Warsaw" />
      </ul>,
    );
    const field = screen.getByLabelText('Nickname for Genshin Impact');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '  Main  ' } });
    fireEvent.blur(field);
    expect(game().accountLabel).toBe('Main');

    rerender(
      <ul>
        <GameRosterRow game={game()} colors={game()} localTz="Europe/Warsaw" />
      </ul>,
    );
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Server for Genshin Impact, Main' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'America (UTC−5)' }));
    expect(game().tz).toBe('Etc/GMT+5');
    expect(game().server).toBe('na');
    expect(screen.getByRole('button', { name: 'Game settings for Genshin Impact, Main' })).toBeInTheDocument();
  });
});
