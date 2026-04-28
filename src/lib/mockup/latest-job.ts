export interface MockupJobSummary {
  id: string;
  createdAt?: string | Date;
}

export function pickLatestMockupJobId(
  jobs: MockupJobSummary[] | null | undefined,
  currentJobId?: string | null,
): string | null {
  if (!jobs || jobs.length === 0) return null;

  const latest = [...jobs].sort(
    (a, b) => getJobTime(b) - getJobTime(a),
  )[0];

  if (!latest || latest.id === currentJobId) return null;
  return latest.id;
}

function getJobTime(job: MockupJobSummary): number {
  return job.createdAt ? new Date(job.createdAt).getTime() : 0;
}
