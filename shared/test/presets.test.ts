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
    // The weekly floor used to be 3, which quietly rewarded padding: every
    // preset hit it only by shipping a battle-pass chore that completes itself
    // as a by-product of playing. Two real weeklies beat three with a filler.
    // A per-cadence daily floor is the wrong guard now: WuWa's daily loop
    // really is one task once "spend your waveplates" is gone, and padding it
    // to satisfy a number is exactly the habit this pass removed. What must
    // hold is that a preset is substantial overall and has real weekly content;
    // the daily side is covered by the core-daily test below.
    //
    // The weekly floor is 1, not 2, for the same reason the daily floor went:
    // Umamusume genuinely has one weekly. Its Club ranking pays monthly, every
    // shop exchange restocks monthly, and the mission screen has no weekly tab —
    // so a second weekly could only be invented. The overall floor of 4 tasks
    // still stops a preset from being a token one.
    for (const preset of PRESETS) {
      const weekly = preset.tasks.filter((task) => task.cadence === 'weekly');
      expect(preset.tasks.length, `${preset.short} tasks`).toBeGreaterThanOrEqual(4);
      expect(weekly.length, `${preset.short} weeklies`).toBeGreaterThanOrEqual(1);
      expect(new Set(preset.tasks.map((task) => task.name)).size).toBe(preset.tasks.length);
    }
  });

  it('leads every preset with exactly one core daily', () => {
    // `core` marks the tasks that pay premium pull currency, and they sort to
    // the top of the card. Every game has exactly one such daily; more than one
    // would mean the flag had started drifting toward "important-ish".
    for (const preset of PRESETS) {
      const coreDailies = preset.tasks.filter((task) => task.core && task.cadence === 'daily');
      expect(coreDailies.length, `${preset.short} core dailies`).toBe(1);
    }
  });

  it('tracks the Genshin Crystalfly Trap as a personal seven-day cooldown', () => {
    const genshin = PRESETS.find((preset) => preset.key === 'genshin')!;

    expect(genshin.tasks.find((task) => task.name === 'Crystalfly Trap (Crystal Cores)')).toEqual({
      name: 'Crystalfly Trap (Crystal Cores)',
      cadence: 'custom',
      intervalDays: 7,
      mode: 'timer',
      timerDurationMinutes: 10_080,
      timerStepMinutes: 720,
      timelineLinked: false,
    });
  });

  it('never ships a task that playing the game completes for you', () => {
    // "Spend <resource>" duplicated the resource row, which already projects
    // the cap and fires the alert — and nobody logs in and then forgets to
    // spend their energy. Endgame windows are owned by seeded Timeline cycle
    // events, so a tickable copy on the card meant maintaining the fact twice.
    const banned = [/^spend /i, /battle pass/i, /nameless honor/i];
    const owned = ['Spiral Abyss', 'Imaginarium Theater', 'Stygian', 'Shiyu', 'Deadly Assault', 'Beyond the Rails'];
    for (const preset of PRESETS) {
      for (const task of preset.tasks) {
        for (const pattern of banned) {
          expect(task.name, `${preset.short}: "${task.name}"`).not.toMatch(pattern);
        }
        for (const window of owned) {
          expect(task.name.toLowerCase(), `${preset.short}: "${task.name}"`).not.toContain(window.toLowerCase());
        }
      }
    }
  });
});

describe('catching an existing game up with its preset', () => {
  const genshin = PRESETS.find((preset) => preset.key === 'genshin')!;

  it('uses the full Genshin badge for new games', () => {
    expect(genshin.short).toBe('Genshin');
  });

  it('keeps the preset link after both the badge and name are changed', () => {
    expect(presetForGame({ name: 'My renamed account', short: 'GI-EU', presetKey: 'genshin' })?.key).toBe('genshin');
  });

  it('matches a legacy game by its old badge, then by name', () => {
    expect(presetForGame({ name: 'Whatever I renamed it', short: 'gi' })?.key).toBe('genshin');
    expect(presetForGame({ name: 'Genshin Impact', short: 'ZZ9' })?.key).toBe('genshin');
    expect(presetForGame({ name: 'Some Other Game', short: 'SOG' })).toBeUndefined();
  });

  it('returns only what the game has not got', () => {
    const game = { name: 'Genshin Impact', short: 'GI' };
    const existing = genshin.tasks.slice(0, 3).map((task) => ({ name: task.name }));
    const missing = missingPresetTasks(game, existing);
    expect(missing).toHaveLength(genshin.tasks.length - 3);
    expect(missing.map((task) => task.name)).not.toContain(genshin.tasks[0]!.name);
  });

  it('never resurrects a task the user deleted', () => {
    const game = { name: 'Genshin Impact', short: 'GI' };
    const deletedOne = [{ name: genshin.tasks[0]!.name, deleted: true }];
    expect(missingPresetTasks(game, deletedOne).map((task) => task.name)).not.toContain(genshin.tasks[0]!.name);
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
