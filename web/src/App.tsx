import { useCallback, useEffect, useMemo, useState } from "react";
import { loadSnapshot, type Snapshot } from "./api/client";
import { StatusBar } from "./components/StatusBar";
import { TipLayer, tip } from "./components/Tip";
import { reprice } from "./lib/finance";
import { useAsync } from "./lib/useAsync";
import { Backtests } from "./tabs/Backtests";
import { Decisions, type Selection } from "./tabs/Decisions";
import { Live } from "./tabs/Live";
import { Overview } from "./tabs/Overview";
import { System } from "./tabs/System";

const TABS = [
  ["overview", "Overview", "The system at a glance: is it running, what does it hold, and how has it done."],
  ["decisions", "Decisions", "Every daily decision as a step-by-step trace: what data came in, which rule fired, and what it decided to buy. You can also replay any day since 2013."],
  ["backtests", "Backtests", "Simulations of the rules on past prices, with checks for overfitting: a holdout period, a parameter sweep and a trading-cost stress test."],
  ["live", "Live", "The paper-trading account at the broker: target vs. holdings, the orders, and the raw API calls."],
  ["system", "System", "How it's built and run: architecture, schedule, tests, data, and the API this page reads from."],
] as const;
export type Tab = (typeof TABS)[number][0];

const tabFromHash = (): Tab => {
  const h = location.hash.slice(1);
  return (TABS.find(([t]) => t === h)?.[0] ?? "overview") as Tab;
};

export const REPO = "https://github.com/Sri-Ln/algo_trading";

export function App() {
  const { value: data, error } = useAsync(loadSnapshot, []);
  if (error) return <p className="loading">Could not load the console data: {error.message}</p>;
  if (!data) return <p className="loading">Loading…</p>;
  return <Console data={data} />;
}

function Console({ data }: { data: Snapshot }) {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [cost, setCost] = useState(data.backtest.cost_bps);
  const lastDay = data.history.dates.length - 1;
  const [selection, setSelection] = useState<Selection>(() =>
    data.runs[0] ? { src: "live", run: data.runs[0].trading_day, day: lastDay } : { src: "replay", run: null, day: lastDay },
  );
  const now = useMemo(() => new Date(), []);

  const show = useCallback((t: Tab) => {
    setTab(t);
    history.replaceState(null, "", `#${t}`);
    scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).matches("input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = TABS[Number(e.key) - 1]?.[0];
      if (t) show(t);
    };
    addEventListener("hashchange", onHash);
    document.addEventListener("keydown", onKey);
    return () => {
      removeEventListener("hashchange", onHash);
      document.removeEventListener("keydown", onKey);
    };
  }, [show]);

  const equity = useMemo(() => reprice(data.backtest, cost), [data.backtest, cost]);
  const openDay = useCallback(
    (day: number) => {
      setSelection((s) => ({ ...s, src: "replay", day }));
      show("decisions");
    },
    [show],
  );

  return (
    <div className="app">
      <StatusBar status={data.status} now={now} />
      <nav className="side" role="tablist" aria-label="Sections">
        {TABS.map(([t, label, help]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => show(t)} {...tip(label, help)}>
            {label}
          </button>
        ))}
        <div className="sep" />
        <p className="help">
          Hover over (or tap) anything to see what it means. Keys 1–5 switch tabs.
        </p>
        <p className="help">
          <a href={REPO}>Source on GitHub</a>
        </p>
      </nav>
      <main>
        {tab === "overview" && <Overview data={data} equity={equity} now={now} onGoto={show} onPick={openDay} />}
        {tab === "decisions" && (
          <Decisions data={data} equity={equity} selection={selection} onSelect={setSelection} />
        )}
        {tab === "backtests" && (
          <Backtests data={data} equity={equity} cost={cost} onCost={setCost} onPick={openDay} />
        )}
        {tab === "live" && <Live data={data} />}
        {tab === "system" && <System data={data} now={now} />}
      </main>
      <TipLayer />
    </div>
  );
}
