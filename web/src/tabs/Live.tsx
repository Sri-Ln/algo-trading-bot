import { loadRun, type Run, type Snapshot } from "../api/client";
import { StatusBadge } from "../components/Chips";
import { tip } from "../components/Tip";
import { DESC, NAMES } from "../content";
import { duration, fmtDate, nyTime, pct, pct0, usd } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const RECENT = 20;

export function Live({ data }: { data: Snapshot }) {
  const recent = data.runs.slice(0, RECENT);
  const { value: runs } = useAsync(() => Promise.all(recent.map((r) => loadRun(r.trading_day))), [data.runs]);
  const traded = runs?.find((r) => r.decision && r.account);
  const withCalls = runs?.find((r) => r.api_calls.length > 0);

  return (
    <section data-panel="live">
      <div className="tab-head">
        <h1>Live</h1>
        <p>
          The paper account at Alpaca: real broker, real prices, pretend money. Each morning the bot compares what it should hold with
          what it does hold, and trades the difference.
        </p>
      </div>
      {data.runs.length === 0 && <p className="empty">No live runs yet. The first scheduled run fills this tab in.</p>}
      <div className="grid g2">
        <div className="card">{traded ? <Reconciliation run={traded} /> : <h3>Reconciliation · target vs. held</h3>}</div>
        <div className="card">
          <h3 {...tip("Orders", "Instructions sent to the broker to buy or sell, newest first, with the ID the bot attaches to each one. Dry runs only plan them.")}>
            Orders · last {RECENT} runs
          </h3>
          {runs && <Orders runs={runs} />}
        </div>
      </div>
      <div className="card">
        <h3 {...tip("Broker API calls", "The raw HTTP requests the bot made to Alpaca during the run. 200 means success. ms is how long each call took. This is what you'd look at when debugging. Credentials are never recorded.")}>
          Broker API calls{withCalls && ` · run ${withCalls.trading_day}`}
        </h3>
        {withCalls ? <ApiCalls run={withCalls} /> : <p className="empty">No calls recorded yet.</p>}
      </div>
    </section>
  );
}

function Reconciliation({ run }: { run: Run }) {
  const equity = run.account!.equity;
  const target = run.decision!.weights;
  const held = run.positions;
  const tickers = [...new Set([...Object.keys(target), ...Object.keys(held)])];
  const reconcile = run.steps.find((s) => s.name === "reconcile");
  const needed = Number((reconcile?.detail as Record<string, unknown> | undefined)?.orders_needed ?? 0);
  const invested = Object.values(held).reduce((a, p) => a + p.market_value, 0);
  const H: [string, string][] = [
    ["Fund", "Which fund the row is about."],
    ["Target", "Share of the account the strategy wants in this fund (desired state)."],
    ["Held", "Share the account actually held when the run started (actual state)."],
    ["Gap", "Held minus target. Gaps under 2 points in total are ignored."],
    ["Shares", "Units held."],
    ["Value", "Market value of the holding."],
  ];
  return (
    <>
      <div className="card-h">
        <h3
          {...tip(
            "Reconciliation",
            "Comparing desired state (target) with actual state (holdings) and acting only on the difference: the same pattern as Kubernetes or Terraform. Small gaps under the threshold are ignored to avoid pointless trades.",
          )}
        >
          Reconciliation · {run.trading_day}
        </h3>
        <span
          className={`badge ${needed ? "warn" : "ok"}`}
          {...tip(needed ? "Out of sync" : "In sync", needed ? `The account was more than 2 points away from target, so the run planned ${needed} orders.` : "Every holding was within 2 percentage points of its target, so no trade was needed.")}
        >
          {needed ? `${needed} orders` : "in sync"}
        </span>
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              {H.map(([h, t]) => (
                <th key={h} {...tip(h, t)}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickers.map((t) => {
              const w = target[t] ?? 0;
              const p = held[t];
              const hw = p ? p.market_value / equity : 0;
              return (
                <tr key={t} {...tip(`${t}: ${NAMES[t] ?? t}`, DESC[t] ?? "", `Target ${pct0(w, 0)}, held ${pct0(hw)}.`)}>
                  <td>
                    <b>{t}</b>
                  </td>
                  <td>{pct0(w, 0)}</td>
                  <td>{pct0(hw)}</td>
                  <td>{pct(hw - w, 1)}</td>
                  <td>{p ? p.qty : 0}</td>
                  <td>{usd(p?.market_value ?? 0)}</td>
                </tr>
              );
            })}
            <tr {...tip("Cash", "Money not invested; some is always left because shares come in whole units and the bot keeps a 1% buffer.")}>
              <td>cash</td>
              <td>0%</td>
              <td>{pct0(run.account!.cash / equity)}</td>
              <td />
              <td />
              <td>{usd(run.account!.cash)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="foot">
        Holdings as read at the start of the run on {fmtDate(run.trading_day)}, before its orders. Account value {usd(equity)}
        {invested ? `, ${pct0(invested / equity)} invested` : ""}.
      </p>
    </>
  );
}

function Orders({ runs }: { runs: Run[] }) {
  const rows = runs.flatMap((r) => r.orders.map((o) => ({ ...o, day: r.trading_day, dry: r.dry_run })));
  if (rows.length === 0) return <p className="empty">No orders yet.</p>;
  const H: [string, string, boolean][] = [
    ["Day", "Trading day of the order.", true],
    ["Client order ID", "A unique ID the bot attaches to each order. If a request is retried after a network error, the broker sees the same ID and will not place the order twice (idempotency).", true],
    ["Side", "BUY adds to a holding, SELL reduces it.", true],
    ["Fund", "Which fund was traded.", true],
    ["Qty", "Number of whole shares.", false],
    ["Fill", "Average price the broker filled the order at.", false],
    ["Status", "planned = dry run, not sent. filled = the broker completed the trade.", false],
  ];
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            {H.map(([h, t, left]) => (
              <th key={h} className={left ? "l" : ""} {...tip(h, t)}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 12).map((o) => (
            <tr key={o.client_order_id} {...tip(`${o.side === "buy" ? "Buy" : "Sell"} ${o.symbol}`, DESC[o.symbol] ?? "")}>
              <td className="l">{o.day.slice(5)}</td>
              <td className="l">{o.client_order_id}</td>
              <td className={`l ${o.side === "buy" ? "up" : "dn"}`}>{o.side.toUpperCase()}</td>
              <td className="l">{o.symbol}</td>
              <td>{o.qty}</td>
              <td>{o.filled_avg_price != null ? usd(o.filled_avg_price) : "—"}</td>
              <td>
                <StatusBadge status={o.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApiCalls({ run }: { run: Run }) {
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th className="l" {...tip("Time", "When the request was sent (New York time).")}>Time</th>
            <th className="l" {...tip("Method", "GET reads data; POST creates something, here an order.")}>Method</th>
            <th className="l" {...tip("Path", "Which Alpaca API endpoint was called.")}>Path</th>
            <th {...tip("Status", "HTTP status code. 200 means success.")}>Status</th>
            <th {...tip("Latency", "How long the broker took to respond.")}>Latency</th>
          </tr>
        </thead>
        <tbody>
          {run.api_calls.map((c, i) => (
            <tr key={i}>
              <td className="l">{nyTime(c.at)}</td>
              <td className="l">{c.method}</td>
              <td className="l">{c.path}</td>
              <td className={c.status < 300 ? "up" : "dn"}>{c.status}</td>
              <td>{duration(c.elapsed_ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
