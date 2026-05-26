export type MockupJobLike = {
  id: string;
  draftDesignId?: string | null;
  createdAt?: string | Date | null;
  status?: string | null;
};

const USABLE_JOB_STATUSES = new Set(["pending", "running", "completed"]);

export function getLatestJobByDraftDesignId<T extends MockupJobLike>(jobs: T[]): Map<string, T> {
  const grouped = new Map<string, T>();

  for (const job of jobs) {
    if (!job.draftDesignId) continue;
    const current = grouped.get(job.draftDesignId);
    if (!current || getTime(job.createdAt) > getTime(current.createdAt)) {
      grouped.set(job.draftDesignId, job);
    }
  }

  return grouped;
}

export function hasActiveOrCompletedJobsForAllDesigns(
  draftDesignIds: string[],
  jobs: MockupJobLike[],
): boolean {
  const latestByDesign = getLatestJobByDraftDesignId(jobs);
  return draftDesignIds.every((draftDesignId) => {
    const job = latestByDesign.get(draftDesignId);
    return Boolean(job?.status && USABLE_JOB_STATUSES.has(job.status.toLowerCase()));
  });
}

function getTime(value: string | Date | null | undefined): number {
  return value ? new Date(value).getTime() : 0;
}
