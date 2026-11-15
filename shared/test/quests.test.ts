import { describe, expect, it } from 'vitest';
import {
  availableQuests,
  buildNotificationPlan,
  CatalogQuestSchema,
  catalogLine,
  customLine,
  mergeState,
  nextPartState,
  normalizeState,
  notificationStyle,
  questMarkId,
  questMarkIndex,
  questMatches,
  questProgress,
  questTotals,
  type QuestLine,
} from '../src';
import type { QuestMark } from '../src/types';
import { makeGame, makeState, makeTask, utc } from './helpers';

const quest = (id: string, parts: number, extra: Partial<QuestLine> = {}): QuestLine =>
  catalogLine(
    CatalogQuestSchema.parse({
      id,
      kind: 'world',
      title: `Quest ${id}`,
      characters: ['Nahida'],
      parts: Array.from({ length: parts }, (_, i) => ({ id: String(i + 1), title: `Part ${i + 1}`, characters: [] })),
      ...extra,
    }),
  );
const mark = (
  questId: string,
  state: QuestMark['state'],
  partId?: string,
  extra: Partial<QuestMark> = {},
): QuestMark => ({
  id: questMarkId('g', questId, partId),
  gameId: 'g',
  questId,
  ...(partId ? { partId } : {}),
  state,
  updatedAt: 1,
  ...extra,
});

describe('quest progress', () => {
  it('counts done parts, halves partial ones, and finishes when every part is done', () => {
    const line = quest('aranyaka', 4);
    const none = questProgress(line, 'g', new Map());
    expect(none).toMatchObject({ status: 'todo', done: 0, ratio: 0 });
    const some = questProgress(
      line,
      'g',
      questMarkIndex([mark('aranyaka', 'done', '1'), mark('aranyaka', 'partial', '2')], 'g'),
    );
    expect(some).toMatchObject({ status: 'started', done: 1, partial: 1, total: 4, ratio: 0.375 });
    const all = questProgress(
      line,
      'g',
      questMarkIndex(
        ['1', '2', '3', '4'].map((part) => mark('aranyaka', part === '4' ? 'skipped' : 'done', part)),
        'g',
      ),
    );
    expect(all.status).toBe('done');
  });

  it('lets a mark on the quest itself cover every part, and ignores tombstones and other accounts', () => {
    const line = quest('tatarasuna', 3);
    expect(questProgress(line, 'g', questMarkIndex([mark('tatarasuna', 'done')], 'g'))).toMatchObject({
      status: 'done',
      done: 3,
    });
    expect(questProgress(line, 'g', questMarkIndex([mark('tatarasuna', 'skipped')], 'g')).status).toBe('skipped');
    const ignored = questMarkIndex(
      [mark('tatarasuna', 'done', undefined, { deleted: true }), { ...mark('tatarasuna', 'done'), gameId: 'other' }],
      'g',
    );
    expect(questProgress(line, 'g', ignored).status).toBe('todo');
  });

  it('cycles a part through done, partly done and open', () => {
    expect(nextPartState(undefined)).toBe('done');
    expect(nextPartState('done')).toBe('partial');
    expect(nextPartState('partial')).toBeNull();
    expect(nextPartState('skipped')).toBeNull();
  });

  it('offers quests whose prerequisites are finished, and totals the game', () => {
    const first = quest('act-1', 2);
    const second = quest('act-2', 2, { requires: ['act-1'] });
    const loose = quest('loose', 1, { requires: ['not-in-catalog'] });
    const lines = [first, second, loose];
    expect(availableQuests(lines, 'g', new Map()).map((line) => line.id)).toEqual(['act-1', 'loose']);
    const marks = questMarkIndex([mark('act-1', 'done')], 'g');
    expect(availableQuests(lines, 'g', marks).map((line) => line.id)).toEqual(['act-2', 'loose']);
    expect(questTotals(lines, 'g', marks)).toEqual({ lines: 3, done: 1, started: 0, parts: 5, partsDone: 2 });
  });

  it('finds quests by character, part and accent-free spelling', () => {
    const line = quest('x', 1, { parts: [{ id: '1', title: 'Fontaine Café', characters: ['Lynette'] }] } as never);
    expect(questMatches(line, 'nahida')).toBe(true);
    expect(questMatches(line, 'cafe')).toBe(true);
    expect(questMatches(line, 'lynette')).toBe(true);
    expect(questMatches(line, 'zhongli')).toBe(false);
  });

  it('gives a custom quest one part when the player listed none, under an id the catalog cannot use', () => {
    const line = customLine({ id: 'abc', gameId: 'g', title: 'Fishing spots', kind: 'side', updatedAt: 1 });
    expect(line.id).toBe('my:abc');
    expect(line.parts).toHaveLength(1);
    expect(
      CatalogQuestSchema.safeParse({ id: 'my:abc', kind: 'side', title: 'x', parts: [{ id: '1', title: 'x' }] })
        .success,
    ).toBe(false);
  });
});

describe('quest marks sync', () => {
  it('merges marks from two devices row by row, newest edit winning per mark', () => {
    const base = makeState({ games: [makeGame({ id: 'g' })] });
    const phone = {
      ...base,
      questMarks: [mark('a', 'done', '1', { updatedAt: 10 }), mark('a', 'partial', '2', { updatedAt: 10 })],
    };
    const pc = {
      ...base,
      questMarks: [mark('a', 'partial', '1', { updatedAt: 20 }), mark('b', 'done', undefined, { updatedAt: 5 })],
    };
    const merged = mergeState(phone, pc);
    const index = questMarkIndex(merged.questMarks, 'g');
    expect(index.get(questMarkId('g', 'a', '1'))).toBe('partial');
    expect(index.get(questMarkId('g', 'a', '2'))).toBe('partial');
    expect(index.get(questMarkId('g', 'b'))).toBe('done');
    expect(mergeState(pc, phone).questMarks).toEqual(merged.questMarks);
  });

  it('drops a damaged mark alone and keeps a document without quest collections loadable', () => {
    const state = normalizeState({
      ...makeState(),
      questMarks: [mark('a', 'done'), { ...mark('b', 'done'), state: 'finished' }],
    });
    expect(state.questMarks.map((item) => item.questId)).toEqual(['a']);
    const older: Record<string, unknown> = { ...makeState() };
    delete older.questMarks;
    delete older.customQuests;
    expect(normalizeState(older).questMarks).toEqual([]);
  });
});

describe('notification styles', () => {
  const now = utc('2026-10-06T12:00:00Z');
  const quiet = { quietStart: null, quietEnd: null, localTz: 'UTC', sleepHours: 8, updatedAt: 0 };

  it('uses each kind’s default style, or the one chosen in Settings, and the alarm ring for alarms', () => {
    expect(notificationStyle({}, 'daily')).toBe('standard');
    expect(notificationStyle({}, 'energy')).toBe('gentle');
    const state = makeState({
      games: [makeGame()],
      tasks: [makeTask()],
      settings: { ...quiet, notificationStyles: { daily: 'alarm' }, alarmTone: 'chime' },
    });
    const daily = buildNotificationPlan(state, now).find((item) => item.kind === 'daily')!;
    expect(daily).toMatchObject({ style: 'alarm', tone: 'chime' });
  });

  it('lets one reminder arrive in its own style', () => {
    const state = makeState({
      settings: quiet,
      reminders: [
        { id: 'r1', gameId: null, message: 'Wake up', at: now + 3_600_000, style: 'alarm', updatedAt: 1 },
        { id: 'r2', gameId: null, message: 'Quiet one', at: now + 3_600_000, updatedAt: 1 },
      ],
    });
    const plan = buildNotificationPlan(state, now);
    expect(plan.find((item) => item.body === 'Wake up')).toMatchObject({ style: 'alarm', tone: 'classic' });
    expect(plan.find((item) => item.body === 'Quiet one')).toMatchObject({ style: 'standard' });
    expect(plan.find((item) => item.body === 'Quiet one')).not.toHaveProperty('tone');
  });

  it('keeps valid styles and drops unknown ones without resetting other settings', () => {
    const state = normalizeState({
      ...makeState(),
      settings: {
        ...quiet,
        localTz: 'Europe/Paris',
        notificationStyles: { daily: 'alarm', weekly: 'loud' },
        alarmTone: 'siren',
      },
    });
    expect(state.settings.notificationStyles).toEqual({ daily: 'alarm' });
    expect(state.settings.alarmTone).toBeUndefined();
    expect(state.settings.localTz).toBe('Europe/Paris');
  });
});
