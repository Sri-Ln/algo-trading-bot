import { useMemo, useState } from "react";
import { regime } from "../content";
import { fmtDate, pct0 } from "../lib/format";
import { PAD, dayAt, linePath, regimeBands, useWidth, xScale, yearStarts } from "./common";

interface Props {
  dates: string[];
  equity: number[];
  benchmark: number[];
  regimes: string[];
  holdout: number; // index of the first holdout day
  height?: number;
  onPick?: (day: number) => void;
}

/** Growth of $1, strategy vs SPY, on a log scale with the regime underneath. */
export function EquityChart({ dates, equity, benchmark, regimes, holdout, height = 280, onPick }: Props) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; left: number } | null>(null);
  const W = Math.max(300, measured);
  const H = height;
  const top = 8;
  const bandH = 10;
  const plotB = H - 36;
  const n = dates.length;

  const chart = useMemo(() => {
    const x = xScale(W, n);
    const lo = Math.log(Math.min(...equity, ...benchmark)) - 0.05;
    const hi = Math.log(Math.max(...equity, ...benchmark)) + 0.05;
    const y = (v: number) => top + ((hi - Math.log(v)) / (hi - lo)) * (plotB - top);
    const ticks = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200].filter((v) => Math.log(v) >= lo && Math.log(v) <= hi);
    return {
      x,
      y,
      ticks,
      years: yearStarts(dates).filter((_, k) => W > 640 || k % 2 === 0),
      strategy: linePath(equity, x, y),
      bench: linePath(benchmark, x, y),
      bands: regimeBands(regimes, x),
    };
  }, [W, n, equity, benchmark, regimes, dates, plotB]);

  const { x, y } = chart;
  const hx = x(holdout);
  const i = hover?.i;

  return (
    <div className="chartbox" ref={ref}>
      {measured > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} height={H} role="img" aria-label="Growth of $1, strategy vs SPY">
          <rect x={hx} y={top} width={Math.max(0, W - PAD.r - hx)} height={plotB - top} fill="var(--sunk)" />
          <text x={hx + 5} y={top + 12}>
            holdout →
          </text>
          <g className="gl">
            {chart.ticks.map((v) => (
              <line key={v} x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
            ))}
          </g>
          {chart.ticks.map((v) => (
            <text key={v} x={PAD.l - 7} y={y(v) + 4} textAnchor="end">
              ${v}
            </text>
          ))}
          {chart.years.map((d) => (
            <text key={d} x={x(d)} y={H - 3} textAnchor="middle">
              {dates[d]!.slice(0, 4)}
            </text>
          ))}
          <path d={chart.bench} stroke="var(--bench)" strokeWidth={1.3} fill="none" />
          <path d={chart.strategy} stroke="var(--accent)" strokeWidth={1.7} fill="none" />
          <circle cx={x(n - 1)} cy={y(equity[n - 1]!)} r={3.2} fill="var(--accent)" />
          {chart.bands.map((b) => (
            <rect key={b.key} x={b.x} y={plotB + 6} width={b.width} height={bandH} fill={b.color} />
          ))}
          {i !== undefined && <line x1={x(i)} x2={x(i)} y1={top} y2={plotB} stroke="var(--muted)" />}
          <rect
            x={PAD.l}
            y={0}
            width={W - PAD.l - PAD.r}
            height={H}
            fill="transparent"
            style={{ cursor: onPick ? "pointer" : "crosshair" }}
            onPointerMove={(e) => {
              const r = e.currentTarget.closest("svg")!.getBoundingClientRect();
              setHover({ i: dayAt(e, W, n), left: Math.max(0, Math.min(e.clientX - r.left + 14, r.width - 254)) });
            }}
            onPointerLeave={() => setHover(null)}
            onClick={onPick && ((e) => onPick(dayAt(e, W, n)))}
          />
        </svg>
      )}
      {hover && i !== undefined && (
        <div className="ctip" style={{ left: hover.left, top: 16 }}>
          <span className="m">{fmtDate(dates[i]!)}</span>
          <br />
          $1 put in each on {fmtDate(dates[0]!)} is now:
          <br />
          <span className="m">
            strategy ${equity[i]!.toFixed(2)} · SPY ${benchmark[i]!.toFixed(2)}
          </span>
          <br />
          Strategy {equity[i]! >= benchmark[i]! ? "ahead" : "behind"} by{" "}
          {pct0(Math.abs(equity[i]! / benchmark[i]! - 1), 0)} · mode: {regime(regimes[i]!).name}
          {i >= holdout && (
            <>
              <br />
              <span className="dim">Holdout (unseen) period</span>
            </>
          )}
          {onPick && (
            <>
              <br />
              <span className="dim">Click to open this day in Decisions</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
