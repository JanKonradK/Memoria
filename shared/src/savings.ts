import { z } from 'zod';
import type { VersionRow } from './version-history';

/**
 * Savings planner: from a balance the player types in, how many pulls they
 * have now and how many they can expect by each goal's deadline.
 *
 * Income comes from Version history: the free currency per day of recent
 * versions, scaled by how much of the free content the player says they do.
 * The forecast is an estimate of what the game hands out, not a promise, so it
 * is always shown as a range across those versions. Nothing here credits
 * currency automatically; entering a new balance starts the forecast again.
 */

export const MAX_SAVINGS_GOALS = 12;
/** How many recent versions with a sourced total feed the income range. */
export const SAVINGS_RECENT_VERSIONS = 6;
const DAY_MS = 86_400_000;
/** 2100-01-01. A goal further out is a typo, and would make the chart draw millions of month marks. */
export const LATEST_DEADLINE = Date.UTC(2100, 0, 1);

const amount = z.number().int().min(0).max(100_000_000);

export const SavingsGoalSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  targetPulls: z.number().int().min(1).max(10_000),
  /** End of the goal, epoch ms. A banner goal keeps its own copy in case the banner is deleted. */
  deadline: z.number().int().positive().max(LATEST_DEADLINE),
  /** The banner this goal is for, when it was picked from the calendar. */
  eventId: z.string().max(64).optional(),
});

export const GameSavingsSchema = z.object({
  /** Premium currency on hand when the player last entered it. */
  currency: amount,
  /** Pull tickets on hand, each worth one pull. */
  tickets: amount,
  /** When the balance was entered, epoch ms. */
  takenAt: z.number().int().positive(),
  /** Share of the free income the player expects to collect, 0–1. */
  participation: z.number().min(0).max(1).default(1),
  /** Cost of one pull. Absent uses the game's known cost. */
  pullCost: z.number().int().positive().max(100_000).optional(),
  /** Free currency per day when Version history has none for this game. */
  perDay: z.number().min(0).max(1_000_000).optional(),
  goals: z.array(SavingsGoalSchema).max(MAX_SAVINGS_GOALS).default([]),
  /** The player buys the monthly pass (Welkin Moon and the like) every month. */
  monthlyPass: z.boolean().optional(),
  /** The player buys the paid battle pass every version. */
  battlePass: z.boolean().optional(),
});

export type SavingsGoal = z.infer<typeof SavingsGoalSchema>;
export type GameSavings = z.infer<typeof GameSavingsSchema>;

export interface PaidPasses {
  monthly: { name: string; perDay: number; upfront: number };
  battle: { name: string; currency: number; tickets: number };
}

/** A version lasts six weeks in each of these games. */
export const VERSION_DAYS = 42;

/**
 * What each pass pays in premium currency (or limited pull tickets), per
 * docs/pity-rules.md. The monthly pass's up-front crystals convert one for one.
 */
export const PAID_PASSES: Record<string, PaidPasses> = {
  genshin: {
    monthly: { name: 'Blessing of the Welkin Moon', perDay: 90, upfront: 300 },
    battle: { name: 'Gnostic Hymn', currency: 680, tickets: 4 },
  },
  hsr: {
    monthly: { name: 'Express Supply Pass', perDay: 90, upfront: 300 },
    battle: { name: 'Nameless Glory', currency: 680, tickets: 4 },
  },
  zzz: {
    monthly: { name: 'Inter-Knot Membership', perDay: 90, upfront: 300 },
    battle: { name: 'New Eridu City Fund', currency: 680, tickets: 0 },
  },
  wuwa: {
    monthly: { name: 'Lunite Subscription', perDay: 90, upfront: 300 },
    battle: { name: 'Insider Channel', currency: 680, tickets: 0 },
  },
};

/** Currency a day from the passes the player buys. Not scaled by participation: it is paid for. */
export function paidPerDay(
  savings: Pick<GameSavings, 'monthlyPass' | 'battlePass'> | undefined,
  passes: PaidPasses | undefined,
  pullCost: number,
): number {
  if (!savings || !passes) return 0;
  let perDay = 0;
  if (savings.monthlyPass) perDay += passes.monthly.perDay + passes.monthly.upfront / 30;
  if (savings.battlePass) perDay += (passes.battle.currency + passes.battle.tickets * pullCost) / VERSION_DAYS;
  return perDay;
}

/** Free currency per day: the lowest, middle and highest of recent versions. */
export interface IncomeRange {
  low: number;
  mid: number;
  high: number;
  /** Versions the range was taken from, newest last. */
  versions: string[];
  source: 'history' | 'manual' | 'none';
  /** Currency a day from passes the player buys, on top of the free range. */
  paid: number;
}

function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * The income range from versions with a sourced total that ended before
 * `today` (YYYY-MM-DD), or the player's own figure. A running version's total
 * is still an estimate, so it waits until the version is over.
 */
export function incomeRange(rows: VersionRow[], today: string, manualPerDay?: number, paid = 0): IncomeRange {
  const recent = rows
    .filter((row) => row.perDay !== null && !!row.record.end && row.record.end < today)
    .slice(-SAVINGS_RECENT_VERSIONS);
  if (recent.length) {
    const rates = recent.map((row) => row.perDay!).sort((a, b) => a - b);
    return {
      low: rates[0]!,
      mid: median(rates),
      high: rates.at(-1)!,
      versions: recent.map((row) => row.record.version),
      source: 'history',
      paid,
    };
  }
  if (manualPerDay !== undefined) {
    return { low: manualPerDay, mid: manualPerDay, high: manualPerDay, versions: [], source: 'manual', paid };
  }
  return { low: 0, mid: 0, high: 0, versions: [], source: 'none', paid };
}

export const savedPulls = (savings: Pick<GameSavings, 'currency' | 'tickets'>, pullCost: number) =>
  savings.tickets + Math.floor(savings.currency / pullCost);

/** Currency expected on hand at `at`, for one free daily rate plus paid passes. Never earns backwards in time. */
export function currencyAt(savings: GameSavings, perDay: number, at: number, paid = 0): number {
  const days = Math.max(0, (at - savings.takenAt) / DAY_MS);
  return savings.currency + Math.floor((perDay * savings.participation + paid) * days);
}

export const pullsAt = (savings: GameSavings, perDay: number, pullCost: number, at: number, paid = 0) =>
  savings.tickets + Math.floor(currencyAt(savings, perDay, at, paid) / pullCost);

/** The first day the balance reaches `pulls`, or null if income cannot get there. */
export function dateForPulls(
  savings: GameSavings,
  perDay: number,
  pullCost: number,
  pulls: number,
  paid = 0,
): number | null {
  const needed = (pulls - savings.tickets) * pullCost - savings.currency;
  if (needed <= 0) return savings.takenAt;
  const rate = perDay * savings.participation + paid;
  if (rate <= 0) return null;
  return savings.takenAt + Math.ceil(needed / rate) * DAY_MS;
}

export interface GoalPlan {
  goal: SavingsGoal;
  /** Pulls reserved for this goal and every goal due before it. */
  needed: number;
  /** Expected pulls at the deadline, for the low, middle and high income. */
  expected: { low: number; mid: number; high: number };
  /** Pulls still missing at the middle income; zero when covered. */
  shortfall: number;
  /** When the middle income reaches `needed`, or null if it never does. */
  reachedAt: number | null;
  status: 'covered' | 'likely' | 'at-risk' | 'short' | 'past';
}

/**
 * Plans goals in deadline order. Pulls spent on an earlier goal are not
 * available to a later one, so each goal needs its own target plus every
 * earlier goal's target.
 */
export function planGoals(savings: GameSavings, income: IncomeRange, pullCost: number, now: number): GoalPlan[] {
  const goals = [...savings.goals].sort((a, b) => a.deadline - b.deadline || a.id.localeCompare(b.id));
  let reserved = 0;
  return goals.map((goal) => {
    // A goal that has ended no longer holds any pulls back.
    if (goal.deadline >= now) reserved += goal.targetPulls;
    const needed = reserved;
    const at = (perDay: number) => pullsAt(savings, perDay, pullCost, goal.deadline, income.paid);
    const expected = { low: at(income.low), mid: at(income.mid), high: at(income.high) };
    const now_ = savedPulls(savings, pullCost);
    const status: GoalPlan['status'] =
      goal.deadline < now
        ? 'past'
        : now_ >= needed
          ? 'covered'
          : expected.low >= needed
            ? 'likely'
            : expected.high >= needed
              ? 'at-risk'
              : 'short';
    return {
      goal,
      needed,
      expected,
      shortfall: Math.max(0, needed - expected.mid),
      reachedAt: dateForPulls(savings, income.mid, pullCost, needed, income.paid),
      status,
    };
  });
}
