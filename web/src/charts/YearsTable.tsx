import { tip } from "../components/Tip";
import { REGIME_ORDER, regime } from "../content";
import { spans, tally } from "../lib/finance";
import { pct } from "../lib/format";

interface Props {
  dates: string[];
  regimes: string[];
  equity: number[];
  benchmark: number[];
  cursor: number;
  onPick: (day: number) => void;
}

/** One row per year: time in each mode, how often it switched, and the year's return. */
export function YearsTable({ dates, regimes, equity, benchmark, cursor, onPick }: Props) {
  const years = spans(dates, (d) => d.slice(0, 4));
  const cursorYear = dates[cursor]?.slice(0, 4);
  return (
    <div className="scroll">
      <div className="yrs">
        <div className="hd">
          <span>Year</span>
          <span>Time in each mode</span>
          <span className="num">Switches</span>
          <span className="num">Strategy</span>
          <span className="num">SPY</span>
        </div>
        {years.map(({ key: year, from, to }) => {
          const counts = tally(regimes, from, to);
          const total = to - from + 1;
          let switches = 0;
          for (let i = Math.max(1, from); i <= to; i++) if (regimes[i] !== regimes[i - 1]) switches++;
          const base = Math.max(0, from - 1);
          const rs = equity[to]! / equity[base]! - 1;
          const rb = benchmark[to]! / benchmark[base]! - 1;
          const share = (k: string) => Math.round(((counts[k] ?? 0) / total) * 100);
          return (
            <div
              key={year}
              className={`row ${year === cursorYear ? "cur" : ""}`}
              onClick={() => onPick(from)}
              {...tip(
                `${year}${to === dates.length - 1 ? " so far" : ""}`,
                "Time spent in each mode this year, how often it switched, and the year's return. Click to jump to the start of the year.",
                `${share("risk_on")}% risk on, ${share("risk_off_rising")}% rising rates, ${share("risk_off_falling")}% falling rates.`,
              )}
            >
              <span>{year}</span>
              <span>
                <span className="mix">
                  {REGIME_ORDER.filter((k) => counts[k]).map((k) => (
                    <span key={k} style={{ flex: counts[k], background: regime(k).color }} />
                  ))}
                </span>
              </span>
              <span className="num">{switches}</span>
              <span className={`num ${rs >= 0 ? "pos" : "neg"}`}>{pct(rs, 1)}</span>
              <span className="num">{pct(rb, 1)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
