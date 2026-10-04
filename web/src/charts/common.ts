import { useEffect, useRef, useState, type RefObject } from "react";
import { regime } from "../content";
import { spans } from "../lib/finance";

export const PAD = { l: 44, r: 12 };

/** Width of an element, kept up to date as it resizes. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Maps a day index to an x position across the plot area. */
export const xScale = (width: number, days: number) => (i: number) =>
  PAD.l + (i / Math.max(1, days - 1)) * (width - PAD.l - PAD.r);

/** Index of the day under a pointer event. */
export function dayAt(e: React.PointerEvent | React.MouseEvent, width: number, days: number): number {
  const r = (e.currentTarget as Element).closest("svg")!.getBoundingClientRect();
  const px = ((e.clientX - r.left) * width) / r.width;
  const i = Math.round(((px - PAD.l) / (width - PAD.l - PAD.r)) * (days - 1));
  return Math.max(0, Math.min(days - 1, i));
}

/** First day index of each calendar year. */
export const yearStarts = (dates: string[]) =>
  dates.flatMap((d, i) => (i === 0 || d.slice(0, 4) !== dates[i - 1]!.slice(0, 4) ? [i] : []));

/** SVG path through every ``step``-th point. */
export function linePath(values: number[], x: (i: number) => number, y: (v: number) => number, step = 2): string {
  let d = "";
  for (let i = 0; i < values.length; i += step) d += (d ? "L" : "M") + x(i).toFixed(1) + "," + y(values[i]!).toFixed(1);
  const last = values.length - 1;
  return d + "L" + x(last).toFixed(1) + "," + y(values[last]!).toFixed(1);
}

export interface Band {
  key: string;
  x: number;
  width: number;
  color: string;
}

/** Colored blocks, one per run of consecutive days in the same regime. */
export function regimeBands(regimes: string[], x: (i: number) => number): Band[] {
  return spans(regimes, (r) => r).map((s) => ({
    key: `${s.key}-${s.from}`,
    x: x(s.from),
    width: Math.max(0.6, x(s.to) - x(s.from) + 0.6),
    color: regime(s.key).color,
  }));
}
