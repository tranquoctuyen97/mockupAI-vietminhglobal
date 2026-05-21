import { isTerminalMockupJobStatus } from "./job-sync";

export const MOCKUP_JOB_SOFT_WAIT_MS = 120_000;
export const MOCKUP_JOB_STALL_MS = 360_000;

export const MOCKUP_JOB_STALL_MESSAGE =
  "Printify mockup job did not produce images in time. Worker may be offline or Printify may be delayed. Please retry.";

export function shouldFailStalledMockupJob(input: {
  status: string;
  totalImages: number;
  createdAt: Date;
  now?: Date;
}): boolean {
  if (isTerminalMockupJobStatus(input.status)) return false;
  if (!["pending", "running", "PENDING", "RUNNING"].includes(input.status)) return false;
  if (input.totalImages > 0) return false;

  const now = input.now ?? new Date();
  return now.getTime() - input.createdAt.getTime() > MOCKUP_JOB_STALL_MS;
}
