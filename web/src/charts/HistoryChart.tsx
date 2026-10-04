import { useMemo, useState } from "react";
import { regime } from "../content";
import { spans } from "../lib/finance";
import { fmtDate, pct } from "../lib/format";
import { PAD, dayAt, regimeBands, useWidth, xScale, yearStarts } from "./common";

interface Props {
  dates: string[];
  regimes: string[];
  signal1: number[];
  signal2: number[];
  cursor: number; // selected day
  reveal: boolean; // draw only up to the cursor
  onPick: (day: number) => void;
}

interface Panel {
  t: number;
  h: number;
}

const RIBBON = { t: 4, h: 22 };
const PANEL_A: Panel = { t: 50, h: 110 };
const PANEL_B: Panel = { t: 186, h: 110 };
const H = PANEL_B.t + PANEL_B.h + 22;

/** The regime every day, and the two signals that decide it. */
export function HistoryChart({ dates, regimes, signal1, signal2, cursor, reveal, onPick }: Props) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; left: number } | null>(null);
  const W = Math.max(300, measured);
  const n = dates.length;

  const chart = useMemo(() => {
    const x = xScale(W, n);
    const isOn = (r: string) => (r === "risk_on" ? "on" : "off");
    const clips = { on: [] as string[], off: [] as string[] };
    for (const s of spans(regimes, isOn)) {
      clips[s.key as "on" | "off"].push(
        `M${x(s.from).toFixed(1)},0h${Math.max(0.6, x(s.to) - x(s.from) + 0.6).toFixed(1)}v9999h-${Math.max(0.6, x(s.to) - x(s.from) + 0.6).toFixed(1)}Z`,
      );
    }
    const panel = (values: number[], p: Panel) => {
      const m = Math.max(...values.map(Math.abs)) * 1.1 || 0.01;
      const mid = p.t + p.h / 2;
      const y = (v: number) => mid - (v / m) * (p.h / 2);
      let up = `M${x(0)},${mid}`;
      let dn = up;
      for (let i = 0; i < n; i += 2) {
        up += `L${x(i).toFixed(1)},${y(Math.max(0, values[i]!)).toFixed(1)}`;
        dn += `L${x(i).toFixed(1)},${y(Math.min(0, values[i]!)).toFixed(1)}`;
      }
      up += `L${x(n - 1)},${mid}Z`;
      dn += `L${x(n - 1)},${mid}Z`;
      const step = m > 0.16 ? 0.1 : m > 0.08 ? 0.05 : m > 0.03 ? 0.02 : 0.01;
      const ticks: number[] = [];
      for (let v = step; v < m * 0.95; v += step) ticks.push(v, -v);
      return { y, mid, up, dn, ticks };
    };
    return {
      x,
      a: panel(signal1, PANEL_A),
      b: panel(signal2, PANEL_B),
      bands: regimeBands(regimes, x),
      clipOn: clips.on.join(""),
      clipOff: clips.off.join(""),
      years: yearStarts(dates).filter((_, k) => W > 640 || k % 2 === 0),
    };
  }, [W, n, dates, regimes, signal1, signal2]);

  const { x, a, b } = chart;
  const cx = x(cursor) + 0.6;
  const flip = x(cursor) > W - 90;
  const pens = [
    { y: RIBBON.t + RIBBON.h / 2, color: regime(regimes[cursor]!).color, label: regimes[cursor]! },
    {
      y: a.y(signal1[cursor]!),
      color: signal1[cursor]! >= 0 ? "var(--on)" : "var(--bench)",
      label: "S1 " + pct(signal1[cursor]!),
    },
    {
      y: b.y(signal2[cursor]!),
      color: regimes[cursor] === "risk_on" ? "var(--bench)" : signal2[cursor]! >= 0 ? "var(--falling)" : "var(--rising)",
      label: "S2 " + pct(signal2[cursor]!) + (regimes[cursor] === "risk_on" ? " · unused" : ""),
    },
  ];

  const labels = (p: Panel, ticks: number[], y: (v: number) => number, mid: number, upLbl: string, dnLbl: string, title: string) => (
    <>
      <text x={PAD.l} y={p.t - 8} style={{ fill: "var(--ink)", fontSize: "11.5px" }}>
        {title}
      </text>
      <g className="gl">
        {ticks.map((v) => (
          <line key={v} x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
        ))}
      </g>
      {ticks.map((v) => (
        <text key={v} x={PAD.l - 7} y={y(v) + 4} textAnchor="end">
          {v > 0 ? "+" : "−"}
          {Math.round(Math.abs(v) * 100)}%
        </text>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={mid} y2={mid} stroke="var(--ink)" strokeWidth={1} />
      <text x={PAD.l - 7} y={mid + 4} textAnchor="end" style={{ fill: "var(--ink)" }}>
        0
      </text>
      <text x={W - PAD.r - 4} y={p.t + 11} textAnchor="end">
        {upLbl}
      </text>
      <text x={W - PAD.r - 4} y={p.t + p.h - 3} textAnchor="end">
        {dnLbl}
      </text>
    </>
  );

  const hi = hover?.i;
  const hiddenAhead = hi !== undefined && reveal && hi > cursor;

  return (
    <div className="chartbox" ref={ref}>
      {measured > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} height={H} role="img" aria-label="Mode and signals over time">
          <defs>
            <clipPath id="hcOn">
              <path d={chart.clipOn} />
            </clipPath>
            <clipPath id="hcOff">
              <path d={chart.clipOff} />
            </clipPath>
            <clipPath id="hcPast">
              <rect x={0} y={0} width={reveal ? cx : 99999} height={H} />
            </clipPath>
            <clipPath id="hcFuture">
              <rect x={reveal ? cx : 99999} y={0} width={W} height={H} />
            </clipPath>
            {/* Everything data-like, drawn twice: in full up to the cursor, faded after it. */}
            <g id="hData">
              {chart.bands.map((bd) => (
                <rect key={bd.key} x={bd.x} y={RIBBON.t} width={bd.width} height={RIBBON.h} fill={bd.color} />
              ))}
              <path d={a.up} fill="var(--on)" />
              <path d={a.dn} fill="var(--bench)" />
              <g clipPath="url(#hcOff)">
                <path d={b.up} fill="var(--falling)" />
                <path d={b.dn} fill="var(--rising)" />
              </g>
              <g clipPath="url(#hcOn)" opacity={0.35}>
                <path d={b.up} fill="var(--bench)" />
                <path d={b.dn} fill="var(--bench)" />
              </g>
            </g>
          </defs>
          <text x={PAD.l - 7} y={RIBBON.t + 15} textAnchor="end">
            mode
          </text>
          {labels(PANEL_A, a.ticks, a.y, a.mid, "▲ above 0 → risk on", "▼ below 0 → risk off, check signal 2", "Signal 1 · bonds (AGG) vs cash, return gap")}
          {labels(
            PANEL_B,
            b.ticks,
            b.y,
            b.mid,
            "▲ above 0 → falling rates",
            "▼ below 0 → rising rates",
            "Signal 2 · long bonds (TLT) vs cash, return gap · greyed where signal 1 already said risk on",
          )}
          <use href="#hData" clipPath="url(#hcPast)" />
          <use href="#hData" clipPath="url(#hcFuture)" opacity={reveal ? 0.06 : 1} />
          {chart.years.map((d) => (
            <text key={d} x={x(d)} y={H - 4} textAnchor="middle">
              {dates[d]!.slice(0, 4)}
            </text>
          ))}
          <line x1={x(cursor)} x2={x(cursor)} y1={0} y2={PANEL_B.t + PANEL_B.h} stroke="var(--muted)" strokeDasharray="2 3" />
          {pens.map((p, k) => (
            <g key={k} transform={`translate(${x(cursor).toFixed(1)},${p.y.toFixed(1)})`}>
              <circle className="ring" r={4} fill="none" strokeWidth={1.5} stroke={p.color} />
              <circle r={3.6} stroke="var(--panel)" strokeWidth={1.5} fill={p.color} />
              <text className="pv" x={flip ? -8 : 8} y={4} textAnchor={flip ? "end" : "start"}>
                {p.label}
              </text>
            </g>
          ))}
          {hi !== undefined && <line x1={x(hi)} x2={x(hi)} y1={0} y2={PANEL_B.t + PANEL_B.h} stroke="var(--muted)" strokeDasharray="3 3" />}
          <rect
            x={PAD.l}
            y={0}
            width={W - PAD.l - PAD.r}
            height={H}
            fill="transparent"
            style={{ cursor: "pointer" }}
            onPointerMove={(e) => {
              const r = e.currentTarget.closest("svg")!.getBoundingClientRect();
              setHover({ i: dayAt(e, W, n), left: Math.max(0, Math.min(e.clientX - r.left + 14, r.width - 254)) });
            }}
            onPointerLeave={() => setHover(null)}
            onClick={(e) => onPick(dayAt(e, W, n))}
          />
        </svg>
      )}
      {hi !== undefined && !hiddenAhead && (
        <div className="ctip" style={{ left: hover!.left, top: 24 }}>
          <span className="m">{fmtDate(dates[hi]!)}</span>
          <br />
          <span style={{ color: regime(regimes[hi]!).color }}>●</span> {regime(regimes[hi]!).name}
          <br />
          <span className="dim">Signal 1</span> <span className="m">{pct(signal1[hi]!)}</span> ·{" "}
          <span className="dim">Signal 2</span> <span className="m">{pct(signal2[hi]!)}</span>
          {regimes[hi] === "risk_on" && <span className="dim"> (not used)</span>}
          <br />
          <span className="dim">Click to open this day's trace</span>
        </div>
      )}
    </div>
  );
}
