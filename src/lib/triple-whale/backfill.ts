import type { Job, Queue } from "bullmq";

import { getTripleWhaleSyncQueue } from "@/lib/queue/queue";

import type { MissingRange } from "./analytics";
import { TWRateLimitError } from "./client";
import { TWCooldownActiveError } from "./request-gate";
import type { TWSyncJobPayload } from "./types";

export type TripleWhaleSyncJobStatus =
  | "queued"
  | "syncing"
  | "rate_limited"
  | "complete"
  | "failed";

export interface TripleWhaleSyncJobSummary {
  id: string;
  shopId: string;
  from: string;
  to: string;
  status: TripleWhaleSyncJobStatus;
}

type BackfillJob = Pick<Job<TWSyncJobPayload>, "id" | "data" | "progress" | "getState"> & {
  remove?: () => Promise<void>;
};

interface BackfillQueue {
  getJob(jobId: string): Promise<BackfillJob | undefined>;
  add(name: string, data: TWSyncJobPayload, options: { jobId: string }): Promise<BackfillJob>;
}

function shiftDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function chunkDateRange(
  range: { from: string; to: string },
  chunkDays = 31,
): Array<{ from: string; to: string }> {
  if (chunkDays < 1) throw new Error("chunkDays must be at least 1");
  const chunks: Array<{ from: string; to: string }> = [];
  let from = range.from;
  while (from <= range.to) {
    const candidateTo = shiftDays(from, chunkDays - 1);
    const to = candidateTo < range.to ? candidateTo : range.to;
    chunks.push({ from, to });
    from = shiftDays(to, 1);
  }
  return chunks;
}

export function tripleWhaleBackfillJobId(
  tenantId: string,
  shopId: string,
  from: string,
  to: string,
): string {
  return `tw-backfill-${tenantId}-${shopId}-${from}-${to}`;
}

export function retryAtForTripleWhaleError(error: unknown, now = new Date()): number | null {
  if (error instanceof TWCooldownActiveError) return error.retryAt.getTime();
  if (error instanceof TWRateLimitError) {
    return now.getTime() + (error.retryAfterMs ?? 60_000);
  }
  return null;
}

function statusFromJob(job: BackfillJob, state: string): TripleWhaleSyncJobStatus {
  const progress =
    job.progress && typeof job.progress === "object" && "status" in job.progress
      ? String(job.progress.status)
      : null;
  if (progress === "rate_limited") return "rate_limited";
  if (state === "completed") return "complete";
  if (state === "failed") return "failed";
  if (state === "active" || progress === "syncing") return "syncing";
  return "queued";
}

async function summarizeJob(
  job: BackfillJob,
  fallback: { shopId: string; from: string; to: string },
): Promise<TripleWhaleSyncJobSummary> {
  const state = await job.getState();
  return {
    id: String(job.id),
    shopId: job.data.credentialId ?? fallback.shopId,
    from: job.data.from ?? fallback.from,
    to: job.data.to ?? fallback.to,
    status: statusFromJob(job, state),
  };
}

export async function enqueueMissingTripleWhaleRanges(
  input: { tenantId: string; ranges: MissingRange[] },
  queue: BackfillQueue = getTripleWhaleSyncQueue() as Queue<TWSyncJobPayload> as BackfillQueue,
): Promise<TripleWhaleSyncJobSummary[]> {
  const summaries: TripleWhaleSyncJobSummary[] = [];
  for (const missing of input.ranges) {
    for (const chunk of chunkDateRange(missing, 31)) {
      const jobId = tripleWhaleBackfillJobId(input.tenantId, missing.shopId, chunk.from, chunk.to);
      let job = await queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state !== "completed" && state !== "failed") {
          summaries.push(await summarizeJob(job, { shopId: missing.shopId, ...chunk }));
          continue;
        }
        await job.remove?.();
      }
      job = await queue.add(
        "backfill-range",
        {
          kind: "backfill",
          tenantId: input.tenantId,
          credentialId: missing.shopId,
          from: chunk.from,
          to: chunk.to,
        },
        { jobId },
      );
      summaries.push({
        id: String(job.id),
        shopId: missing.shopId,
        from: chunk.from,
        to: chunk.to,
        status: "queued",
      });
    }
  }
  return summaries;
}

export async function getBackfillJobSummaries(
  jobIds: string[],
  tenantId?: string,
  queue: BackfillQueue = getTripleWhaleSyncQueue() as Queue<TWSyncJobPayload> as BackfillQueue,
): Promise<TripleWhaleSyncJobSummary[]> {
  const jobs = await Promise.all(jobIds.map((jobId) => queue.getJob(jobId)));
  return Promise.all(
    jobs
      .filter(
        (job): job is BackfillJob => Boolean(job) && (!tenantId || job?.data.tenantId === tenantId),
      )
      .map((job) =>
        summarizeJob(job, {
          shopId: job.data.credentialId,
          from: job.data.from ?? "",
          to: job.data.to ?? "",
        }),
      ),
  );
}
