import type { AppState, Game, Resource, Snapshot, Wallet } from './types';
import { dailyPeriodKey } from './periods';
import { completionId } from './checklist';
import { latestSnapshots, projectEnergy } from './energy';

const DAY = 86_400_000;

/**
 * Points of regen wasted at cap inside [from, to], reconstructed from the
 * snapshot history: between consecutive readings the resource regenerates
 * linearly, and every minute spent at cap wastes 1/regenMinutes points.
 * Accuracy is bounded by how often values were entered (or auto-imported).
 */
export function wastedRegen(
  res: Pick<Resource, 'cap' | 'regenMinutes'>,
  snapshots: Snapshot[],
  from: number,
  to: number,
): number {
  if (res.regenMinutes <= 0 || to <= from) return 0;
  const period = res.regenMinutes * 60_000;
  const sorted = [...snapshots].sort((a, b) => a.takenAt - b.takenAt);
  let total = 0;
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    const segEnd = i + 1 < sorted.length ? sorted[i + 1]!.takenAt : to;
    const cappedAt = s.takenAt + Math.max(0, res.cap - s.value) * period;
    const a = Math.max(from, cappedAt);
    const b = Math.min(to, segEnd);
    if (b > a) total += (b - a) / period;
  }
  return Math.floor(total);
}

/** Wasted regen for every resource of a game over the trailing window. */
export function gameWaste(state: AppState, game: Game, windowMs: number, now: number): Array<{ res: Resource; wasted: number }> {
  return state.resources
    .filter((r) => r.gameId === game.id && !r.deleted && r.regenMinutes > 0)
    .sort((a, b) => a.sort - b.sort)
    .map((res) => ({
      res,
      wasted: wastedRegen(
        res,
        state.snapshots.filter((s) => s.resourceId === res.id),
        now - windowMs,
        now,
      ),
    }));
}

export interface HeatDay {
  /** ISO date of the game-day (already shifted by the reset hour). */
  date: string;
  done: number;
  total: number;
}

/** Daily-task completion per game-day for the trailing `days` days (oldest first). */
export function dailyHeatmap(state: AppState, game: Game, days: number, now: number): HeatDay[] {
  const dailyTasks = state.tasks.filter((t) => t.gameId === game.id && !t.deleted && t.cadence === 'daily');
  const doneById = new Map(state.completions.filter((c) => !c.deleted).map((c) => [c.id, c.done]));
  const out: HeatDay[] = [];
  for (let k = days - 1; k >= 0; k--) {
    const key = dailyPeriodKey(game, now - k * DAY);
    out.push({
      date: key.slice(1),
      done: dailyTasks.filter((t) => doneById.get(completionId(t.id, key))).length,
      total: dailyTasks.length,
    });
  }
  return out;
}

/**
 * Consecutive game-days with ALL daily tasks done, counting back from today.
 * Today being still in progress does not break the streak.
 */
export function dailyStreak(state: AppState, game: Game, now: number): number {
  const dailyTasks = state.tasks.filter((t) => t.gameId === game.id && !t.deleted && t.cadence === 'daily');
  if (dailyTasks.length === 0) return 0;
  const doneById = new Map(state.completions.filter((c) => !c.deleted).map((c) => [c.id, c.done]));
  let streak = 0;
  for (let k = 0; k < 400; k++) {
    const key = dailyPeriodKey(game, now - k * DAY);
    const all = dailyTasks.every((t) => doneById.get(completionId(t.id, key)));
    if (all) streak++;
    else if (k === 0) continue; // today isn't over yet
    else break;
  }
  return streak;
}

export interface SleepCheck {
  /** Some resource hits cap within the sleep window (regen will be wasted). */
  caps: boolean;
  /** Earliest cap moment among regenerating resources; null if none applicable. */
  fullAt: number | null;
}

export interface WalletProjection {
  /** Estimated balance right now (entered balance + income since entry). */
  current: number;
  /** Next patch start, rolled forward past `now` by patchDays. Null if unset. */
  patchAt: number | null;
  daysToPatch: number | null;
  /** Estimated balance at patch start. */
  atPatch: number | null;
  /** Whole pulls that balance buys. */
  pullsAtPatch: number | null;
}

const WALLET_DAY = 86_400_000;

/** Project a premium-currency wallet forward to now and to the next patch. */
export function projectWallet(w: Wallet, now: number): WalletProjection {
  const current = Math.max(0, Math.round(w.balance + Math.max(0, now - w.balanceAt) / WALLET_DAY * w.dailyIncome));
  let patchAt = w.nextPatchAt;
  if (patchAt != null && w.patchDays > 0) {
    while (patchAt <= now) patchAt += w.patchDays * WALLET_DAY;
  }
  if (patchAt != null && patchAt <= now) patchAt = null; // patchDays 0 and date passed
  const daysToPatch = patchAt != null ? (patchAt - now) / WALLET_DAY : null;
  const atPatch = patchAt != null && daysToPatch != null ? Math.round(current + daysToPatch * w.dailyIncome) : null;
  return {
    current,
    patchAt,
    daysToPatch,
    atPatch,
    pullsAtPatch: atPatch != null && w.pullCost > 0 ? Math.floor(atPatch / w.pullCost) : null,
  };
}

/** Would sleeping `sleepHours` from now waste regen in this game? */
export function sleepCheck(state: AppState, game: Game, sleepHours: number, now: number): SleepCheck {
  const snaps = latestSnapshots(state.snapshots);
  const horizon = now + sleepHours * 3_600_000;
  let fullAt: number | null = null;
  for (const res of state.resources.filter((r) => r.gameId === game.id && !r.deleted && r.regenMinutes > 0)) {
    const proj = projectEnergy(res, snaps.get(res.id), now);
    if (!proj.hasSnapshot) continue;
    const at = proj.isFull ? now : proj.fullAt;
    if (at != null && at <= horizon && (fullAt == null || at < fullAt)) fullAt = at;
  }
  return { caps: fullAt != null, fullAt };
}
