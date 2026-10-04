import { regime } from "../content";
import { tip } from "./Tip";

export function RegimeChip({ value }: { value: string }) {
  const r = regime(value);
  return (
    <span className="chip" {...tip(r.name, r.tip)}>
      <span className="sq" style={{ background: r.color }} />
      {value}
    </span>
  );
}

const BADGE: Record<string, string> = { ok: "ok", filled: "ok", skipped: "dim", planned: "dim", failed: "err" };

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${BADGE[status] ?? "warn"}`}>{status.replace("_", " ")}</span>;
}
