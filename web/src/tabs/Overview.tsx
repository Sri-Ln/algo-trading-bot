import { loadRun, type Run, type Snapshot } from "../api/client";
import type { Tab } from "../App";
import { EquityChart } from "../charts/EquityChart";
import { LinesSkeleton, Pending, TraceSkeleton } from "../components/Skeleton";
import { tip } from "../components/Tip";
import { RunTrace } from "../components/Trace";
import { GLOSSARY, regime, saySharpe } from "../content";
import { ago, duration, fmtDate, nyTime, pct, usd } from "../lib/format";
import { useAsync } from "../lib/useAsync";

interface Props {
  data: Snapshot;
  equity: number[];
  now: Date;
  onGoto: (tab: Tab) => void;
  onPick: (day: number) => void;
}

export function Overview({ data, equity, now, onGoto, onPick }: Props) {
  const { runs, backtest, history } = data;
  const latest = runs[0];
  const { value: run, error: runError } = useAsync(() => (latest ? loadRun(latest.trading_day) : null), [latest?.trading_day]);
  const runLoading = Boolean(latest && !run && !runError);
  const holdout = history.dates.indexOf(history.holdout_start);
  const firstYear = history.dates[0]!.slice(0, 4);
  const lastYear = history.dates[history.dates.length - 1]!.slice(0, 4);

  return (
    <section data-panel="overview">
      <div className="tab-head">
        <h1>Overview</h1>
        <p>A bot that checks the bond market every morning, picks one of three modes, and trades a paper account to match.</p>
      </div>
      <Kpis data={data} years={`${firstYear}–${lastYear}`} />
      <div className="grid g32">
        <div className="card" data-tour="latest-run">
          <div className="card-h">
            <h3 {...tip("Latest run", "The most recent daily run of the bot, step by step. Each line is one stage of the pipeline, with how long it took and whether it succeeded.")}>
              Latest run{latest && ` · ${latest.trading_day}`}
            </h3>
            <button className="link" onClick={() => onGoto("decisions")}>
              Open in Decisions →
            </button>
          </div>
          {!latest && <p className="empty">No live runs yet. The first scheduled run fills this in.</p>}
          {runLoading && (
            <Pending label="Loading the latest run">
              <TraceSkeleton rows={5} />
            </Pending>
          )}
          {runError && <p className="empty">Couldn't load this run: {runError.message}</p>}
          {run && (
            <RunTrace
              run={run}
              compact
              windows={{ riskOn: backtest.risk_on_rsi_window, risingRates: backtest.rising_rates_rsi_window }}
            />
          )}
        </div>
        <div className="card" data-tour="services">
          <h3 {...tip("Services", "The parts the bot depends on, as seen by its latest run. In engineering this is a status page.")}>Services</h3>
          {runLoading ? (
            <Pending label="Loading service status">
              <LinesSkeleton rows={5} />
            </Pending>
          ) : (
            <Services data={data} run={run} now={now} />
          )}
          <h3 style={{ marginTop: 8 }} {...tip("Event log", "Recent things the system did or noticed, newest first, taken from the saved run records.")}>
            Events
          </h3>
          <Events data={data} />
        </div>
      </div>
      <div className="card" data-tour="backtest">
        <div className="card-h">
          <h3
            {...tip(
              "Backtest equity",
              `What $1 invested in ${fmtDate(history.dates[0]!)} would be worth over time, following the rules (blue) vs. just holding the US stock market, SPY (grey). This comes from a simulation on past prices, not the live account.`,
            )}
          >
            Backtest · growth of $1 since {firstYear}
          </h3>
          <button className="link" onClick={() => onGoto("backtests")}>
            Open in Backtests →
          </button>
        </div>
        <EquityChart
          dates={history.dates}
          equity={equity}
          benchmark={backtest.benchmark}
          regimes={history.regime}
          holdout={holdout}
          height={200}
          onPick={onPick}
        />
      </div>
    </section>
  );
}

function Kpis({ data, years }: { data: Snapshot; years: string }) {
  const { status, backtest } = data;
  const account = status.account;
  const start = status.first_account?.equity;
  const change = account && start ? account.equity / start - 1 : null;
  const first = data.runs[data.runs.length - 1];
  const r = regime(status.regime);
  const tickers = Object.keys(status.weights).join(" · ");
  const s = backtest.strategy.full.sharpe;
  const b = backtest.spy.full.sharpe;
  const counts = status.runs;
  return (
    <div className="grid g4" data-tour="kpis">
      <div
        className="card kpi"
        {...tip(
          "Paper account",
          "The practice account at the broker (Alpaca), funded with pretend money. Real orders, real prices, no real risk. Read at the start of each run.",
          change !== null ? `${change >= 0 ? "Up" : "Down"} ${usd(Math.abs(account!.equity - start!))} since the first run.` : undefined,
        )}
      >
        <h3>Paper account</h3>
        <span className="v">{account ? usd(account.equity) : "—"}</span>
        <span className="s">{change !== null && first ? `${pct(change, 1)} since ${first.trading_day}` : "waiting for the first run"}</span>
      </div>
      <div className="card kpi" {...tip("Current mode", r.tip, `The bot's target is ${tickers}.`)}>
        <h3>Current mode</h3>
        <span className="v">
          <span className="mdot" style={{ background: r.color }} />
          {status.regime === "risk_on" ? "Risk on" : "Risk off"}
        </span>
        <span className="s">
          {status.regime === "risk_on" ? "" : status.regime.replace("risk_off_", "") + " rates · "}
          {tickers}
        </span>
      </div>
      <div
        className="card kpi"
        {...tip(
          "Runs",
          "One run per weekday since the bot went live. A run is the whole daily job: check the market, fetch prices, decide, reconcile, place orders. 'Skipped' means the market was closed.",
          `${counts.total} runs: ${counts.ok} ok, ${counts.skipped} skipped, ${counts.failed} failed.`,
        )}
      >
        <h3>Runs</h3>
        <span className="v">
          {counts.total}
          <small> / {counts.failed} failed</small>
        </span>
        <span className="s">{counts.skipped} skipped (market closed)</span>
      </div>
      <div
        className="card kpi"
        {...tip(
          "Backtest Sharpe",
          GLOSSARY.sharpe[1],
          `${saySharpe(s, "The strategy")} Holding the market (SPY) scores ${b.toFixed(2)}.`,
        )}
      >
        <h3>Backtest Sharpe</h3>
        <span className="v">
          {s.toFixed(2)}
          <small> vs {b.toFixed(2)}</small>
        </span>
        <span className="s">strategy vs SPY · {years}</span>
      </div>
    </div>
  );
}

function Services({ data, run, now }: { data: Snapshot; run?: Run; now: Date }) {
  const step = (name: string) => run?.steps.find((s) => s.name === name);
  const clock = step("check_clock");
  const fetch = step("fetch_bars");
  const latest = data.runs[0];
  const checks = data.system.checks;
  const led = (s?: string) => (s === undefined ? "dim" : s === "failed" ? "err" : "");
  const rows: [string, string, string, string, string][] = [
    ["broker", "Alpaca paper API", clock ? duration(clock.ms) : "—", led(clock?.status), "The broker connection, checked at the start of every run by asking for the market clock."],
    [
      "data",
      "Yahoo Finance (yfinance)",
      fetch ? duration(fetch.ms) : "—",
      fetch && Number((fetch.detail as Record<string, unknown>).attempts ?? 1) > 1 ? "warn" : led(fetch?.status),
      "The price feed. Each run downloads ~450 days of daily prices for all 15 funds, retrying on failure.",
    ],
    ["scheduler", `GitHub Actions · ${data.status.schedule.cron}`, latest ? ago(latest.started_at, now) : "—", latest ? "" : "dim", "The timer that starts the bot each weekday morning, New York time."],
    ["api", "Static JSON · GitHub Pages", ago(data.status.built_at, now), "", "This page reads JSON files exported from the FastAPI app when the site was last built."],
    [
      "tests",
      checks ? `${checks.passed} passed${checks.coverage != null ? ` · ${checks.coverage.toFixed(0)}% cov` : ""}` : "not recorded",
      checks?.failed ? `${checks.failed} failed` : checks ? "ok" : "—",
      checks ? (checks.failed ? "err" : "") : "dim",
      "The test suite, run on the exact commit this page was built from.",
    ],
  ];
  return (
    <div className="svc">
      {rows.map(([name, what, value, state, help]) => (
        <span key={name} style={{ display: "contents" }}>
          <span className={`led ${state}`} />
          <span {...tip(name, help)}>
            {name} <span className="mono">{what}</span>
          </span>
          <span className="mono">{value}</span>
        </span>
      ))}
    </div>
  );
}

function Events({ data }: { data: Snapshot }) {
  const events: [string, string, string, string][] = [];
  const runs = data.runs.slice(0, 6);
  runs.forEach((r, k) => {
    const when = `${r.trading_day.slice(5)} ${nyTime(r.started_at).slice(0, 5)}`;
    const older = data.runs[k + 1];
    if (r.status === "failed") events.push([when, "err", `run failed: ${r.error ?? "see trace"}`, "The daily job stopped with an error."]);
    else if (r.status === "skipped") events.push([when, "warn", "market closed · run skipped", "The broker reported the market closed (weekend or holiday), so nothing was traded."]);
    else {
      const what = r.orders ? `${r.orders} orders ${r.dry_run ? "planned (dry run)" : "sent"}` : "in sync, 0 orders";
      events.push([when, "ok", `run ok in ${duration(r.duration_ms)} · ${what}`, "The daily job finished successfully."]);
    }
    if (r.regime && older?.regime && older.regime !== r.regime)
      events.push([when, "info", `mode change: ${older.regime} → ${r.regime}`, "The strategy's decision switched regime since the previous run."]);
  });
  const sha = data.status.commit?.slice(0, 7);
  // The site is rebuilt after each run, so the build is the newest event.
  events.unshift([
    `${data.status.built_at.slice(5, 10)} ${nyTime(data.status.built_at).slice(0, 5)}`,
    "info",
    `console built${sha ? ` from ${sha}` : ""}`,
    "This page's data was exported and published.",
  ]);
  return (
    <div className="log">
      {events.slice(0, 8).map(([t, level, message, help], i) => (
        <div key={i} {...tip(message, help)}>
          <span className="t">{t}</span>
          <span className={`lv-${level}`}>{level.toUpperCase()}</span>
          <span>{message}</span>
        </div>
      ))}
    </div>
  );
}
