import type { AppState, Resource } from './types';
import type { GameImportBatch, ResourceObservation, TaskObservation } from './automation';
import { effectiveResourceKind } from './tracking';

export type HoYoProvider = 'genshin' | 'hsr' | 'zzz';

export interface HoYoNotesObservation {
  provider: HoYoProvider;
  uid: string;
  observedAt: number;
  /** The data object from dailyNote/note, not authentication or response headers. */
  data: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/** Small deterministic dedupe identifier, not an authentication or security hash. */
function fingerprint(value: string): string {
  let hash = 2166136261;
  let other = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    other = Math.imul(other, 33) ^ value.charCodeAt(index);
  }
  return `${(hash >>> 0).toString(16)}${(other >>> 0).toString(16)}`;
}

function finish(batch: GameImportBatch, identity = ''): GameImportBatch {
  return {
    ...batch,
    id: `${batch.source.kind}:${fingerprint(JSON.stringify([batch.gameId, identity, batch.observedAt, batch.resources, batch.tasks]))}`,
  };
}

function sameName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.toLocaleLowerCase();
}

function namedResource(resources: Resource[], name: string, primary = false): Resource | undefined {
  const exact = resources.filter((resource) => sameName(resource.name, name));
  if (exact.length > 0) return exact.length === 1 ? exact[0] : undefined;
  if (!primary) return undefined;
  const regen = resources.filter((resource) => effectiveResourceKind(resource) === 'regen');
  // A Genshin account can retain only its teapot meter after resin is deleted.
  // Being the sole regenerating resource does not make that meter Original Resin.
  if (name === 'Original Resin' && regen.some((resource) => sameName(resource.name, 'Realm Currency')))
    return undefined;
  return regen.length === 1 ? regen[0] : undefined;
}

/**
 * Map only documented real-time note fields and stable preset task keys.
 * API aliases verified against genshin.py models for Genshin, Star Rail and ZZZ:
 * https://github.com/seriaati/genshin.py/tree/master/genshin/models
 */
export function mapHoYoNotes(state: AppState, gameId: string, observation: HoYoNotesObservation): GameImportBatch {
  const batch: GameImportBatch = {
    id: '',
    gameId,
    observedAt: observation.observedAt,
    source: { kind: 'account', provider: `hoyolab:${observation.provider}` },
    resources: [],
    tasks: [],
  };
  const game = state.games.find((item) => item.id === gameId && !item.deleted);
  if (!game || game.presetKey !== observation.provider || !/^\d{5,20}$/.test(observation.uid)) return finish(batch);
  const data = record(observation.data);
  const resources = state.resources.filter((item) => item.gameId === gameId && !item.deleted);
  const addResource = (name: string, value: unknown, reserve?: unknown, primary = false) => {
    const resource = namedResource(resources, name, primary);
    const amount = number(value);
    const reserveAmount = number(reserve);
    if (!resource || amount == null) return;
    batch.resources!.push({
      resourceId: resource.id,
      value: amount,
      ...(reserveAmount == null ? {} : { reserve: reserveAmount }),
    });
  };
  const addTask = (presetTaskKey: string, done: boolean | undefined) => {
    if (done == null) return;
    const matching = state.tasks.filter(
      (task) => task.gameId === gameId && task.presetTaskKey === presetTaskKey && !task.deleted,
    );
    if (matching.length === 1) batch.tasks!.push({ taskId: matching[0]!.id, done });
  };
  const complete = (current: unknown, max: unknown): boolean | undefined => {
    const value = number(current);
    const cap = number(max);
    return value != null && cap != null && cap > 0 && value <= cap ? value === cap : undefined;
  };

  if (observation.provider === 'genshin') {
    addResource('Original Resin', data.current_resin, undefined, true);
    addResource('Realm Currency', data.current_home_coin ?? data.current_realm_currency);
    const daily = record(data.daily_task);
    const finished =
      data.finished_task_num ?? data.completed_commissions ?? daily.finished_num ?? daily.completed_tasks;
    const total = data.total_task_num ?? data.max_commissions ?? daily.total_num ?? daily.max_tasks;
    const claimed =
      data.is_extra_task_reward_received ??
      data.claimed_commission_reward ??
      daily.is_extra_task_reward_received ??
      daily.claimed_commission_reward;
    const allDone = complete(finished, total);
    // Four commissions alone do not prove the final commission reward was claimed.
    addTask('genshin-commissions', allDone == null || typeof claimed !== 'boolean' ? undefined : allDone && claimed);
  } else if (observation.provider === 'hsr') {
    addResource('Trailblaze Power', data.current_stamina, data.current_reserve_stamina, true);
    addTask('hsr-daily-training', complete(data.current_train_score, data.max_train_score));
  } else if (observation.provider === 'zzz') {
    const energy = record(data.energy ?? data.battery_charge);
    const progress = record(energy.progress);
    addResource('Battery Charge', progress.current ?? energy.current, undefined, true);
    const vitality = record(data.vitality ?? data.engagement);
    addTask('zzz-engagement', complete(vitality.current, vitality.max));
  }
  return finish(batch, `${observation.provider}:${observation.uid}`);
}

const RESOURCE_ALIASES: Record<string, string[]> = {
  'original resin': ['Original Resin'],
  'condensed resin': ['Condensed Resin'],
  'realm currency': ['Realm Currency'],
  'trailblaze power': ['Trailblaze Power'],
  'battery charge': ['Battery Charge'],
  waveplates: ['Waveplates', 'Waveplate'],
};

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Require a label and an adjacent value, never route a bare ratio to a game. */
function labeledReading(text: string, aliases: string[], cap: number): number | undefined {
  const candidates = new Set<number>();
  for (const alias of aliases) {
    // Keep the label at a line boundary: "Reserve Trailblaze Power" must never
    // be mistaken for the main "Trailblaze Power" meter.
    const pattern = new RegExp(
      `(?:^|[\\n\\r])\\s*${escaped(alias)}[\\t :：=]*\\n?\\s*(\\d{1,7}(?:,\\d{3})*)(?:[ \\t]*[/／][ \\t]*(\\d{1,7}(?:,\\d{3})*))?(?![\\d.,])`,
      'gi',
    );
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]!.replaceAll(',', ''));
      const denominator = match[2] == null ? undefined : Number(match[2].replaceAll(',', ''));
      if (value <= cap && (denominator == null || denominator === cap)) candidates.add(value);
    }
  }
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

/** OCR is advisory: every detected value still needs the user's review. */
export function parseScreenshotReadings(
  state: AppState,
  gameId: string,
  text: string,
  observedAt: number,
): GameImportBatch {
  const resources: ResourceObservation[] = [];
  const tasks: TaskObservation[] = [];
  const batch: GameImportBatch = {
    id: '',
    gameId,
    observedAt,
    source: { kind: 'screenshot', provider: 'screenshot-text' },
    resources,
    tasks,
  };
  if (!state.games.some((game) => game.id === gameId && !game.deleted) || text.length > 50_000) return finish(batch);
  const rows = state.resources.filter((resource) => resource.gameId === gameId && !resource.deleted);
  for (const resource of rows) {
    const name = resource.name.trim().toLocaleLowerCase();
    const aliases = RESOURCE_ALIASES[name] ?? (resource.name.trim() ? [resource.name.trim()] : []);
    if (!aliases.length || rows.filter((row) => sameName(row.name, resource.name)).length !== 1) continue;
    const value = labeledReading(text, aliases, resource.cap);
    if (value == null) continue;
    let reserve: number | undefined;
    if (name === 'trailblaze power')
      reserve = labeledReading(
        text,
        ['Reserve Trailblaze Power', 'Reserved Trailblaze Power', 'Reserve TB Power'],
        resource.reserveCap,
      );
    if (name === 'battery charge') reserve = labeledReading(text, ['Backup Battery'], resource.reserveCap);
    if (name === 'waveplates') reserve = labeledReading(text, ['Waveplate Crystals'], resource.reserveCap);
    resources.push({ resourceId: resource.id, value, ...(reserve == null ? {} : { reserve }), confidence: 0.85 });
  }
  return finish(batch);
}

/** Unassigned suggestions only. The UI must ask which resource each ratio represents. */
export function extractScreenshotRatios(text: string): { value: number; cap: number }[] {
  if (text.length > 50_000) return [];
  const candidates = new Map<string, { value: number; cap: number }>();
  const pattern = /(?:^|[\s:：(])([0-9]{1,10})[ \t]*[/／][ \t]*([0-9]{1,10})(?=$|[\s),;])/gm;
  for (const match of text.matchAll(pattern)) {
    const value = Number(match[1]);
    const cap = Number(match[2]);
    if (value <= cap && cap > 0 && cap <= 2_147_483_647) candidates.set(`${value}/${cap}`, { value, cap });
    if (candidates.size >= 20) break;
  }
  return [...candidates.values()];
}
