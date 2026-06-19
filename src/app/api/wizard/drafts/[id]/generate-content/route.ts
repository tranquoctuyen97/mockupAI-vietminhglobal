import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getAiProvider } from "@/lib/ai/factory";
import { generateCacheKey, getCachedContent, saveToCache } from "@/lib/ai/cache";
import { parseAIError } from "@/lib/ai/errors";
import { withRetry } from "@/lib/ai/retry";
import { recordAiUsageEvent } from "@/lib/ai/usage";
import { normalizeOrganizationCollections } from "@/lib/wizard/product-organization";

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

  if (draft.designPairs.length > 0) {
    const targetPairs = requestedPairId
      ? draft.designPairs.filter((pair) => pair.id === requestedPairId)
      : draft.designPairs;

    if (targetPairs.length === 0) {
      return NextResponse.json({ error: "Design pair not found" }, { status: 404 });
    }

    try {
      const { generator, config } = await getAiProvider(session.tenantId);
      const generatedPairs = await runWithConcurrency(targetPairs, 3, async (pair) => {
        const input = {
          designName: `${pair.baseName} | Light: ${pair.lightDesign.design.name} | Dark: ${pair.darkDesign.design.name}`,
          productType,
          colors: colors.length > 0 ? colors : ["Default"],
          placement: placementObj.position || "Front",
        };
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

        await prisma.wizardDraftDesignPair.update({
          where: { id: pair.id },
          data: { aiContent },
        });
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

        return { id: pair.id, content: aiContent, cached: Boolean(cached) };
      });

      return NextResponse.json({
        pairs: generatedPairs,
        content: generatedPairs[0]?.content ?? null,
        cached: generatedPairs.every((pair) => pair.cached),
      });
    } catch (error) {
      console.error("[Wizard] Pair AI Content Generation Error:", error);
      const parsed = parseAIError(error);
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

  const input = {
    designName: primaryDesign.name,
    productType,
    colors: colors.length > 0 ? colors : ["Default"],
    placement: placementObj.position || "Front",
  };

  let usageContext: { provider: string; model: string } | null = null;

  try {
    const { generator, config } = await getAiProvider(session.tenantId);
    usageContext = { provider: config.provider, model: config.model };
    // Check cache
    const cacheKey = generateCacheKey(input, config.provider, config.model, config.systemPrompt);
    const cached = await getCachedContent(cacheKey);

    if (cached) {
      await prisma.wizardDraft.update({
        where: { id: draftId },
        data: { aiContent: cached as any },
      });
      await recordAiUsageEvent({
        tenantId: session.tenantId,
        provider: config.provider,
        model: config.model,
        draftId,
        status: "success",
        cacheHit: true,
      });
      return NextResponse.json({ content: cached, cached: true });
    }

    // Call provider with retry + overall timeout cap
    const GENERATE_TIMEOUT_MS = 45_000;
    const result = await Promise.race([
      withRetry(() => generator.generate(input), { maxAttempts: 2 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("AI provider timeout (45s)")), GENERATE_TIMEOUT_MS),
      ),
    ]);

    // Save to Cache
    await saveToCache(cacheKey, result, config.provider, config.model);

    // Update draft
    const aiContent = {
      title: result.title,
      description: result.description,
      tags: result.tags,
      altText: result.altText,
    };

    await prisma.wizardDraft.update({
      where: { id: draftId },
      data: { aiContent },
    });
    await recordAiUsageEvent({
      tenantId: session.tenantId,
      provider: config.provider,
      model: config.model,
      draftId,
      status: "success",
      cacheHit: false,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });

    return NextResponse.json({ content: result, cached: false });
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
