import { useMemo, useState } from "react";
import { loadDecisions, loadRun, type Decision, type Snapshot } from "../api/client";
import { HistoryChart } from "../charts/HistoryChart";
import { YearsTable } from "../charts/YearsTable";
import { StatusBadge } from "../components/Chips";
import { DatePicker } from "../components/DatePicker";
import { tip } from "../components/Tip";
import { DecisionJson, DecisionTrace, RunTrace } from "../components/Trace";
import { DESC, NAMES, regime } from "../content";
import { duration, fmtDate, nyTime } from "../lib/format";
import { useAsync } from "../lib/useAsync";

export interface Selection {
  src: "live" | "replay";
  run: string | null; // trading day of the selected live run
  day: number; // index into the history of the replayed day
}

interface Props {
  data: Snapshot;
  equity: number[];
  selection: Selection;
  onSelect: (s: Selection) => void;
}

export function Decisions({ data, equity, selection, onSelect }: Props) {
  const { history, backtest, runs } = data;
  const [view, setView] = useState<"trace" | "json">("trace");
  const [reveal, setReveal] = useState(true);
  const live = selection.src === "live" && selection.run !== null;
  const date = history.dates[selection.day]!;

  const { value: run } = useAsync(() => (live ? loadRun(selection.run!) : null), [live, selection.run]);
  const { value: year } = useAsync(() => (live ? null : loadDecisions(date.slice(0, 4))), [live, date.slice(0, 4)]);
  const decision: Decision | undefined | null = live ? run?.decision : year?.[date];
  const decisionDay = decision ? history.dates.indexOf(decision.date) : -1;
  const cursor = live ? (decisionDay >= 0 ? decisionDay : history.dates.length - 1) : selection.day;
  const windows = { riskOn: backtest.risk_on_rsi_window, risingRates: backtest.rising_rates_rsi_window };
  const signal2 = cursor >= 0 ? history.signal_2[cursor] : undefined;
  const tradeDays = useMemo(() => new Set(backtest.trades.map((t) => t.date)), [backtest.trades]);
  const pickDay = (day: number) => onSelect({ ...selection, src: "replay", day });

  return (
    <section data-panel="decisions">
      <div className="tab-head">
        <h1>Decisions</h1>
        <p>
          Each run calls one pure function, <span className="mono">strategy(closes, params)</span>, that returns the decision and the
          reasoning behind it. Pick a live run, or replay any day since {history.dates[0]!.slice(0, 4)}.
        </p>
      </div>
      <div className="grid g13">
        <div className="card">
          <div className="seg" role="group" aria-label="Source">
            <button
              aria-pressed={selection.src === "live"}
              onClick={() => onSelect({ ...selection, src: "live", run: selection.run ?? runs[0]?.trading_day ?? null })}
              {...tip("Live runs", "Runs the bot actually executed against the paper account, one per weekday.")}
            >
              Live runs
            </button>
            <button
              aria-pressed={selection.src === "replay"}
              onClick={() => onSelect({ ...selection, src: "replay" })}
              {...tip("Replay history", "Run the same strategy function on any past day to see what it would have decided. Nothing is traded.")}
            >
              Replay
            </button>
          </div>
          {selection.src === "live" ? (
            <div className="runs" role="listbox" aria-label="Live runs">
              {runs.length === 0 && <p className="empty">No live runs yet.</p>}
              {runs.map((r) => (
                <button
                  key={r.trading_day}
                  role="option"
                  aria-selected={r.trading_day === selection.run}
                  onClick={() => onSelect({ ...selection, src: "live", run: r.trading_day })}
                  {...tip(
                    `Run ${r.trading_day}`,
                    `The bot's run on ${fmtDate(r.trading_day)}. Click to see its trace.`,
                    r.status === "skipped" ? "Market closed, nothing to do." : r.regime ? `${regime(r.regime).name}, ${r.orders} orders${r.dry_run ? " planned (dry run)" : ""}.` : r.error ?? undefined,
                  )}
                >
                  <span style={{ color: r.status === "ok" ? "var(--ok)" : r.status === "failed" ? "var(--err)" : "var(--faint)" }}>●</span>
                  <span className="d">{r.trading_day}</span>
                  <span className="mono" style={{ color: "var(--faint)", fontSize: ".74rem" }}>
                    {duration(r.duration_ms)}
                  </span>
                  <span className="m">
                    {r.regime ? (
                      <>
                        <span className="sq" style={{ background: regime(r.regime).color }} />
                        {r.regime}
                      </>
                    ) : (
                      r.status
                    )}
                    {r.orders > 0 && ` · ${r.orders} orders`}
                    {r.dry_run && " · dry run"}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <DatePicker dates={history.dates} regimes={history.regime} day={selection.day} onDay={pickDay} />
          )}
        </div>
        <div className="card">
          <div className="card-h">
            <h2 id="trHead">
              {live ? (
                <>
                  Run {selection.run}{" "}
                  {run && (
                    <>
                      <span className="mono hm">
                        · {nyTime(run.started_at).slice(0, 5)} ET · {duration(runs.find((r) => r.trading_day === run.trading_day)?.duration_ms)}
                      </span>{" "}
                      <StatusBadge status={run.status} /> {run.dry_run && <span className="badge dim">dry run</span>}
                    </>
                  )}
                </>
              ) : (
                <ReplayHead date={date} next={history.dates[selection.day + 1]} decision={decision ?? undefined} tradeDays={tradeDays} />
              )}
            </h2>
            <div className="seg" role="group" aria-label="View">
              <button aria-pressed={view === "trace"} onClick={() => setView("trace")} {...tip("Trace view", "The decision as a readable sequence of steps.")}>
                Trace
              </button>
              <button
                aria-pressed={view === "json"}
                onClick={() => setView("json")}
                {...tip("JSON view", "The raw output of strategy(), exactly as the API serves it. JSON is a standard text format for structured data.")}
              >
                JSON
              </button>
            </div>
          </div>
          {view === "trace" && live && run && <RunTrace run={run} windows={windows} signal2={signal2} />}
          {view === "trace" && !live && decision && <DecisionTrace decision={decision} windows={windows} signal2={signal2} />}
          {view === "json" && decision && <DecisionJson decision={decision} />}
          {live && run && !decision && <p className="empty">This run stopped before deciding: {run.status === "skipped" ? "the market was closed." : run.error}</p>}
          {decision && <Allocation decision={decision} />}
        </div>
      </div>
      <div className="card">
        <div className="card-h">
          <h3
            {...tip(
              "Decision history",
              "Every daily decision since the backtest start. The top strip is the mode the bot was in. Below are the two signals that decide it: only whether each is above or below zero matters. Signal 2 is greyed out where signal 1 already chose risk on, because the bot ignores it then. The vertical line is the day shown above; click anywhere to jump there.",
            )}
          >
            History · {history.dates[0]!.slice(0, 4)}–{history.dates[history.dates.length - 1]!.slice(0, 4)}
          </h3>
          <div className="keys">
            <span className="key">
              <span className="sw box" style={{ background: "var(--on)" }} />
              risk on
            </span>
            <span className="key">
              <span className="sw box" style={{ background: "var(--rising)" }} />
              rising rates
            </span>
            <span className="key">
              <span className="sw box" style={{ background: "var(--falling)" }} />
              falling rates
            </span>
            <label
              className="toggle"
              {...tip(
                "Draw as time passes",
                "On: the chart is only drawn up to the selected day, so pressing Play draws it in as time moves forward, as the bot would have seen it. Off: the whole history is shown at once.",
              )}
            >
              <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /> Draw as time passes
            </label>
          </div>
        </div>
        <HistoryChart
          dates={history.dates}
          regimes={history.regime}
          signal1={history.signal_1}
          signal2={history.signal_2}
          cursor={cursor}
          reveal={reveal}
          onPick={pickDay}
        />
        <YearsTable dates={history.dates} regimes={history.regime} equity={equity} benchmark={backtest.benchmark} cursor={cursor} onPick={pickDay} />
      </div>
    </section>
  );
}

function ReplayHead({ date, next, decision, tradeDays }: { date: string; next?: string; decision?: Decision; tradeDays: Set<string> }) {
  // A decision on day t's close fills at day t+1's open.
  const trades = next !== undefined && tradeDays.has(next);
  const what = !next ? "fills at the next open" : trades ? `would trade into ${Object.keys(decision?.weights ?? {}).join(" + ")}` : "no trade needed";
  return (
    <>
      <span {...tip("Replay", "A what-if: the strategy re-run on this past day using only prices known at its close. Nothing is sent to the broker.")}>Replay</span>{" "}
      <span className="mono hm">
        · {date} ·{" "}
        <span
          {...tip(
            trades ? "Would trade" : "No trade needed",
            trades
              ? "The target differed from what the backtest held by more than 2 percentage points, so it traded at the next day's open."
              : "The target matched what the backtest already held (within 2 percentage points), so no orders were needed.",
          )}
        >
          {what}
        </span>
      </span>
    </>
  );
}

function Allocation({ decision }: { decision: Decision }) {
  const color = regime(decision.regime).color;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <h3 {...tip("Target portfolio", "How the bot splits the money for the next trading day. Each block is one fund; width = share of the money.")}>
        Output · target weights
      </h3>
      <div className="allocbar">
        {Object.entries(decision.weights).map(([t, w], j) => (
          <div
            key={t}
            style={{ flex: w, background: `color-mix(in oklab, ${color} ${100 - j * 18}%, var(--ink))` }}
            {...tip(`${t}: ${NAMES[t] ?? t}`, DESC[t] ?? "", `${Math.round(w * 100)}% of the money: $${(w * 10000).toLocaleString("en-US")} of every $10,000.`)}
          >
            {t} {Math.round(w * 100)}%
          </div>
        ))}
      </div>
    </div>
  );
}
