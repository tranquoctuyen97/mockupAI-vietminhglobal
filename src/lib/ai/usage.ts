import { prisma } from "@/lib/db";

export interface AiUsageEventInput {
  tenantId: string;
  provider: string;
  model: string;
  draftId?: string | null;
  status: "success" | "failed";
  cacheHit?: boolean;
  tokensIn?: number;
  tokensOut?: number;
  errorCode?: string | null;
}

export interface AiUsageBucket {
  requests: number;
  generated: number;
  cacheHits: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
}

export async function recordAiUsageEvent(input: AiUsageEventInput): Promise<void> {
  try {
    await prisma.aiUsageEvent.create({
      data: {
        tenantId: input.tenantId,
        provider: input.provider,
        model: input.model,
        draftId: input.draftId ?? null,
        status: input.status,
        cacheHit: input.cacheHit ?? false,
        tokensIn: input.tokensIn ?? 0,
        tokensOut: input.tokensOut ?? 0,
        errorCode: input.errorCode ?? null,
      },
    });
  } catch (error) {
    console.error("[AI Usage] Failed to record usage event", error);
  }
}

export async function getAiUsageSummary(tenantId: string) {
  const now = new Date();
  const todayStart = startOfLocalDay(now);
  const sevenDaysStart = startOfLocalDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));

  const events = await prisma.aiUsageEvent.findMany({
    where: {
      tenantId,
      createdAt: { gte: sevenDaysStart },
    },
    orderBy: { createdAt: "asc" },
  });

  const today = emptyBucket();
  const byProvider = new Map<string, AiUsageBucket>();
  const byModel = new Map<string, AiUsageBucket>();
  const sevenDays = new Map<string, AiUsageBucket>();

  for (let i = 0; i < 7; i++) {
    const date = new Date(sevenDaysStart.getTime() + i * 24 * 60 * 60 * 1000);
    sevenDays.set(formatDateKey(date), emptyBucket());
  }

  for (const event of events) {
    const bucketKey = formatDateKey(event.createdAt);
    addToBucket(sevenDays.get(bucketKey) ?? emptyBucket(), event);

    if (event.createdAt >= todayStart) {
      addToBucket(today, event);
    }

    const providerBucket = byProvider.get(event.provider) ?? emptyBucket();
    addToBucket(providerBucket, event);
    byProvider.set(event.provider, providerBucket);

    const modelKey = `${event.provider}:${event.model}`;
    const modelBucket = byModel.get(modelKey) ?? emptyBucket();
    addToBucket(modelBucket, event);
    byModel.set(modelKey, modelBucket);
  }

  return {
    today,
    sevenDays: [...sevenDays.entries()].map(([date, bucket]) => ({ date, ...bucket })),
    byProvider: [...byProvider.entries()].map(([provider, bucket]) => ({ provider, ...bucket })),
    byModel: [...byModel.entries()].map(([key, bucket]) => {
      const [provider, ...modelParts] = key.split(":");
      return { provider, model: modelParts.join(":"), ...bucket };
    }),
  };
}

function emptyBucket(): AiUsageBucket {
  return {
    requests: 0,
    generated: 0,
    cacheHits: 0,
    failed: 0,
    tokensIn: 0,
    tokensOut: 0,
  };
}

function addToBucket(bucket: AiUsageBucket, event: {
  status: string;
  cacheHit: boolean;
  tokensIn: number;
  tokensOut: number;
}) {
  bucket.requests += 1;
  if (event.status === "failed") bucket.failed += 1;
  else if (event.cacheHit) bucket.cacheHits += 1;
  else bucket.generated += 1;
  bucket.tokensIn += event.tokensIn;
  bucket.tokensOut += event.tokensOut;
}

function startOfLocalDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
