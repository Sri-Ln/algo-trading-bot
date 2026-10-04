import { useState } from "react";
import type { CostPoint, Periods, Snapshot } from "../api/client";
import { DrawdownChart } from "../charts/DrawdownChart";
import { EquityChart } from "../charts/EquityChart";
import { tip } from "../components/Tip";
import { GLOSSARY, sayCagr, sayMdd, saySharpe } from "../content";
import { pct0 } from "../lib/format";

interface Props {
  data: Snapshot;
  equity: number[];
  cost: number;
  onCost: (bps: number) => void;
  onPick: (day: number) => void;
}

export const holdoutIndex = (dates: string[], start: string) => {
  const i = dates.findIndex((d) => d >= start);
  return i < 0 ? dates.length - 1 : i;
};

export function Backtests({ data, equity, cost, onCost, onPick }: Props) {
  const { backtest, costs, history } = data;
  const point = costs.points.find((p) => p.cost_bps === cost) ?? costs.points[0]!;
  const years = `${history.dates[0]!.slice(0, 4)}–${history.dates[history.dates.length - 1]!.slice(0, 4)}`;
  const holdoutYear = backtest.holdout_start.slice(0, 4);

  return (
    <section data-panel="backtests">
      <div className="tab-head">
        <h1>Backtests</h1>
        <p>
          Simulations of the rules on {years} prices. Trades fill at the next day's open, after a cost per dollar traded. {holdoutYear}{" "}
          onward is held out as unseen data.
        </p>
      </div>
      <div className="card">
        <h3 {...tip("Runs", "Each row is one backtest setting. Click a row to load it below. The baseline's ID is a hash of its settings and the price data, so the same inputs always give the same ID.")}>
          Runs
        </h3>
        <RunsTable data={data} cost={cost} onCost={onCost} />
      </div>
      <div className="card">
        <div className="card-h">
          <div className="keys">
            <span className="key" {...tip("Blue line: strategy", "What $1 invested in the strategy at the start would be worth on each date, after trading costs.")}>
              <span className="sw" style={{ background: "var(--accent)" }} />
              Strategy
            </span>
            <span className="key" {...tip("Grey line: SPY", "What $1 in SPY (a fund holding the 500 largest US companies, i.e. 'the stock market') would be worth. The bar to beat.")}>
              <span className="sw" style={{ background: "var(--bench)" }} />
              SPY
            </span>
            <span className="key" {...tip("Orange: risk on", "Periods holding 3× stock funds, which move three times as much as the market each day.")}>
              <span className="sw box" style={{ background: "var(--on)" }} />
              Risk on
            </span>
            <span className="key" {...tip("Purple: rising rates", "Risk off: holding the US dollar plus a fund that profits when prices fall.")}>
              <span className="sw box" style={{ background: "var(--rising)" }} />
              Rising rates
            </span>
            <span className="key" {...tip("Teal: falling rates", "Risk off: holding safe havens such as gold, long-term bonds and consumer staples.")}>
              <span className="sw box" style={{ background: "var(--falling)" }} />
              Falling rates
            </span>
            <span className="key" {...tip("Shaded: holdout", `${holdoutYear} onward is kept aside as unseen data, like a test set in machine learning, to check the rules weren't just fitted to the past. The split was fixed before any backtest ran.`)}>
              <span className="sw box" style={{ background: "var(--sunk)", border: "1px solid var(--line)" }} />
              Holdout
            </span>
            <span className="key" {...tip("Log scale", "Each step up the chart is the same percentage gain: $1→$2 takes the same height as $10→$20. Otherwise early years would look flat.")}>
              log scale
            </span>
          </div>
          <label
            className="cost"
            {...tip(
              "Trading cost",
              "Every trade loses a little to the buy/sell price gap and price movement. 1 bps (basis point) = 0.01%, so 5 bps on a $10,000 trade is $5. Moving this re-prices the backtest's trades at the new cost; the trades themselves don't change.",
            )}
          >
            cost{" "}
            <input
              type="range"
              min={costs.points[0]!.cost_bps}
              max={costs.points[costs.points.length - 1]!.cost_bps}
              step={1}
              value={cost}
              onChange={(e) => onCost(Number(e.target.value))}
            />{" "}
            <span className="mono">{cost} bps</span>
          </label>
        </div>
        <EquityChart
          dates={history.dates}
          equity={equity}
          benchmark={backtest.benchmark}
          regimes={history.regime}
          holdout={holdoutIndex(history.dates, backtest.holdout_start)}
          onPick={onPick}
        />
        <DrawdownChart equity={equity} benchmark={backtest.benchmark} />
        <StatsTable strategy={point.periods} spy={backtest.spy} tradesPerYear={backtest.trades_per_year} costDrag={point.cost_drag} holdoutYear={holdoutYear} />
      </div>
      <div className="grid g2">
        <Heatmap data={data} />
        <div className="card">
          <h3
            {...tip(
              "Holdout test",
              "The same idea as a train/test split in machine learning: score the rules on years they could have been tuned on, then on years kept aside. A big drop on the unseen years is a warning sign of overfitting.",
            )}
          >
            Validation · seen vs. unseen years
          </h3>
          <SplitBars point={point} holdoutYear={holdoutYear} />
          <h3 style={{ marginTop: 6 }}>Known limitations</h3>
          <ul className="weak">
            <li {...tip("Leveraged fund decay", "3× funds reset daily, so choppy markets eat into them. The market goes +10% then −9.1% and ends flat, but a 3× fund goes +30% then −27.3% and ends down 5.5%.")}>
              Leveraged ETF decay in sideways markets
            </li>
            <li {...tip("Small sample", "Only a few dozen big mode switches in the whole history. That's a small number of events to judge a strategy on.")}>
              Few regime switches, so a small sample
            </li>
            <li {...tip("Selection bias", "The rules were published after their author had seen this history. Strategies that happened to look good get published; the others don't.")}>
              Rules chosen after seeing the data
            </li>
            <li {...tip("Costs and taxes", "Costs are a flat rate per dollar traded. Taxes on the ~90 trades a year are not modeled; in a taxable account they would be a large drag.")}>
              Flat trading costs, no taxes
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function RunsTable({ data, cost, onCost }: { data: Snapshot; cost: number; onCost: (bps: number) => void }) {
  const { backtest, costs, sweep } = data;
  const base = backtest.cost_bps;
  const rows: [string, string, number, string][] = [
    [backtest.run_id, "baseline", base, "Published settings, realistic cost"],
    ["", "zero-cost", 0, "Same trades, but trading is free (unrealistic best case)"],
    ["", "high-cost", 25, "Same trades with expensive trading (stress test)"],
  ];
  const H: [string, string][] = [
    ["Run", "A unique ID for this backtest, derived from its settings and the price data, so the same inputs always map to the same run."],
    ["Name", "Short label for what the run tests."],
    ["Cost", "Trading cost assumed per dollar traded, in basis points (1 bps = 0.01%)."],
    [GLOSSARY.cagr[0], GLOSSARY.cagr[1]],
    ["Sharpe", GLOSSARY.sharpe[1]],
    [GLOSSARY.oosS[0], GLOSSARY.oosS[1]],
    [GLOSSARY.mdd[0], GLOSSARY.mdd[1]],
    ["Compute", "How long the simulation took when the site was built. Other costs re-price the baseline's trades instead of re-running it."],
  ];
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            {H.map(([h, t], j) => (
              <th key={h} className={j < 2 ? "l" : ""} {...tip(h, t)}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([id, name, bps, note]) => {
            const p = costs.points.find((c) => c.cost_bps === bps)!;
            const s = p.periods.full;
            return (
              <tr
                key={name}
                className={`click ${cost === bps ? "sel" : ""}`}
                onClick={() => onCost(bps)}
                {...tip(`${name} · ${bps} bps`, `${note}. Click to load it.`, `${sayCagr(s.cagr, "This run")} Sharpe ${s.sharpe.toFixed(2)}, worst fall ${pct0(s.max_drawdown, 0)}.`)}
              >
                <td>{id || "—"}</td>
                <td className="l">{name}</td>
                <td>{bps} bps</td>
                <td>{pct0(s.cagr)}</td>
                <td>{s.sharpe.toFixed(2)}</td>
                <td>{p.periods.holdout.sharpe.toFixed(2)}</td>
                <td className="dn">{pct0(s.max_drawdown, 0)}</td>
                <td>{id ? `${backtest.seconds.toFixed(1)}s` : "re-priced"}</td>
              </tr>
            );
          })}
          <tr {...tip("Parameter sweep", `A batch of ${sweep.cells.length} backtests with nearby settings, shown in the grid below. It checks whether the result depends on lucky settings.`)}>
            <td>—</td>
            <td className="l">param sweep</td>
            <td>{sweep.cost_bps} bps</td>
            <td colSpan={4} style={{ textAlign: "center", color: "var(--muted)" }}>
              {sweep.cells.length} runs, see grid ↓
            </td>
            <td>{sweep.seconds.toFixed(1)}s</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function StatsTable(props: { strategy: Periods; spy: Periods; tradesPerYear: number; costDrag: number; holdoutYear: string }) {
  const keys = ["cagr", "vol", "sharpe", "mdd", "isS", "oosS", "reb"] as const;
  const rows: [string, Periods, string, boolean][] = [
    ["strategy", props.strategy, "the strategy", false],
    ["SPY (buy & hold)", props.spy, "SPY", true],
  ];
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th {...tip("Series", "Which investment the row describes.")}>Series</th>
            {keys.map((k) => (
              <th key={k} {...tip(GLOSSARY[k][0], GLOSSARY[k][1])}>
                {k === "oosS" ? `Sharpe ${props.holdoutYear}+` : GLOSSARY[k][0]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, p, low, bench]) => {
            const a = p.full;
            const cell = (k: (typeof keys)[number], text: string, say: string, cls = "") => (
              <td className={cls} {...tip(`${GLOSSARY[k][0]} · ${name}`, GLOSSARY[k][1], say)}>
                {text}
              </td>
            );
            return (
              <tr key={name}>
                <td {...tip(name, bench ? "Buy SPY at the start and never trade. The baseline to beat." : "The rules, followed daily, including trading costs.")}>{name}</td>
                {cell("cagr", pct0(a.cagr), sayCagr(a.cagr, name))}
                {cell("vol", pct0(a.volatility), `A typical year for ${low} swings about ${pct0(a.volatility, 0)} around its average.`)}
                {cell("sharpe", a.sharpe.toFixed(2), saySharpe(a.sharpe, name))}
                {cell("mdd", pct0(a.max_drawdown), sayMdd(a.max_drawdown, low), "dn")}
                {cell("isS", p.before_holdout.sharpe.toFixed(2), saySharpe(p.before_holdout.sharpe, `Before the holdout, ${low}`))}
                {cell("oosS", p.holdout.sharpe.toFixed(2), saySharpe(p.holdout.sharpe, `In the holdout, ${low}`))}
                {cell(
                  "reb",
                  bench ? "0" : props.tradesPerYear.toFixed(0),
                  bench ? "Buy-and-hold never trades." : `About ${props.tradesPerYear.toFixed(0)} trading days a year, costing ${pct0(props.costDrag)} a year at this cost.`,
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Heatmap({ data }: { data: Snapshot }) {
  const { sweep, backtest } = data;
  const [period, setPeriod] = useState<"before_holdout" | "holdout">("before_holdout");
  const value = (l: number, r: number) =>
    sweep.cells.find((c) => c.bond_lookback === l && c.risk_on_rsi_window === r)!.periods[period].sharpe;
  const all = sweep.cells.map((c) => c.periods[period].sharpe);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const base = value(sweep.baseline_bond_lookback, sweep.baseline_risk_on_rsi_window);
  const holdoutYear = backtest.holdout_start.slice(0, 4);
  return (
    <div className="card">
      <div className="card-h">
        <h3
          {...tip(
            "Parameter sweep",
            `The whole backtest re-run ${sweep.cells.length} times with nearby settings, at ${sweep.cost_bps} bps. Each square shows the Sharpe ratio (risk-adjusted score, higher is better). If only the outlined square (the published settings) looks good, the settings were probably cherry-picked. If the neighbors look similar, the idea is robust.`,
          )}
        >
          Validation · parameter sweep (Sharpe)
        </h3>
        <div className="seg" role="group" aria-label="Period">
          <button aria-pressed={period === "before_holdout"} onClick={() => setPeriod("before_holdout")} {...tip("Before the holdout", "Years the settings could have been tuned on.")}>
            to {Number(holdoutYear) - 1}
          </button>
          <button aria-pressed={period === "holdout"} onClick={() => setPeriod("holdout")} {...tip("Holdout", "Years kept aside as unseen data.")}>
            {holdoutYear}+
          </button>
        </div>
      </div>
      <div className="heat" style={{ gridTemplateColumns: `6ch repeat(${sweep.risk_on_rsi_windows.length}, minmax(0, 1fr))` }}>
        <span className="h" />
        {sweep.risk_on_rsi_windows.map((r) => (
          <span key={r} className="h" {...tip("RSI window (columns)", `How many days the RSI score looks back when choosing which 3× funds to buy. Published: ${sweep.baseline_risk_on_rsi_window}.`)}>
            rsi {r}
          </span>
        ))}
        {sweep.bond_lookbacks.map((l) => (
          <Row key={l} l={l} sweep={sweep} value={value} lo={lo} hi={hi} base={base} />
        ))}
      </div>
      <p className="foot">
        The published settings rank {1 + all.filter((v) => v > base).length} of {all.length} here; the median setting scores{" "}
        {median(all).toFixed(2)} and the range is {lo.toFixed(2)} to {hi.toFixed(2)}.
      </p>
    </div>
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function Row(props: { l: number; sweep: Snapshot["sweep"]; value: (l: number, r: number) => number; lo: number; hi: number; base: number }) {
  const { l, sweep, value, lo, hi, base } = props;
  return (
    <>
      <span className="h" {...tip("Bond lookback (rows)", `How many days rule 1 compares bonds to cash. Published: ${sweep.baseline_bond_lookback}.`)}>
        {l}d
      </span>
      {sweep.risk_on_rsi_windows.map((r) => {
        const v = value(l, r);
        const p = Math.round(12 + ((v - lo) / (hi - lo || 1)) * 78);
        const isBase = l === sweep.baseline_bond_lookback && r === sweep.baseline_risk_on_rsi_window;
        return (
          <span
            key={r}
            className={`c ${isBase ? "base" : ""}`}
            style={{ background: `color-mix(in oklab, var(--accent) ${p}%, var(--panel))`, color: p > 50 ? "var(--panel)" : "var(--ink)" }}
            {...tip(
              isBase ? "Published settings" : `lookback ${l}d · rsi ${r}`,
              `Bond lookback ${l} days, RSI window ${r} days gives a Sharpe ratio of ${v.toFixed(2)}. Darker = better.`,
              isBase ? "These are the settings the strategy actually uses." : `${v > base ? "Better" : "Worse"} than the published settings (${base.toFixed(2)}).`,
            )}
          >
            {v.toFixed(2)}
          </span>
        );
      })}
    </>
  );
}

function SplitBars({ point, holdoutYear }: { point: CostPoint; holdoutYear: string }) {
  const seen = point.periods.before_holdout.sharpe;
  const unseen = point.periods.holdout.sharpe;
  const max = Math.max(seen, unseen, 1);
  const rows: [string, number, string][] = [
    [`to ${Number(holdoutYear) - 1} · seen`, seen, "Years the rules could have been tuned on, like the training set in machine learning."],
    [`${holdoutYear}+ · unseen`, unseen, "Years kept aside as a test set. The honest score."],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map(([label, v, help]) => (
        <div key={label} className="sb" {...tip(label, help, saySharpe(v, "The strategy"))}>
          <span>{label}</span>
          <span className="bar">
            <i style={{ width: `${(Math.max(0, v) / max) * 100}%` }} />
          </span>
          <span className="num">{v.toFixed(2)}</span>
        </div>
      ))}
      <p className="foot">
        Sharpe drops {Math.round((1 - unseen / seen) * 100)}% on unseen years at {point.cost_bps} bps, which suggests much of the result is fitted to the past.
      </p>
    </div>
  );
}
