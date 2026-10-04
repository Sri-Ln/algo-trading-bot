import type { Status } from "../api/client";
import { regime } from "../content";
import { nextScheduledRun } from "../lib/finance";
import { duration, fmtDate, nyTime, pct, usd } from "../lib/format";
import { RegimeChip, StatusBadge } from "./Chips";
import { tip } from "./Tip";

export function Brand() {
  return (
    <span
      className="brand"
      {...tip(
        "algo-trading-bot",
        "A trading bot that switches ('rotates') between three modes ('regimes') depending on what the bond market is signalling, and trades a paper account to match.",
      )}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <rect x="1" y="9" width="4" height="8" rx="1" fill="var(--on)" />
        <rect x="7" y="5" width="4" height="12" rx="1" fill="var(--rising)" />
        <rect x="13" y="1" width="4" height="16" rx="1" fill="var(--falling)" />
      </svg>
      algo-trading-bot
    </span>
  );
}

export function health(status: Status): { led: string; label: string; tip: string } {
  const run = status.latest_run;
  if (!run) return { led: "dim", label: "No runs yet", tip: "The scheduler has not run the bot yet." };
  if (run.status === "failed")
    return { led: "err", label: "Last run failed", tip: `The latest run, on ${fmtDate(run.trading_day)}, failed: ${run.error ?? "see its trace"}.` };
  return {
    led: "",
    label: "Healthy",
    tip: "Green means the latest daily run completed: the broker answered, prices downloaded, and the decision and reconciliation ran. Open the Live tab for the details.",
  };
}

export function StatusBar({ status, now }: { status: Status; now: Date }) {
  const run = status.latest_run;
  const h = health(status);
  const next = nextScheduledRun(now);
  const account = status.account;
  const start = status.first_account?.equity;
  const change = account && start ? account.equity / start - 1 : null;
  return (
    <header className="status">
      <Brand />
      <span className="stat" {...tip("Bot health", h.tip)}>
        <span className={`led ${h.led}`} />
        <b>{h.label}</b>
      </span>
      {run && (
        <span
          className="stat"
          {...tip(
            "Last run",
            `The bot's most recent daily run, on ${fmtDate(run.trading_day)}, started at ${nyTime(run.started_at)} New York time${run.dry_run ? " as a dry run (orders planned, not sent)" : ""}. It took ${duration(run.duration_ms)} end to end.`,
          )}
        >
          last run <b>{run.trading_day}</b> <StatusBadge status={run.status} />
          {run.dry_run && <span className="badge dim">dry run</span>} <b>{duration(run.duration_ms)}</b>
        </span>
      )}
      <span
        className="stat"
        {...tip(
          "Next run",
          `When the scheduler (GitHub Actions) starts the bot again: every weekday at 9:35 a.m. New York time (${status.schedule.cron}), five minutes after the market opens. GitHub can start scheduled jobs a few minutes late; the run record keeps the actual start time.`,
        )}
      >
        next{" "}
        <b>
          {next.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" })} 09:35 ET
        </b>
      </span>
      {account && (
        <span
          className="stat"
          {...tip(
            "Paper account",
            "Value of the practice account at the broker (Alpaca), as read by the latest run. It holds pretend money but trades at real prices.",
            change !== null ? `${change >= 0 ? "Up" : "Down"} ${usd(Math.abs(account.equity - start!))} since the first run.` : undefined,
          )}
        >
          paper acct <b>{usd(account.equity)}</b>
          {change !== null && <b className={change >= 0 ? "up" : "dn"}>{pct(change, 1)}</b>}
        </span>
      )}
      <span className="stat" {...tip("Mode", `${regime(status.regime).tip} Decided on the close of ${fmtDate(status.regime_date)}.`)}>
        mode <RegimeChip value={status.regime} />
      </span>
    </header>
  );
}
