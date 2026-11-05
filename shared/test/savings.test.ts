import { describe, expect, it } from 'vitest';
import {
  currencyAt,
  dateForPulls,
  GameSavingsSchema,
  incomeRange,
  normalizeState,
  planGoals,
  savedPulls,
  type GameSavings,
  type VersionRow,
} from '../src';
import { makeGame } from './helpers';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 5);

const savings = (overrides: Partial<GameSavings> = {}): GameSavings =>
  GameSavingsSchema.parse({ currency: 8000, tickets: 10, takenAt: T0, goals: [], ...overrides });

const row = (version: string, perDay: number | null, ended = true) =>
  ({ record: { version, end: ended ? '2026-01-01' : null }, perDay }) as unknown as VersionRow;

describe('savings planner', () => {
  it('counts tickets and whole pulls of currency', () => {
    expect(savedPulls(savings(), 160)).toBe(10 + 50);
    expect(savedPulls(savings({ currency: 159, tickets: 0 }), 160)).toBe(0);
  });

  it('takes the income range from the last six finished versions with a known rate', () => {
    const rows = [
      row('1', 100),
      row('2', 400),
      row('3', null),
      row('4', 300),
      row('5', 200),
      row('6', 250),
      row('7', 350),
      row('8', 500),
      row('9', 999, false),
    ];
    const income = incomeRange(rows, '2026-11-05');
    // 1 drops out (only the last six count); 3 has no total; 9 is still running.
    expect(income.versions).toEqual(['2', '4', '5', '6', '7', '8']);
    expect(income).toMatchObject({ low: 200, mid: 325, high: 500, source: 'history' });
  });

  it('falls back to the player’s own daily figure, and to nothing at all', () => {
    expect(incomeRange([], '2026-11-05', 120)).toMatchObject({ low: 120, mid: 120, high: 120, source: 'manual' });
    expect(incomeRange([], '2026-11-05')).toMatchObject({ mid: 0, source: 'none' });
  });

  it('leaves out a version whose end date has not passed yet', () => {
    const rows = [row('1', 100), { record: { version: '2', end: '2026-11-11' }, perDay: 900 } as unknown as VersionRow];
    expect(incomeRange(rows, '2026-11-05').versions).toEqual(['1']);
    expect(incomeRange(rows, '2026-11-12').versions).toEqual(['1', '2']);
    // On its last day it is still running.
    expect(incomeRange(rows, '2026-11-11').versions).toEqual(['1']);
  });

  it('scales income by participation and never earns before the balance was entered', () => {
    const plan = savings({ participation: 0.5 });
    expect(currencyAt(plan, 200, T0 + 10 * DAY)).toBe(8000 + 1000);
    expect(currencyAt(plan, 200, T0 - 10 * DAY)).toBe(8000);
  });

  it('finds the day a target is reached, or none without income', () => {
    // 100 pulls: 90 more than the tickets, 14,400 currency, 6,400 still to earn at 320 a day.
    expect(dateForPulls(savings(), 320, 160, 100)).toBe(T0 + 20 * DAY);
    expect(dateForPulls(savings(), 0, 160, 100)).toBeNull();
    expect(dateForPulls(savings(), 0, 160, 40)).toBe(T0);
  });

  it('reserves earlier goals before later ones and grades each against the income range', () => {
    const plan = savings({
      goals: [
        { id: 'b', label: 'Second banner', targetPulls: 80, deadline: T0 + 60 * DAY },
        { id: 'a', label: 'First banner', targetPulls: 50, deadline: T0 + 10 * DAY },
        { id: 'old', label: 'Gone', targetPulls: 1, deadline: T0 - DAY },
      ],
    });
    const [old, first, second] = planGoals(
      plan,
      { low: 160, mid: 240, high: 320, versions: [], source: 'history' },
      160,
      T0,
    );
    expect(old!.status).toBe('past');
    // 60 pulls on hand already covers the first goal. The ended one holds nothing back.
    expect(first!.needed).toBe(50);
    expect(first!.status).toBe('covered');
    // The second needs 130. At 60 days: low 120, mid 150, high 180 pulls.
    expect(second!.needed).toBe(130);
    expect(second!.expected).toEqual({ low: 120, mid: 150, high: 180 });
    expect(second!.status).toBe('at-risk');
    expect(second!.shortfall).toBe(0);
  });

  it('drops a damaged plan without losing the game', () => {
    const state = normalizeState({
      games: [
        makeGame({ id: 'ok', savings: savings() }),
        makeGame({ id: 'bad', savings: { currency: -5, tickets: 'many' } as unknown as GameSavings }),
      ],
    });
    expect(state.games.find((g) => g.id === 'ok')?.savings?.currency).toBe(8000);
    const bad = state.games.find((g) => g.id === 'bad');
    expect(bad).toBeDefined();
    expect(bad).not.toHaveProperty('savings');
  });
});

describe('savings and older apps', () => {
  it('marks documents with a newer schema so a 3.3 app refuses them instead of stripping plans', async () => {
    const { CURRENT_SCHEMA_VERSION, migrateState } = await import('../src');
    expect(CURRENT_SCHEMA_VERSION).toBe(10);
    const v8 = { schemaVersion: 8, games: [makeGame({ id: 'g' })] };
    expect((migrateState(v8) as { schemaVersion: number }).schemaVersion).toBe(10);
    expect(() => migrateState({ schemaVersion: 11 })).toThrow(/newer version/);
  });
});
