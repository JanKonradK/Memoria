import type { Resource, ResourceKind, Task, TaskMode } from './types';

const COUNTER_NAMES = ['condensed resin'];
const WEEKLY_NAMES = ['city stamina'];

const RESERVE_LABELS: Record<string, string> = {
  'trailblaze power': 'Reserve TB Power',
  'battery charge': 'Backup Battery',
  waveplates: 'Waveplate Crystals',
};

export function effectiveResourceKind(res: Pick<Resource, 'regenMinutes' | 'kind'> & { name?: string }): ResourceKind {
  if (res.kind) return res.kind;
  if (!res.name) return res.regenMinutes > 0 ? 'regen' : 'counter';
  const lower = res.name.toLowerCase();
  if (WEEKLY_NAMES.some((name) => lower.includes(name))) return 'weekly';
  if (res.regenMinutes <= 0 || COUNTER_NAMES.some((name) => lower.includes(name))) return 'counter';
  return 'regen';
}

/** Minutes per reserve point once the main bar is capped — reserve fills at half speed by default. */
export function effectiveReserveRegenMinutes(
  res: Pick<Resource, 'regenMinutes'> & { reserveRegenMinutes?: number },
): number {
  return res.reserveRegenMinutes ?? res.regenMinutes * 2;
}

export function effectiveReserveLabel(res: Pick<Resource, 'name' | 'reserveCap' | 'reserveLabel'>): string | undefined {
  if (res.reserveLabel) return res.reserveLabel;
  if (res.reserveCap <= 0) return undefined;
  return RESERVE_LABELS[res.name.toLowerCase()];
}

function countTargetFromName(name: string): number | undefined {
  const match = name.match(/[×x]\s*(\d+)/i);
  if (match) return Number(match[1]);
  if (/weekly boss/i.test(name)) return 3;
  if (/echo of war/i.test(name)) return 3;
  if (/anomaly pilgrimage/i.test(name)) return 3;
  return undefined;
}

export function effectiveTaskMode(task: Pick<Task, 'name' | 'mode'>): TaskMode {
  if (task.mode) return task.mode;
  const lower = task.name.toLowerCase();
  if (lower.includes('expedition') || lower.includes('assignment')) return 'timer';
  if (countTargetFromName(task.name) != null) return 'count';
  return 'check';
}

export function effectiveTimerDurationMinutes(task: Pick<Task, 'timerDurationMinutes'>): number {
  return task.timerDurationMinutes ?? 20 * 60;
}

export function effectiveCountTarget(task: Pick<Task, 'name' | 'countTarget'>): number {
  return task.countTarget ?? countTargetFromName(task.name) ?? 1;
}

export function inferLegacyResource(res: Resource): Resource {
  const kind = effectiveResourceKind(res);
  const reserveLabel = effectiveReserveLabel(res);
  return {
    ...res,
    kind,
    ...(reserveLabel ? { reserveLabel } : {}),
  };
}

export function inferLegacyTask(task: Task): Task {
  const mode = effectiveTaskMode(task);
  const next: Task = { ...task, mode };
  if (mode === 'timer') next.timerDurationMinutes = effectiveTimerDurationMinutes(task);
  if (mode === 'count') next.countTarget = effectiveCountTarget(task);
  if (mode === 'timer' && task.timerEndsAt === undefined) next.timerEndsAt = null;
  return next;
}
