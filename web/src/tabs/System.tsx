import type { Snapshot } from "../api/client";
import { REPO } from "../App";
import { tip } from "../components/Tip";
import { ago, duration, fmtDate } from "../lib/format";

export function System({ data, now }: { data: Snapshot; now: Date }) {
  const { system, runs, status, backtest } = data;
  const checks = system.checks;
  const recent = runs.slice(0, 40).reverse();
  const longest = Math.max(...recent.map((r) => r.duration_ms ?? 0), 1);
  const sha = system.commit;

  return (
    <section data-panel="system">
      <div className="tab-head">
        <h1>System</h1>
        <p>
          The strategy is one pure function. Prices come in and orders go out through interfaces (ports), so the backtest, the tests and
          the live bot all run the same code. Hover over any box.
        </p>
      </div>
      <div className="card scroll">
        <Architecture />
      </div>
      <div className="grid g4">
        <div className="card">
          <h3 {...tip("Scheduler", "What triggers the bot each morning without anyone pressing a button: a scheduled GitHub Actions workflow.")}>Scheduler</h3>
          <dl className="kv">
            <dt>cron</dt>
            <dd {...tip("Cron expression", "A standard way to write a schedule. '35 9 * * 1-5' means 9:35, Monday to Friday, five minutes after the US market opens.")}>{status.schedule.cron}</dd>
            <dt>tz</dt>
            <dd {...tip("Time zone", "New York time, so daylight-saving changes don't shift the run.")}>{status.schedule.timezone}</dd>
            <dt>runs</dt>
            <dd>
              {status.runs.total} · {status.runs.failed} failed
            </dd>
          </dl>
          <div className="spark" {...tip("Run durations", "Each bar is one recent daily run, oldest on the left; height is how long it took. Red = failed, grey = skipped (market closed).")}>
            {recent.map((r) => (
              <i
                key={r.trading_day}
                className={r.status === "failed" ? "fail" : ""}
                style={{ height: `${Math.max(8, ((r.duration_ms ?? 0) / longest) * 100)}%`, opacity: r.status === "skipped" ? 0.25 : undefined }}
              />
            ))}
          </div>
        </div>
        <div className="card">
          <h3 {...tip("Checks", "Before this page is published, the build runs the linter, the strict type checker and the full test suite on the same commit. Any failure stops the deploy.")}>Checks</h3>
          <dl className="kv">
            <dt>commit</dt>
            <dd>{sha ? <a href={`${REPO}/commit/${sha}`}>{sha.slice(0, 7)}</a> : "local build"}</dd>
            <dt>tests</dt>
            <dd {...tip("Tests", "Automated checks that the code does what it should, run on this commit.")}>
              {checks ? `${checks.passed} passed${checks.failed ? `, ${checks.failed} failed` : ""}` : "not recorded"}
            </dd>
            <dt>coverage</dt>
            <dd {...tip("Coverage", "Share of the code's lines run by the tests. Higher means fewer untested corners.")}>
              {checks?.coverage != null ? `${checks.coverage.toFixed(1)}%` : "—"}
            </dd>
            <dt>gate</dt>
            <dd {...tip("Gate", "ruff (lint and format), mypy in strict mode (types), and pytest must all pass before the site deploys.")}>ruff · mypy --strict · pytest</dd>
          </dl>
        </div>
        <div className="card">
          <h3 {...tip("Data pipeline", "Where prices come from and how much of them there is.")}>Data</h3>
          <dl className="kv">
            <dt>source</dt>
            <dd {...tip("yfinance", "A free Python library that downloads split- and dividend-adjusted daily prices from Yahoo Finance.")}>yfinance</dd>
            <dt>funds</dt>
            <dd {...tip("Funds", "The 14 funds the strategy reads or trades, plus SPY as the benchmark.")}>
              {system.funds.length - 1} + SPY
            </dd>
            <dt>rows</dt>
            <dd {...tip("Rows", "One row per fund per trading day: an open and a close price (a 'bar').")}>{system.rows.toLocaleString("en-US")}</dd>
            <dt>range</dt>
            <dd>
              {system.data_start.slice(0, 7)} → {system.data_end}
            </dd>
          </dl>
        </div>
        <div className="card">
          <h3 {...tip("Reproducibility", "Everything on this page is regenerated from source and prices by one command, and fingerprinted so changes are visible.")}>Reproducibility</h3>
          <dl className="kv">
            <dt>run id</dt>
            <dd {...tip("Run ID", "A hash of the backtest's settings and the price data it ran on.")}>{backtest.run_id}</dd>
            <dt>output</dt>
            <dd {...tip("Output hash", "A fingerprint of the backtest's equity curve. Same code and same data always give the same hash.")}>{system.output_hash}</dd>
            <dt>built</dt>
            <dd>{ago(system.built_at, now)}</dd>
            <dt>rebuild</dt>
            <dd {...tip("One-command rebuild", "Anyone can regenerate every number in this console with a single command.")}>uv run algo-trading export</dd>
          </dl>
        </div>
      </div>
      <div className="card">
        <h3
          {...tip(
            "API",
            "The read-only routes this console reads. They are defined in FastAPI with typed response models; at build time each route is requested once and its response saved as a static file at the same path, so no server is needed. The console's TypeScript types are generated from the same OpenAPI schema.",
          )}
        >
          API · FastAPI, published as static JSON
        </h3>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th className="l">Method</th>
                <th className="l">Route</th>
                <th className="l">Purpose</th>
                <th {...tip("Files", "How many static files the route expands to: one per live run, or one per year of decisions.")}>Files</th>
              </tr>
            </thead>
            <tbody>
              {system.endpoints.map((e) => {
                const href = e.path.includes("{") ? null : e.path.slice(1);
                return (
                  <tr key={e.path}>
                    <td className="l">GET</td>
                    <td className="l">{href ? <a href={href}>{e.path}</a> : e.path}</td>
                    <td className="l sans">{e.summary}</td>
                    <td>{e.files}</td>
                  </tr>
                );
              })}
              <tr>
                <td className="l">GET</td>
                <td className="l">
                  <a href="api/openapi.json">/api/openapi.json</a>
                </td>
                <td className="l sans">OpenAPI schema: the contract the console's types are generated from</td>
                <td>1</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="foot">
          Built {fmtDate(system.built_at)} from data through {fmtDate(system.data_end)}. Latest run took{" "}
          {duration(runs[0]?.duration_ms) || "—"}.
        </p>
      </div>
    </section>
  );
}

function Box(props: { x: number; y: number; w: number; h: number; title: string; sub?: string; help: string; core?: boolean }) {
  const { x, y, w, h, title, sub, help, core } = props;
  return (
    <g {...tip(title, help)}>
      <rect x={x} y={y} width={w} height={h} rx={6} className={core ? "core" : ""} />
      <text x={x + w / 2} y={y + h / 2 - (sub ? 3 : -4)} textAnchor="middle">
        {title}
      </text>
      {sub && (
        <text className="sub" x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle">
          {sub}
        </text>
      )}
    </g>
  );
}

function Arrow({ points }: { points: [number, number][] }) {
  const [x1, y1] = points[points.length - 2]!;
  const [x2, y2] = points[points.length - 1]!;
  const a = Math.atan2(y2 - y1, x2 - x1);
  const L = 7;
  return (
    <>
      <path d={"M" + points.map(([x, y]) => `${x},${y}`).join("L")} />
      <polygon
        className="ah"
        points={`${x2},${y2} ${x2 - L * Math.cos(a - 0.4)},${y2 - L * Math.sin(a - 0.4)} ${x2 - L * Math.cos(a + 0.4)},${y2 - L * Math.sin(a + 0.4)}`}
      />
    </>
  );
}

function Architecture() {
  return (
    <svg className="arch" viewBox="0 0 900 260" role="img" aria-label="Architecture diagram" style={{ minWidth: 640, width: "100%" }}>
      <Box x={10} y={30} w={150} h={46} title="yfinance" sub="daily bars" help="Downloads daily prices from Yahoo Finance, for both the backtest and the live bot. A 'bar' is one day of open and close prices." />
      <Box x={10} y={100} w={150} h={46} title="Parquet cache" sub="backtests offline" help="Backtest prices are cached in Parquet, a compact table format, so backtests are fast and reproducible. The live bot always downloads fresh prices." />
      <Box x={200} y={64} w={130} h={50} title="MarketData" sub="port" help="An interface that just says 'give me prices'. The strategy does not know where they come from, so sources can be swapped without touching it." />
      <Box x={370} y={54} w={170} h={70} title="strategy()" sub="prices → weights + why" core help="The core: a pure function. Prices in; target weights and reasoning out. No network, files or clock, so the same input always gives the same output, and it is easy to test." />
      <Box x={370} y={170} w={170} h={46} title="Backtest runner" sub="next-open fills, costs" help="Calls strategy() for every past day, simulates trades with costs, and computes the statistics, sweep and cost curve in the Backtests tab." />
      <Box x={580} y={20} w={150} h={46} title="Live runner" sub="Actions · 09:35 ET" help="Started by a scheduled GitHub Actions workflow every weekday morning. Checks the clock, calls strategy() for today, reconciles, places orders, and saves a run record." />
      <Box x={580} y={100} w={150} h={46} title="Broker" sub="port" help="An interface for 'place this order' and 'what do I hold?', so the live runner works with the real broker or a fake one." />
      <Box x={760} y={70} w={130} h={40} title="AlpacaBroker" help="The real implementation, talking to Alpaca's paper-trading API over HTTPS, with idempotent client order IDs and a request log." />
      <Box x={760} y={130} w={130} h={40} title="FakeBroker" sub="" help="In-memory stand-in used by the tests: no network, instant, predictable." />
      <Box x={580} y={190} w={150} h={46} title="FastAPI" sub="→ static JSON" help="Defines this console's API with typed models. At build time every route is saved as a JSON file, so GitHub Pages can host it without a server." />
      <Box x={760} y={196} w={130} h={40} title="React console" help="This page: React and TypeScript, built with Vite and hosted on GitHub Pages." />
      <Arrow points={[[160, 53], [200, 82]]} />
      <Arrow points={[[160, 123], [200, 98]]} />
      <Arrow points={[[330, 89], [370, 89]]} />
      <Arrow points={[[540, 70], [580, 46]]} />
      <Arrow points={[[455, 124], [455, 170]]} />
      <Arrow points={[[655, 66], [655, 100]]} />
      <Arrow points={[[730, 115], [760, 92]]} />
      <Arrow points={[[730, 128], [760, 148]]} />
      <Arrow points={[[540, 205], [580, 220]]} />
      <Arrow points={[[730, 43], [745, 43], [745, 200], [730, 200]]} />
      <Arrow points={[[730, 214], [760, 216]]} />
    </svg>
  );
}
