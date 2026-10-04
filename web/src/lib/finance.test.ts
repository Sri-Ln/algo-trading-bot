import { describe, expect, it } from "vitest";
import type { Backtest } from "../api/client";
import { drawdown, nextScheduledRun, reprice, spans, tally } from "./finance";

const backtest = (cost_bps: number) =>
  ({
    cost_bps,
    dates: ["d0", "d1", "d2", "d3"],
    equity: [1, 0.999, 1.1, 1.0989],
    trades: [
      { date: "d1", turnover: 2 },
      { date: "d3", turnover: 1 },
    ],
  }) as unknown as Backtest;

describe("reprice", () => {
  it("keeps the curve at its own cost", () => {
    expect(reprice(backtest(5), 5)).toEqual([1, 0.999, 1.1, 1.0989]);
  });

  it("rescales each trade day by the ratio of costs, cumulatively", () => {
    const free = reprice(backtest(5), 0);
    expect(free[0]).toBe(1);
    expect(free[1]).toBeCloseTo(0.999 / (1 - 2 * 0.0005), 12);
    expect(free[2]).toBeCloseTo(1.1 / (1 - 2 * 0.0005), 12);
    expect(free[3]).toBeCloseTo(1.0989 / ((1 - 2 * 0.0005) * (1 - 0.0005)), 12);
  });
});

describe("drawdown", () => {
  it("measures distance below the running peak", () => {
    expect(drawdown([1, 2, 1, 1.5, 3])).toEqual([0, 0, -0.5, -0.25, 0]);
  });
});

describe("nextScheduledRun", () => {
  const et = (iso: string) => nextScheduledRun(new Date(iso)).toISOString();

  it("runs later the same weekday when before 09:35 New York time", () => {
    expect(et("2026-10-05T12:00:00Z")).toBe("2026-10-05T13:35:00.000Z"); // Mon 08:00 EDT
  });

  it("skips the weekend", () => {
    expect(et("2026-10-02T14:00:00Z")).toBe("2026-10-05T13:35:00.000Z"); // Fri 10:00 EDT
    expect(et("2026-10-03T23:00:00Z")).toBe("2026-10-05T13:35:00.000Z"); // Sat evening
  });

  it("follows daylight saving time", () => {
    // Clocks go back on Sun 2026-11-01: Monday 09:35 is 14:35 UTC.
    expect(et("2026-10-30T15:00:00Z")).toBe("2026-11-02T14:35:00.000Z");
  });
});

describe("spans and tally", () => {
  it("groups consecutive equal keys", () => {
    expect(spans(["a", "a", "b", "a"], (x) => x)).toEqual([
      { key: "a", from: 0, to: 1 },
      { key: "b", from: 2, to: 2 },
      { key: "a", from: 3, to: 3 },
    ]);
    expect(tally(["a", "b", "a", "c"], 0, 2)).toEqual({ a: 2, b: 1 });
  });
});
