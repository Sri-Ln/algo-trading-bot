const MINUS = "−";

/** Signed percentage: +1.23% or −1.23%. */
export const pct = (x: number, digits = 2) =>
  (x >= 0 ? "+" : MINUS) + Math.abs(x * 100).toFixed(digits) + "%";

/** Percentage with a sign only when negative. */
export const pct0 = (x: number, digits = 1) =>
  (x < 0 ? MINUS : "") + Math.abs(x * 100).toFixed(digits) + "%";

export const usd = (v: number) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = (v: number, digits = 2) => (v < 0 ? MINUS : "") + Math.abs(v).toFixed(digits);

/** "Mar 16, 2020" from an ISO date. */
export const fmtDate = (iso: string) =>
  new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export const weekday = (iso: string) =>
  new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });

/** Milliseconds as "840ms" or "2.4s". */
export const duration = (ms: number | null | undefined) =>
  ms == null ? "" : ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : Math.round(ms) + "ms";

/** Wall-clock time of an instant in New York, e.g. "09:35:03". */
export const nyTime = (instant: string) =>
  new Date(instant).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour12: false });

/** "3h ago", "2d ago" relative to ``now``. */
export function ago(instant: string, now: Date): string {
  const minutes = Math.max(0, (now.getTime() - new Date(instant).getTime()) / 60000);
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}
