import { AlertTriangle, Clock3, Database } from "lucide-react";

import type { TripleWhaleSyncJobSummary } from "@/lib/triple-whale/backfill";

function formatRange(from: string, to: string): string {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
  if (from === to) return `${month.format(start)} ${start.getUTCDate()}, ${start.getUTCFullYear()}`;
  if (
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCFullYear() === end.getUTCFullYear()
  ) {
    return `${month.format(start)} ${start.getUTCDate()}–${end.getUTCDate()}, ${start.getUTCFullYear()}`;
  }
  return `${month.format(start)} ${start.getUTCDate()}, ${start.getUTCFullYear()} – ${month.format(end)} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
}

export default function SyncStatusBanner({
  status,
  jobs,
  onRetry,
}: {
  status: "complete" | "partial" | "syncing" | "failed";
  jobs: TripleWhaleSyncJobSummary[];
  onRetry?: () => void;
}) {
  const active = jobs.some((job) => ["queued", "syncing", "rate_limited"].includes(job.status));
  const rateLimited = jobs.some((job) => job.status === "rate_limited");
  const failed = status === "failed" || jobs.some((job) => job.status === "failed");
  if (!active && !failed) return null;
  const jobRange = jobs[0] ? formatRange(jobs[0].from, jobs[0].to) : null;
  const StatusIcon = failed ? AlertTriangle : rateLimited ? Clock3 : Database;
  const copy = failed
    ? "Some historical data could not be synced. Existing data is still shown."
    : rateLimited
      ? "Waiting for Triple Whale quota before continuing data sync."
      : "Syncing missing Triple Whale data in the background. Partial data is marked below.";
  return (
    <div
      aria-live="polite"
      className="card"
      style={{
        alignItems: "center",
        background: failed ? "#fff3f2" : "#f2f8ed",
        display: "flex",
        gap: 12,
        justifyContent: "space-between",
        marginTop: 12,
        padding: "11px 14px",
      }}
    >
      <span style={{ alignItems: "center", display: "flex", fontSize: 12, gap: 9 }}>
        <StatusIcon aria-hidden="true" size={16} />
        <span>
          <strong style={{ fontWeight: 700 }}>{copy}</strong>
          {jobRange && (
            <span
              style={{ color: "var(--text-muted)", display: "block", fontSize: 11, marginTop: 2 }}
            >
              {jobRange}
              {jobs.length > 1 ? ` · ${jobs.length} sync jobs` : ""}
            </span>
          )}
        </span>
      </span>
      {failed && onRetry && (
        <button className="btn btn-sm" onClick={onRetry} type="button">
          Retry
        </button>
      )}
    </div>
  );
}
