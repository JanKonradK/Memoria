import { describe, expect, it } from 'vitest';
import { missingPresetTasks, presetForGame, PRESETS } from '../src/presets';

describe('game presets', () => {
  it('ships editable defaults for every supported title', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const preset of PRESETS) {
      expect(preset.key).toBeTruthy();
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.short.length).toBeGreaterThan(0);
      expect(preset.resources.length).toBeGreaterThan(0);
      expect(preset.tz).toMatch(/^Etc\/GMT/);
      for (const resource of preset.resources) {
        expect(resource.cap).toBeGreaterThan(0);
        expect(resource.regenMinutes).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('carries a real routine, not a token one, for every title', () => {
    // The point of a preset is that adding a game gives you its actual day.
    for (const preset of PRESETS) {
      const daily = preset.tasks.filter((task) => task.cadence === 'daily');
      const weekly = preset.tasks.filter((task) => task.cadence === 'weekly');
      expect(daily.length, `${preset.short} dailies`).toBeGreaterThanOrEqual(2);
      expect(weekly.length, `${preset.short} weeklies`).toBeGreaterThanOrEqual(3);
      expect(new Set(preset.tasks.map((task) => task.name)).size).toBe(preset.tasks.length);
    }
  });
});

describe('catching an existing game up with its preset', () => {
  const genshin = PRESETS.find((preset) => preset.short === 'GI')!;

  it('matches a game to its preset by badge, then by name', () => {
    expect(presetForGame({ name: 'Whatever I renamed it', short: 'gi' })?.key).toBe('genshin');
    expect(presetForGame({ name: 'Genshin Impact', short: 'ZZ9' })?.key).toBe('genshin');
    expect(presetForGame({ name: 'Some Other Game', short: 'SOG' })).toBeUndefined();
  });

  it('returns only what the game has not got', () => {
    const game = { name: 'Genshin Impact', short: 'GI' };
    const existing = genshin.tasks.slice(0, 3).map((task) => ({ name: task.name }));
    const missing = missingPresetTasks(game, existing);
    expect(missing).toHaveLength(genshin.tasks.length - 3);
    expect(missing.map((task) => task.name)).not.toContain(genshin.tasks[0].name);
  });

  it('never resurrects a task the user deleted', () => {
    const game = { name: 'Genshin Impact', short: 'GI' };
    const deletedOne = [{ name: genshin.tasks[0].name, deleted: true }];
    expect(missingPresetTasks(game, deletedOne).map((task) => task.name)).not.toContain(genshin.tasks[0].name);
  });

  it('has nothing to add once a game is up to date', () => {
    const game = { name: 'Genshin Impact', short: 'GI' };
    expect(
      missingPresetTasks(
        game,
        genshin.tasks.map((task) => ({ name: task.name })),
      ),
    ).toEqual([]);
  });
});
