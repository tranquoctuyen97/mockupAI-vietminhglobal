export type MockupJobStatus = "pending" | "running" | "completed" | "failed";

export interface ShouldSyncFinishedMockupJobInput {
  jobStatus: string;
  draftJobStatus?: string;
  alreadySynced: boolean;
}

export function shouldSyncFinishedMockupJob({
  jobStatus,
  draftJobStatus,
  alreadySynced,
}: ShouldSyncFinishedMockupJobInput): boolean {
  if (alreadySynced || !isTerminalMockupJobStatus(jobStatus)) return false;
  return !draftJobStatus || !isTerminalMockupJobStatus(draftJobStatus);
}

export function isTerminalMockupJobStatus(status: string): boolean {
  return status === "completed" || status === "failed";
}
