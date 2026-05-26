export type MockupJobLike = {
  id: string;
  draftDesignId?: string | null;
  designId?: string | null;
  createdAt?: string | Date | null;
  status?: string | null;
  images?: Array<{
    included?: boolean;
    printifyMockupId?: string | null;
    colorName?: string;
    sourceUrl?: string | null;
    compositeUrl?: string | null;
  }>;
};

const USABLE_JOB_STATUSES = new Set(["pending", "running", "completed"]);

export function getLatestJobByDraftDesignId<T extends MockupJobLike>(jobs: T[]): Map<string, T> {
  const grouped = new Map<string, T>();

  for (const job of jobs) {
    const designKey = job.draftDesignId ?? job.designId ?? null;
    if (!designKey) continue;
    const current = grouped.get(designKey);
    if (!current || getTime(job.createdAt) > getTime(current.createdAt)) {
      grouped.set(designKey, job);
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

export function getActiveDraftDesignId(
  draftDesignIds: string[],
  current: string | null | undefined,
): string | null {
  if (current && draftDesignIds.includes(current)) return current;
  return draftDesignIds[0] ?? null;
}

function getTime(value: string | Date | null | undefined): number {
  return value ? new Date(value).getTime() : 0;
}
