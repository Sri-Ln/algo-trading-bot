import type { components } from "./schema";

type Schemas = components["schemas"];
export type Status = Schemas["Status"];
export type RunSummary = Schemas["RunSummary"];
export type Run = Schemas["Run"];
export type Step = Schemas["Step"];
export type History = Schemas["History"];
export type Decision = Schemas["Decision"];
export type Backtest = Schemas["Backtest"];
export type Costs = Schemas["Costs"];
export type CostPoint = Schemas["CostPoint"];
export type Sweep = Schemas["Sweep"];
export type System = Schemas["System"];
export type Periods = Schemas["Periods"];
export type Stats = Schemas["Stats"];

/** Everything the console needs up front; per-run and per-year files load on demand. */
export interface Snapshot {
  status: Status;
  runs: RunSummary[];
  history: History;
  backtest: Backtest;
  costs: Costs;
  sweep: Sweep;
  system: System;
}

// Relative URLs, so the console works under any path it is hosted at.
async function get<T>(path: string): Promise<T> {
  const response = await fetch(`api/${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function loadSnapshot(): Promise<Snapshot> {
  const [status, runs, history, backtest, costs, sweep, system] = await Promise.all([
    get<Status>("status.json"),
    get<RunSummary[]>("runs.json"),
    get<History>("history.json"),
    get<Backtest>("backtest.json"),
    get<Costs>("costs.json"),
    get<Sweep>("sweep.json"),
    get<System>("system.json"),
  ]);
  return { status, runs, history, backtest, costs, sweep, system };
}

const cache = new Map<string, Promise<unknown>>();

function cached<T>(path: string): Promise<T> {
  let hit = cache.get(path);
  if (!hit) {
    hit = get<T>(path);
    hit.catch(() => cache.delete(path));
    cache.set(path, hit);
  }
  return hit as Promise<T>;
}

export const loadRun = (day: string) => cached<Run>(`runs/${day}.json`);
export const loadDecisions = (year: string) =>
  cached<Record<string, Decision>>(`decisions/${year}.json`);
