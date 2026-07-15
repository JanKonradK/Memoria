import { DateTime } from 'luxon';
import type { AlertType, AppState, Settings } from './types';
import { DEFAULT_THRESHOLDS } from './types';
import { latestSnapshots, projectEnergy } from './energy';
import { checklistFor } from './checklist';
import {
  dailyPeriodKey,
  monthlyPeriodKey,
  nextDailyReset,
  nextMonthlyReset,
  nextWeeklyReset,
  weeklyPeriodKey,
} from './periods';
import { effectiveResourceKind } from './tracking';

export interface PendingAlert {
  /** Stable key so the same alert never fires twice (recorded server-side). */
  dedupeKey: string;
  gameId: string | null;
  type: AlertType | 'reminder';
  title: string;
  body: string;
  color: string;
}

function thresholdFor(state: AppState, gameId: string | null, type: AlertType): number | null {
  const rules = state.alertRules.filter((r) => !r.deleted && r.type === type);
  const specific = gameId ? rules.find((r) => r.gameId === gameId) : undefined;
  const global = rules.find((r) => r.gameId === null);
  const rule = specific ?? global;
  if (rule) return rule.enabled ? rule.thresholdMinutes : null;
  return DEFAULT_THRESHOLDS[type];
}

function fmtClock(at: number, settings: Settings): string {
  return DateTime.fromMillis(at, { zone: settings.localTz || 'system' }).toFormat('HH:mm');
}

function fmtIn(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Evaluate every alert condition against the state at `now`.
 * Pure — dedupe against already-sent keys and quiet hours are the caller's job.
 */
export function evaluateAlerts(state: AppState, now: number): PendingAlert[] {
  const out: PendingAlert[] = [];
  const snaps = latestSnapshots(state.snapshots);
  const games = state.games.filter((g) => !g.deleted && !g.paused);
  const settings = state.settings;

  for (const game of games) {
    // --- Energy nearing cap / capped ---
    const energyThreshold = thresholdFor(state, game.id, 'energy_cap');
    if (energyThreshold != null) {
      for (const res of state.resources) {
        if (res.gameId !== game.id || res.deleted || effectiveResourceKind(res) !== 'regen') continue;
        const snap = snaps.get(res.id);
        if (!snap) continue;
        const proj = projectEnergy(res, snap, now, game);
        if (proj.isFull) {
          out.push({
            dedupeKey: `energyfull:${res.id}:${snap.id}`,
            gameId: game.id,
            type: 'energy_cap',
            title: `${game.short}: ${res.name} is FULL`,
            body: `Regen is being wasted — log in and spend.`,
            color: game.color,
          });
        } else if (proj.msToFull != null && proj.fullAt != null && proj.msToFull <= energyThreshold * 60_000) {
          out.push({
            dedupeKey: `energy:${res.id}:${snap.id}`,
            gameId: game.id,
            type: 'energy_cap',
            title: `${game.short}: ${res.name} caps at ${fmtClock(proj.fullAt, settings)}`,
            body: `${proj.value}/${res.cap} now — full in ${fmtIn(proj.msToFull)}.`,
            color: game.color,
          });
        }
      }
    }

    // --- Dailies / weeklies / monthlies undone before reset ---
    const checklist = checklistFor(state, game, now);
    const groups: Array<{ cadence: 'daily' | 'weekly' | 'monthly'; type: AlertType; resetAt: number; key: string }> = [
      { cadence: 'daily', type: 'daily_undone', resetAt: nextDailyReset(game, now), key: dailyPeriodKey(game, now) },
      {
        cadence: 'weekly',
        type: 'weekly_undone',
        resetAt: nextWeeklyReset(game, now),
        key: weeklyPeriodKey(game, now),
      },
      {
        cadence: 'monthly',
        type: 'monthly_undone',
        resetAt: nextMonthlyReset(game, now),
        key: monthlyPeriodKey(game, now),
      },
    ];
    for (const grp of groups) {
      const threshold = thresholdFor(state, game.id, grp.type);
      if (threshold == null) continue;
      const undone = checklist.filter((c) => c.cadence === grp.cadence && !c.done);
      if (undone.length === 0) continue;
      const msToReset = grp.resetAt - now;
      if (msToReset <= threshold * 60_000) {
        out.push({
          dedupeKey: `${grp.type}:${game.id}:${grp.key}`,
          gameId: game.id,
          type: grp.type,
          title: `${game.short}: ${undone.length} ${grp.cadence} task${undone.length > 1 ? 's' : ''} left`,
          body: `${undone.map((u) => u.name).join(', ')} — resets at ${fmtClock(grp.resetAt, settings)} (in ${fmtIn(msToReset)}).`,
          color: game.color,
        });
      }
    }
  }

  // --- Events ending ---
  for (const ev of state.events) {
    if (ev.deleted || ev.done || !ev.notify || ev.end <= now) continue;
    const game = state.games.find((g) => g.id === ev.gameId && !g.deleted && !g.paused);
    if (!game) continue;
    const threshold = thresholdFor(state, game.id, 'event_end');
    if (threshold == null) continue;
    if (ev.end - now <= threshold * 60_000) {
      out.push({
        dedupeKey: `event:${ev.id}`,
        gameId: game.id,
        type: 'event_end',
        title: `${game.short}: "${ev.name}" ends in ${fmtIn(ev.end - now)}`,
        body: `Ends ${DateTime.fromMillis(ev.end, { zone: settings.localTz || 'system' }).toFormat('ccc dd LLL HH:mm')}.`,
        color: game.color,
      });
    }
  }

  // --- One-off reminders ---
  for (const rem of state.reminders) {
    if (rem.deleted || rem.at > now) continue;
    const game = rem.gameId ? state.games.find((g) => g.id === rem.gameId) : undefined;
    out.push({
      dedupeKey: `rem:${rem.id}`,
      gameId: rem.gameId,
      type: 'reminder',
      title: game ? `${game.short}: reminder` : 'Reminder',
      body: rem.message,
      color: game?.color ?? '#8b5cf6',
    });
  }

  return out;
}

/** Is `now` inside the configured quiet hours (local tz)? */
export function inQuietHours(settings: Settings, now: number): boolean {
  if (settings.quietStart == null || settings.quietEnd == null) return false;
  const dt = DateTime.fromMillis(now, { zone: settings.localTz || 'system' });
  const minutes = dt.hour * 60 + dt.minute;
  const { quietStart: start, quietEnd: end } = settings;
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end; // wraps past midnight
}

export function alertTypeLabel(type: AlertType): string {
  switch (type) {
    case 'energy_cap':
      return 'Energy nearing cap';
    case 'daily_undone':
      return 'Dailies not done';
    case 'weekly_undone':
      return 'Weeklies not done';
    case 'monthly_undone':
      return 'Monthlies not done';
    case 'event_end':
      return 'Event ending';
  }
}
