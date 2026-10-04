import { useMemo } from "react";
import { tip } from "../components/Tip";
import { drawdown } from "../lib/finance";
import { pct0 } from "../lib/format";
import { PAD, linePath, useWidth, xScale } from "./common";

/** How far below its previous high each series is, day by day. */
export function DrawdownChart({ equity, benchmark }: { equity: number[]; benchmark: number[] }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const W = Math.max(300, measured);
  const H = 100;
  const top = 6;
  const bottom = H - 16;
  const chart = useMemo(() => {
    const ds = drawdown(equity);
    const db = drawdown(benchmark);
    const worst = Math.floor(Math.min(...ds, ...db) * 10) / 10 || -0.1;
    const x = xScale(W, equity.length);
    const y = (v: number) => top + (v / worst) * (bottom - top);
    const line = linePath(ds, x, y);
    return {
      x,
      y,
      ticks: [0, worst / 2, worst],
      strategy: line,
      area: `${line}L${x(ds.length - 1)},${y(0)}L${x(0)},${y(0)}Z`,
      bench: linePath(db, x, y),
      worstS: Math.min(...ds),
      worstB: Math.min(...db),
    };
  }, [W, equity, benchmark, bottom]);

  return (
    <div
      className="chartbox"
      ref={ref}
      {...tip(
        "Drawdown",
        "How far below its previous high the investment is on each date. 0% = at a new high, −50% = worth half its peak. Deep, long dips are what make people give up on a strategy.",
        `The strategy's deepest dip was ${pct0(chart.worstS, 0)}, vs ${pct0(chart.worstB, 0)} for SPY.`,
      )}
    >
      {measured > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} height={H} role="img" aria-label="Drawdown chart">
          <g className="gl">
            {chart.ticks.map((v) => (
              <line key={v} x1={PAD.l} x2={W - PAD.r} y1={chart.y(v)} y2={chart.y(v)} />
            ))}
          </g>
          {chart.ticks.map((v) => (
            <text key={v} x={PAD.l - 7} y={chart.y(v) + 4} textAnchor="end">
              {Math.round(v * 100)}%
            </text>
          ))}
          <path d={chart.area} fill="var(--accent)" fillOpacity={0.15} />
          <path d={chart.strategy} stroke="var(--accent)" strokeWidth={1.1} fill="none" />
          <path d={chart.bench} stroke="var(--bench)" strokeWidth={1.1} fill="none" />
          <text x={W - PAD.r} y={H - 1} textAnchor="end">
            drawdown from previous high
          </text>
        </svg>
      )}
    </div>
  );
}
