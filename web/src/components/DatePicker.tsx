import { useEffect, useMemo, useState } from "react";
import { regime } from "../content";
import { spans, tally } from "../lib/finance";
import { fmtDate, weekday } from "../lib/format";
import { RegimeChip } from "./Chips";
import { tip } from "./Tip";

interface Props {
  dates: string[];
  regimes: string[];
  day: number;
  onDay: (day: number) => void;
}

const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

const PRESETS: [string, string, string][] = [
  ["2020-03-16", "Mar 2020", "COVID panic: US stocks fell about a third in five weeks."],
  ["2022-06-13", "Jun 2022", "The US central bank raised interest rates very fast and stocks and bonds fell together. This is exactly what the 'rising rates' mode is built for."],
  ["2015-08-24", "Aug 2015", "Stocks dropped sharply within days on China growth fears."],
];

/** Pick a past trading day to replay: arrows, keys, a month grid, or play through history. */
export function DatePicker({ dates, regimes, day, onDay }: Props) {
  const last = dates.length - 1;
  const [playing, setPlaying] = useState(false);
  const clamp = (i: number) => Math.max(0, Math.min(last, i));
  const set = (i: number) => onDay(clamp(i));

  const months = useMemo(
    () =>
      spans(dates, (d) => d.slice(0, 7)).map((m) => {
        const counts = tally(regimes, m.from, m.to);
        const [major, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]!;
        return { ...m, major, share: n / (m.to - m.from + 1) };
      }),
    [dates, regimes],
  );
  const byKey = useMemo(() => new Map(months.map((m) => [m.key, m])), [months]);
  const monthIndex = months.findIndex((m) => m.key === dates[day]!.slice(0, 7));
  const month = months[monthIndex]!;
  const switched = (i: number) => i > 0 && regimes[i] !== regimes[i - 1];

  const jumpSwitch = (dir: number) => {
    for (let i = day + dir; i > 0 && i <= last; i += dir) if (switched(i)) return set(i);
  };
  const stepMonth = (dir: number) => {
    const m = months[Math.max(0, Math.min(months.length - 1, monthIndex + dir))]!;
    set(Math.min(m.to, m.from + (day - month.from)));
  };

  useEffect(() => {
    if (!playing) return;
    if (day >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => onDay(Math.min(last, day + 3)), 60);
    return () => clearTimeout(timer);
  }, [playing, day, last, onDay]);

  const firstYear = Number(dates[0]!.slice(0, 4));
  const lastYear = Number(dates[last]!.slice(0, 4));
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, k) => firstYear + k);

  return (
    <>
      <div
        className="dp"
        tabIndex={0}
        aria-label="Replay date"
        onKeyDown={(e) => {
          if ((e.target as Element).matches("input")) return;
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            const dir = e.key === "ArrowLeft" ? -1 : 1;
            if (e.shiftKey) stepMonth(dir);
            else set(day + dir);
          } else if (e.key === "PageUp" || e.key === "PageDown") {
            e.preventDefault();
            jumpSwitch(e.key === "PageUp" ? -1 : 1);
          }
        }}
      >
        <div className="dp-head">
          <button className="dp-step" aria-label="Previous trading day" onClick={() => set(day - 1)}>
            ‹
          </button>
          <div
            className="dp-big"
            {...tip(
              "Replay date",
              "The day being replayed. Step with the arrows or the ← → keys (Shift+arrow = a month, PageUp/PageDown = previous/next mode switch), type a date, or click a month and then a day below.",
            )}
          >
            <span className="dow">{weekday(dates[day]!)}</span>
            <b>{fmtDate(dates[day]!)}</b>
            <RegimeChip value={regimes[day]!} />
          </div>
          <button className="dp-step" aria-label="Next trading day" onClick={() => set(day + 1)}>
            ›
          </button>
        </div>
        <div className="dp-row">
          <button className="btn" onClick={() => jumpSwitch(-1)} {...tip("Previous mode switch", "Jump back to the last day the bot changed mode.")}>
            ⇤ prev
          </button>
          <input
            type="date"
            aria-label="Type a date"
            min={dates[0]}
            max={dates[last]}
            value={dates[day]}
            onChange={(e) => {
              if (!e.target.value) return;
              const i = dates.findIndex((d) => d >= e.target.value);
              set(i < 0 ? last : i);
            }}
          />
          <button className="btn" onClick={() => jumpSwitch(1)} {...tip("Next mode switch", "Jump forward to the next day the bot changed mode.")}>
            next ⇥
          </button>
        </div>
        <div className="dp-cal" role="grid" aria-label="Months">
          <span />
          {MONTH_LETTERS.map((m, k) => (
            <span key={k} className="ml">
              {m}
            </span>
          ))}
          {years.map((y) => (
            <MonthRow key={y} year={y} byKey={byKey} current={month.key} onPick={(from) => set(from)} />
          ))}
        </div>
        <div className="dp-days" role="grid" aria-label="Trading days">
          {Array.from({ length: month.to - month.from + 1 }, (_, k) => month.from + k).map((i) => (
            <button
              key={i}
              className={`${switched(i) ? "flip" : ""} ${i === day ? "cur" : ""}`}
              style={{ background: regime(regimes[i]!).color }}
              onClick={() => set(i)}
              {...tip(fmtDate(dates[i]!), regime(regimes[i]!).name + (switched(i) ? ". The bot switched mode this day (dot)." : "."))}
            >
              {Number(dates[i]!.slice(8))}
            </button>
          ))}
        </div>
        <div className="dp-row">
          <button
            className="btn"
            aria-pressed={playing}
            onClick={() => {
              if (!playing && day >= last) set(0);
              setPlaying(!playing);
            }}
            {...tip("Play", "Moves through history automatically. Watch the cursor on the History chart below to follow it.")}
          >
            {playing ? "❚❚ Pause" : "▶ Play"}
          </button>
        </div>
      </div>
      <div className="presets">
        {PRESETS.map(([date, label, help]) => (
          <button key={date} className="btn" onClick={() => set(dates.findIndex((d) => d >= date))} {...tip(label, help)}>
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

interface Month {
  key: string;
  from: number;
  major: string;
  share: number;
}

function MonthRow({ year, byKey, current, onPick }: { year: number; byKey: Map<string, Month>; current: string; onPick: (from: number) => void }) {
  return (
    <>
      <span className="yl">{String(year).slice(2)}</span>
      {MONTH_LETTERS.map((_, k) => {
        const key = `${year}-${String(k + 1).padStart(2, "0")}`;
        const m = byKey.get(key);
        if (!m) return <button key={key} disabled aria-hidden="true" tabIndex={-1} />;
        const name = new Date(`${key}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
        return (
          <button
            key={key}
            aria-label={key}
            className={key === current ? "cur" : ""}
            style={{ background: `color-mix(in oklab, ${regime(m.major).color} ${Math.round(45 + m.share * 55)}%, var(--sunk))` }}
            onClick={() => onPick(m.from)}
            {...tip(name, "Colour = the mode the bot spent most of this month in. Click to pick a day in it.", `Mostly ${regime(m.major).name.toLowerCase()} (${Math.round(m.share * 100)}% of days).`)}
          />
        );
      })}
    </>
  );
}
