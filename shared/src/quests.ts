import { z } from 'zod';
import type { CustomQuest, QuestKind, QuestMark, QuestState } from './types';

/**
 * The Quests catalog: every main-story act, world-quest series and character
 * story of a game, with the parts a player ticks off and who is in them.
 * Researched data, bundled per game in `app/src/data/quests/<preset>.json` and
 * loaded only when the Quests page opens. Progress lives in `questMarks`.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const questId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,119}$/)
  .max(120);

export const QuestPartSchema = z.object({
  id: z.string().min(1).max(60),
  title: text(300),
  characters: z.array(text(100)).max(20).default([]),
  note: z.string().max(400).nullable().optional(),
});

export const CatalogQuestSchema = z.object({
  id: questId,
  kind: z.enum(['main', 'story', 'world', 'side', 'event']),
  series: z.string().max(200).nullable().optional(),
  title: text(300),
  region: z.string().max(120).nullable().optional(),
  version: z.string().max(20).nullable().optional(),
  summary: z.string().max(400).nullable().optional(),
  start: z.string().max(400).nullable().optional(),
  characters: z.array(text(100)).max(30).default([]),
  requires: z.array(questId).max(20).default([]),
  parts: z.array(QuestPartSchema).min(1).max(200),
  url: z
    .url({ protocol: /^https$/ })
    .nullable()
    .optional(),
});

export const QuestCatalogSchema = z.object({
  game: z.string().min(1).max(40),
  reviewed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quests: z.array(CatalogQuestSchema).max(5000),
});

export type QuestPart = z.infer<typeof QuestPartSchema>;
export type CatalogQuest = z.infer<typeof CatalogQuestSchema>;
export type QuestCatalog = z.infer<typeof QuestCatalogSchema>;

/** A quest as the Quests page shows it: from the catalog, or one the player added. */
export interface QuestLine {
  id: string;
  kind: QuestKind;
  series: string | null;
  title: string;
  region: string | null;
  version: string | null;
  summary: string | null;
  start: string | null;
  characters: string[];
  requires: string[];
  parts: QuestPart[];
  url: string | null;
  custom: boolean;
  notes?: string;
}

export function catalogLine(quest: CatalogQuest): QuestLine {
  return {
    id: quest.id,
    kind: quest.kind,
    series: quest.series ?? null,
    title: quest.title,
    region: quest.region ?? null,
    version: quest.version ?? null,
    summary: quest.summary ?? null,
    start: quest.start ?? null,
    characters: quest.characters,
    requires: quest.requires,
    parts: quest.parts,
    url: quest.url ?? null,
    custom: false,
  };
}

/** Custom quests share the id space with the catalog, so their ids carry a prefix the catalog cannot use. */
export const CUSTOM_QUEST_PREFIX = 'my:';

export function customLine(quest: CustomQuest): QuestLine {
  const parts = quest.parts?.length ? quest.parts : [{ id: '1', title: quest.title }];
  return {
    id: `${CUSTOM_QUEST_PREFIX}${quest.id}`,
    kind: quest.kind,
    series: quest.series ?? null,
    title: quest.title,
    region: null,
    version: null,
    summary: null,
    start: null,
    characters: quest.characters ?? [],
    requires: [],
    parts: parts.map((part) => ({ ...part, characters: [] })),
    url: null,
    custom: true,
    notes: quest.notes,
  };
}

export function questMarkId(gameId: string, questId: string, partId?: string): string {
  return partId == null ? `${gameId}|${questId}` : `${gameId}|${questId}|${partId}`;
}

/** Live marks of one game, by mark id. */
export function questMarkIndex(marks: QuestMark[], gameId: string): Map<string, QuestState> {
  const index = new Map<string, QuestState>();
  for (const mark of marks) if (!mark.deleted && mark.gameId === gameId) index.set(mark.id, mark.state);
  return index;
}

export type QuestStatus = 'todo' | 'started' | 'done' | 'skipped';

export interface QuestProgress {
  status: QuestStatus;
  /** Parts done or skipped. */
  done: number;
  /** Parts marked partly done. */
  partial: number;
  total: number;
  /** 0 to 1; a partly done part counts half. */
  ratio: number;
}

/**
 * Where a quest stands. A mark on the quest itself wins: done or skipped covers
 * every part. Otherwise its parts decide, and a partly done part starts it.
 */
export function questProgress(line: QuestLine, gameId: string, marks: Map<string, QuestState>): QuestProgress {
  const total = line.parts.length;
  const own = marks.get(questMarkId(gameId, line.id));
  if (own === 'done' || own === 'skipped')
    return { status: own === 'done' ? 'done' : 'skipped', done: total, partial: 0, total, ratio: 1 };
  let done = 0;
  let partial = 0;
  for (const part of line.parts) {
    const state = marks.get(questMarkId(gameId, line.id, part.id));
    if (state === 'done' || state === 'skipped') done++;
    else if (state === 'partial') partial++;
  }
  const status: QuestStatus =
    total > 0 && done === total ? 'done' : done > 0 || partial > 0 || own === 'partial' ? 'started' : 'todo';
  return { status, done, partial, total, ratio: total ? (done + partial / 2) / total : 0 };
}

/** The next state when a part's box is pressed: open → done → partly done → open. */
export function nextPartState(current: QuestState | undefined): QuestState | null {
  if (current === undefined) return 'done';
  if (current === 'done') return 'partial';
  return null;
}

export interface QuestTotals {
  lines: number;
  done: number;
  started: number;
  parts: number;
  partsDone: number;
}

export function questTotals(lines: QuestLine[], gameId: string, marks: Map<string, QuestState>): QuestTotals {
  const totals: QuestTotals = { lines: lines.length, done: 0, started: 0, parts: 0, partsDone: 0 };
  for (const line of lines) {
    const progress = questProgress(line, gameId, marks);
    if (progress.status === 'done' || progress.status === 'skipped') totals.done++;
    else if (progress.status === 'started') totals.started++;
    totals.parts += progress.total;
    totals.partsDone += progress.done;
  }
  return totals;
}

/** Quests whose prerequisites are all finished but which are not, in catalog order. */
export function availableQuests(lines: QuestLine[], gameId: string, marks: Map<string, QuestState>): QuestLine[] {
  const status = new Map(lines.map((line) => [line.id, questProgress(line, gameId, marks).status]));
  const finished = (id: string) => status.get(id) === 'done' || status.get(id) === 'skipped';
  return lines.filter(
    (line) => status.get(line.id) === 'todo' && line.requires.every((id) => !status.has(id) || finished(id)),
  );
}

/** Case- and accent-insensitive search over title, series, region, characters and parts. */
export function questMatches(line: QuestLine, query: string): boolean {
  const fold = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  const needle = fold(query.trim());
  if (!needle) return true;
  const haystack = [
    line.title,
    line.series ?? '',
    line.region ?? '',
    line.version ?? '',
    ...line.characters,
    ...line.parts.flatMap((part) => [part.title, ...part.characters]),
  ];
  return haystack.some((value) => fold(value).includes(needle));
}
