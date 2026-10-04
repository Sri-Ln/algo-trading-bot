import type { ReactNode } from "react";
import type { Decision, Run, Step } from "../api/client";
import { DESC, NAMES, RSI_TIP, STEP_TIPS } from "../content";
import { duration, fmtDate, nyTime, pct } from "../lib/format";
import { tip } from "./Tip";

type Check = Decision["checks"][number];

const fund = (t: string) => `${t}: ${NAMES[t] ?? t}`;
const ok = <span className="st" style={{ color: "var(--ok)" }}>✓</span>;
const skip = <span className="st" style={{ color: "var(--faint)" }}>–</span>;
const fail = <span className="st" style={{ color: "var(--err)" }}>✗</span>;
const mark = (status: string) => (status === "ok" ? ok : status === "failed" ? fail : skip);

function Row(props: {
  tree: string;
  name: string;
  nameTip: string;
  children: ReactNode;
  ms?: string;
  status: ReactNode;
  skipped?: boolean;
  indent?: boolean;
}) {
  return (
    <div className={`step ${props.skipped ? "skip" : ""} ${props.indent ? "sub" : ""}`}>
      <span className="tree">{props.tree}</span>
      <span className="name" {...tip(props.name, props.nameTip)}>
        {props.name}
      </span>
      <span className="detail">{props.children}</span>
      <span className="ms">{props.ms ?? ""}</span>
      {props.status}
    </div>
  );
}

function Compare({ check, signal }: { check: Check; signal: number }) {
  const rows: [string, number][] = [
    [check.left, check.left_return],
    [check.right, check.right_return],
  ];
  const scale = Math.max(...rows.map(([, v]) => Math.abs(v)), 0.005) * 1.15;
  const months = check.lookback >= 40 ? "about 3 months" : "about 1 month";
  return (
    <div className="cmp">
      {rows.map(([t, v]) => {
        const w = (Math.abs(v) / scale) * 50;
        return (
          <span
            key={t}
            className="row"
            {...tip(
              fund(t),
              `${DESC[t] ?? ""} The bar is its return over the last ${check.lookback} trading days: right of center = gain, left = loss.`,
              `Bought ${check.lookback} trading days ago (${months}), ${t} would be ${v >= 0 ? "up" : "down"} ${pct(Math.abs(v)).slice(1)}.`,
            )}
          >
            <b>{t}</b>
            <span className="bar">
              <i style={{ left: `${v >= 0 ? 50 : 50 - w}%`, width: `${w}%` }} />
              <i className="zero" />
            </span>
            <span>{pct(v)}</span>
          </span>
        );
      })}
      <span
        className="gap"
        {...tip(
          `Signal ${signal}`,
          `The first minus the second. This is the exact number plotted as Signal ${signal} in the History chart below; only whether it is above or below zero matters.`,
        )}
      >
        gap {check.left} − {check.right} = <b>{pct(check.gap)}</b> · Signal {signal}
      </span>
    </div>
  );
}

function Verdict({ passed, then }: { passed: boolean; then: string }) {
  return (
    <span
      className="verdict"
      style={{ color: passed ? "var(--ink)" : "var(--muted)" }}
      {...tip(
        passed ? "TRUE" : "FALSE",
        passed
          ? "The condition holds, so this rule decides the mode and later rules are skipped."
          : "The condition does not hold, so the bot moves to the next rule.",
      )}
    >
      → {passed ? "TRUE" : "FALSE"}
      {then ? ` · ${then}` : ""}
    </span>
  );
}

function Ranking({ decision, window }: { decision: Decision; window: number }) {
  const entries = Object.entries(decision.rsi);
  return (
    <div className="rk">
      {entries.map(([t, v]) => {
        const picked = t in decision.weights;
        const zone = v < 30 ? " (oversold)" : v > 70 ? " (overbought)" : "";
        return (
          <span
            key={t}
            className={`row ${picked ? "pick" : ""}`}
            {...tip(
              fund(t),
              `${DESC[t] ?? ""} ${RSI_TIP}`,
              `${window}-day RSI ${v.toFixed(1)}${zone}. ${picked ? "Picked: among the lowest." : "Not picked."}`,
            )}
          >
            <span className="t">{t}</span>
            <span className="bar">
              <i style={{ width: `${v}%` }} />
            </span>
            <span className="t">{v.toFixed(1)}</span>
            <span className="tag">{picked ? "← pick" : ""}</span>
          </span>
        );
      })}
    </div>
  );
}

export interface RsiWindows {
  riskOn: number;
  risingRates: number;
}

/** The rule-by-rule rows of one strategy() decision. */
function decisionRows(
  decision: Decision,
  windows: RsiWindows,
  signal2: number | undefined,
  compact: boolean,
  last: boolean,
  indent = false,
): ReactNode[] {
  const rule1 = decision.checks.find((c) => c.rule === 1);
  const rule2 = decision.checks.find((c) => c.rule === 2);
  const regime = decision.regime;
  const rows: ReactNode[] = [];
  if (rule1) {
    rows.push(
      <Row
        key="rule_1"
        indent={indent}
        tree="├"
        name="rule_1"
        nameTip={`Bonds vs. cash. ${rule1.left} (ordinary US bonds) normally earns a bit more than ${rule1.right} (cash). If it did worse over the last ${rule1.lookback} trading days, interest rates are probably rising, a warning sign for stocks.`}
        status={ok}
      >
        {!compact && <span>Did bonds beat cash over {rule1.lookback} days?</span>}
        <Compare check={rule1} signal={1} />
        <Verdict passed={rule1.passed} then={rule1.passed ? "risk_on" : ""} />
      </Row>,
    );
  }
  rows.push(
    <Row
      key="rule_2"
      indent={indent}
      tree="├"
      name="rule_2"
      nameTip="Long bonds vs. cash. Only checked if rule 1 failed. TLT (20+ year government bonds) falls hardest when rates rise. If it did worse than cash over 20 days, rates are probably rising right now."
      status={rule2 ? ok : skip}
      skipped={!rule2}
    >
      {rule2 ? (
        <>
          {!compact && <span>Did long bonds trail cash over {rule2.lookback} days?</span>}
          <Compare check={rule2} signal={2} />
          <Verdict passed={rule2.passed} then={rule2.passed ? "risk_off_rising" : "risk_off_falling"} />
        </>
      ) : (
        <span>
          skipped · rule_1 matched
          {signal2 !== undefined && ` (Signal 2 is still computed for the chart, ${pct(signal2)}, but not used)`}
        </span>
      )}
    </Row>,
  );
  const ranked = regime !== "risk_off_falling";
  rows.push(
    <Row
      key="rank_rsi"
      indent={indent}
      tree="├"
      name="rank_rsi"
      nameTip={`Choose which funds to buy within the mode, using RSI. ${RSI_TIP}`}
      status={ranked ? ok : skip}
      skipped={!ranked}
    >
      {ranked ? (
        <Ranking decision={decision} window={regime === "risk_on" ? windows.riskOn : windows.risingRates} />
      ) : (
        <span>fixed basket · no ranking needed</span>
      )}
    </Row>,
  );
  rows.push(
    <Row
      key="target"
      indent={indent}
      tree={last ? "└" : "├"}
      name="target"
      nameTip="The output of strategy(): what share of the money goes into each fund."
      status={ok}
    >
      <span>
        {Object.entries(decision.weights).map(([t, w], i) => (
          <span key={t}>
            {i > 0 && " · "}
            <b {...tip(fund(t), DESC[t] ?? "")}>{t}</b> {Math.round(w * 100)}%
          </span>
        ))}
      </span>
    </Row>,
  );
  return rows;
}

function stepDetail(step: Step, run: Run): ReactNode {
  const d = step.detail as Record<string, unknown>;
  if (step.status === "failed") return <span className="dn">{run.error ?? "failed"}</span>;
  switch (step.name) {
    case "check_clock":
      return d.is_open ? (
        <span>market open</span>
      ) : (
        <span>
          market closed · next open {fmtDate(String(d.next_open))} {nyTime(String(d.next_open)).slice(0, 5)} ET
        </span>
      );
    case "fetch_bars": {
      const attempts = Number(d.attempts ?? 1);
      return (
        <span>
          {String(d.tickers)} tickers · last completed bar {String(d.last_bar)}
          {attempts > 1 && <span style={{ color: "var(--warn)" }}> · succeeded on attempt {attempts}</span>}
        </span>
      );
    }
    case "reconcile": {
      const needed = Number(d.orders_needed ?? 0);
      return (
        <span>
          {needed
            ? `${Math.round(Number(d.drift) * 100)}% away from target · ${needed} orders needed`
            : "in sync · no changes"}
        </span>
      );
    }
    case "submit_orders":
      if (step.status === "skipped")
        return <span>{d.reason === "dry run" ? `dry run · ${run.orders.length} orders planned, none sent` : "nothing to send"}</span>;
      return (
        <span>
          {String(d.placed)} placed · {String(d.filled)} filled
        </span>
      );
    default:
      return <span>{JSON.stringify(d)}</span>;
  }
}

/** A live run: its real steps and timings, with the decision expanded under ``decide``. */
export function RunTrace(props: { run: Run; windows: RsiWindows; signal2?: number; compact?: boolean }) {
  const { run, windows, signal2, compact = false } = props;
  const rows: ReactNode[] = [];
  run.steps.forEach((step, i) => {
    const last = i === run.steps.length - 1;
    rows.push(
      <Row
        key={step.name}
        tree={last ? "└" : "├"}
        name={step.name}
        nameTip={STEP_TIPS[step.name] ?? step.name}
        ms={duration(step.ms)}
        status={mark(step.status)}
        skipped={step.status === "skipped"}
      >
        {step.name === "decide" && run.decision ? (
          <span>strategy() → {run.decision.regime}</span>
        ) : (
          stepDetail(step, run)
        )}
      </Row>,
    );
    if (step.name === "decide" && run.decision && !compact) {
      rows.push(...decisionRows(run.decision, windows, signal2, compact, false, true));
    }
  });
  return <div className="trace">{rows}</div>;
}

/** A replayed day: the decision's rule checks only. */
export function DecisionTrace(props: { decision: Decision; windows: RsiWindows; signal2?: number }) {
  return <div className="trace">{decisionRows(props.decision, props.windows, props.signal2, false, true)}</div>;
}

/** strategy() output as syntax-highlighted JSON. */
export function DecisionJson({ decision }: { decision: Decision }) {
  const text = JSON.stringify(decision, (_, v) => (typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v), 2);
  const parts: ReactNode[] = [];
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:e-?\d+)?|true|false|null)/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    parts.push(text.slice(at, m.index));
    if (m[1] && m[2]) parts.push(<span key={m.index} className="k">{m[1]}</span>, m[2]);
    else if (m[1]) parts.push(<span key={m.index} className="s">{m[1]}</span>);
    else parts.push(<span key={m.index} className="n">{m[3]}</span>);
    at = m.index + m[0].length;
  }
  parts.push(text.slice(at));
  return (
    <pre
      className="json"
      {...tip(
        "strategy() output",
        'The exact data the strategy function returned, as the API serves it to this page. "checks" are the rules it evaluated, "rsi" the scores it ranked, "weights" the final decision.',
      )}
    >
      {parts}
    </pre>
  );
}
