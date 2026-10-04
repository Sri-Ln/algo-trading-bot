import type { Backtest } from "../api/client";

/**
 * The backtest's equity curve at another trading cost.
 *
 * Costs scale the portfolio's value but never its weights, so the trades are
 * the same at every cost: each trade day's value is rescaled by the ratio of
 * what that trade would have cost. Mirrors ``backtest.with_cost`` in Python.
 */
export function reprice(backtest: Backtest, costBps: number): number[] {
  const base = backtest.cost_bps / 10_000;
  const cost = costBps / 10_000;
  const step = new Map<string, number>();
  for (const t of backtest.trades) {
    step.set(t.date, (1 - t.turnover * cost) / (1 - t.turnover * base));
  }
  let factor = 1;
  return backtest.equity.map((value, i) => {
    factor *= step.get(backtest.dates[i]!) ?? 1;
    return value * factor;
  });
}

/** Fraction below the running peak on each day (0 at a new high). */
export function drawdown(values: number[]): number[] {
  let peak = -Infinity;
  return values.map((v) => {
    peak = Math.max(peak, v);
    return v / peak - 1;
  });
}

/** Minutes New York is ahead of UTC at ``instant`` (negative: −240 in summer). */
function newYorkOffset(instant: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    })
      .formatToParts(instant)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const local = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!);
  return Math.round((local - instant.getTime()) / 60000);
}

/**
 * Next weekday 09:35 in New York strictly after ``now``: when the scheduler
 * starts the bot. Market holidays are not known here; the bot checks the
 * broker's clock and skips them.
 */
export function nextScheduledRun(now: Date, hour = 9, minute = 35): Date {
  const start = new Date(now.getTime() + newYorkOffset(now) * 60000); // New York wall clock
  for (let add = 0; add < 8; add++) {
    const day = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + add, hour, minute),
    );
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    // ``day`` holds New York wall-clock time; shift by the offset in force then.
    const guess = new Date(day.getTime() - newYorkOffset(day) * 60000);
    const at = new Date(day.getTime() - newYorkOffset(guess) * 60000);
    if (at > now) return at;
  }
  throw new Error("unreachable: a weekday falls within any eight days");
}

export interface Span {
  key: string;
  from: number;
  to: number;
}

/** Consecutive index ranges sharing the same ``keyOf`` value. */
export function spans<T>(items: T[], keyOf: (item: T) => string, from = 0): Span[] {
  const out: Span[] = [];
  for (let i = from; i < items.length; i++) {
    const key = keyOf(items[i]!);
    const last = out[out.length - 1];
    if (last && last.key === key) last.to = i;
    else out.push({ key, from: i, to: i });
  }
  return out;
}

/** How many times each value appears in ``values[from..to]``. */
export function tally(values: string[], from: number, to: number): Record<string, number> {
  const counts: Record<string, number> = {};
  for (let i = from; i <= to; i++) counts[values[i]!] = (counts[values[i]!] ?? 0) + 1;
  return counts;
}
