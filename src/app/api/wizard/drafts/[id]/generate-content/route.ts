import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getAiProvider } from "@/lib/ai/factory";
import { generateCacheKey, getCachedContent, saveToCache } from "@/lib/ai/cache";
import { parseAIError } from "@/lib/ai/errors";
import { withRetry } from "@/lib/ai/retry";
import { recordAiUsageEvent } from "@/lib/ai/usage";
import { normalizeOrganizationCollections } from "@/lib/wizard/product-organization";
import { getIndependentDraftDesigns, getPairedDraftDesignIds } from "@/lib/wizard/publish-units";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId } = await params;
  const body = await request.json().catch(() => ({}));
  const requestedPairId =
    typeof body.pairId === "string" && body.pairId.trim() ? body.pairId.trim() : null;
  const requestedDesignId =
    typeof body.designId === "string" && body.designId.trim() ? body.designId.trim() : null;

  if (requestedPairId && requestedDesignId) {
    return NextResponse.json({ error: "Choose either pairId or designId" }, { status: 400 });
  }

  // Validate draft & user permissions
  const draft = await prisma.wizardDraft.findFirst({
    where: {
      id: draftId,
      tenantId: session.tenantId,
    },
    include: {
      design: true,
      draftDesigns: {
        orderBy: { sortOrder: "asc" },
        include: {
          design: true,
        },
      },
      designPairs: {
        orderBy: { sortOrder: "asc" },
        include: {
          lightDesign: { include: { design: true } },
          darkDesign: { include: { design: true } },
        },
      },
      store: { include: { colors: true } },
      template: true,
    },
  });

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  // Pre-requisite checks
  const primaryDesign = draft.draftDesigns[0]?.design ?? draft.design;

  if (!primaryDesign) {
    return NextResponse.json({ error: "Design not selected" }, { status: 400 });
  }

  // Cast JsonValue to structured fallback
  const colors =
    draft.store?.colors
      ?.filter((c: any) => (draft.enabledColorIds ?? []).includes(c.id))
      .map((c: any) => c.name) || [];
  const placementObj = (draft.placementOverride as { position?: string }) || {};
  const productType = draft.template?.blueprintTitle || draft.store?.name || "T-Shirt";
  const pairedDraftDesignIds = getPairedDraftDesignIds(draft.designPairs);
  const independentDraftDesigns = getIndependentDraftDesigns(draft.draftDesigns, draft.designPairs);

  if (requestedDesignId && pairedDraftDesignIds.has(requestedDesignId)) {
    return NextResponse.json(
      { error: "Design belongs to a pair. Generate content by pairId instead." },
      { status: 400 },
    );
  }

  const targetPairs = requestedPairId
    ? draft.designPairs.filter((pair) => pair.id === requestedPairId)
    : requestedDesignId
      ? []
      : draft.designPairs;
  const targetIndependentDesigns = requestedDesignId
    ? independentDraftDesigns.filter((draftDesign) => draftDesign.id === requestedDesignId)
    : requestedPairId
      ? []
      : independentDraftDesigns;

  if (requestedPairId && targetPairs.length === 0) {
    return NextResponse.json({ error: "Design pair not found" }, { status: 404 });
  }
  if (requestedDesignId && targetIndependentDesigns.length === 0) {
    return NextResponse.json({ error: "Draft design not found" }, { status: 404 });
  }
  if (targetPairs.length === 0 && targetIndependentDesigns.length === 0) {
    return NextResponse.json({ error: "Design not selected" }, { status: 400 });
  }

  let usageContext: { provider: string; model: string } | null = null;

  try {
    const { generator, config } = await getAiProvider(session.tenantId);
    usageContext = { provider: config.provider, model: config.model };

    const generateForInput = async (input: {
      designName: string;
      productType: string;
      colors: string[];
      placement: string;
    }) => {
      const cacheKey = generateCacheKey(input, config.provider, config.model, config.systemPrompt);
      const cached = await getCachedContent(cacheKey);
      const content = cached
        ? cached
        : await Promise.race([
            withRetry(() => generator.generate(input), { maxAttempts: 2 }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("AI provider timeout (45s)")), 45_000),
            ),
          ]);

      if (!cached) {
        await saveToCache(cacheKey, content, config.provider, config.model);
      }

      const aiContent = {
        title: content.title,
        description: content.description,
        tags: content.tags,
        collections: normalizeOrganizationCollections((content as any).collections ?? []),
        altText: content.altText,
      };

      await recordAiUsageEvent({
        tenantId: session.tenantId,
        provider: config.provider,
        model: config.model,
        draftId,
        status: "success",
        cacheHit: Boolean(cached),
        tokensIn: cached ? undefined : content.tokensIn,
        tokensOut: cached ? undefined : content.tokensOut,
      });

      return { aiContent, cached: Boolean(cached) };
    };

    const pairResults = await runWithConcurrency(targetPairs, 3, async (pair) => {
      const { aiContent, cached } = await generateForInput({
        designName: `${pair.baseName} | Light: ${pair.lightDesign.design.name} | Dark: ${pair.darkDesign.design.name}`,
        productType,
        colors: colors.length > 0 ? colors : ["Default"],
        placement: placementObj.position || "Front",
      });

      await prisma.wizardDraftDesignPair.update({
        where: { id: pair.id },
        data: { aiContent },
      });

      return { id: pair.id, content: aiContent, cached };
    });

    const designResults = await runWithConcurrency(
      targetIndependentDesigns,
      3,
      async (draftDesign) => {
        const { aiContent, cached } = await generateForInput({
          designName: draftDesign.design.name,
          productType,
          colors: colors.length > 0 ? colors : ["Default"],
          placement: placementObj.position || "Front",
        });

        await prisma.wizardDraftDesign.update({
          where: { id: draftDesign.id },
          data: { aiContent },
        });

        return { id: draftDesign.id, content: aiContent, cached };
      },
    );

    return NextResponse.json({
      pairs: pairResults,
      designs: designResults,
      content: pairResults[0]?.content ?? designResults[0]?.content ?? null,
      cached: [...pairResults, ...designResults].every((entry) => entry.cached),
    });
  } catch (error) {
    console.error("[Wizard] AI Content Generation Error:", error);

    // Parse into user-friendly error — NEVER expose raw error.message or JSON
    const parsed = parseAIError(error);
    if (usageContext) {
      await recordAiUsageEvent({
        tenantId: session.tenantId,
        provider: usageContext.provider,
        model: usageContext.model,
        draftId,
        status: "failed",
        errorCode: parsed.code,
      });
    }
    return NextResponse.json(
      {
        error: parsed.code,
        message: parsed.userMessage,
        retryable: parsed.retryable,
        ...(parsed.supportHint ? { supportHint: parsed.supportHint } : {}),
      },
      { status: parsed.retryable ? 503 : 500 },
    );
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= items.length) return;
    results[index] = await worker(items[index]);
    await runNext();
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()),
  );
  return results;
}
