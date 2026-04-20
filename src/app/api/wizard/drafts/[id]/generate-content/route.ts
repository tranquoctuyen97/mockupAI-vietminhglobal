import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getAiProvider } from "@/lib/ai/factory";
import { generateCacheKey, getCachedContent, saveToCache } from "@/lib/ai/cache";
import { parseAIError } from "@/lib/ai/errors";
import { withRetry } from "@/lib/ai/retry";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId } = await params;

  // Validate draft & user permissions
  const draft = await prisma.wizardDraft.findFirst({
    where: {
      id: draftId,
      tenantId: session.tenantId,
    },
    include: {
      design: true,
    },
  });

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  // Pre-requisite checks
  if (!draft.design) {
    return NextResponse.json({ error: "Design not selected" }, { status: 400 });
  }
  if (!draft.productType) {
    return NextResponse.json({ error: "Product type not selected" }, { status: 400 });
  }

  // Cast JsonValue to structured fallback
  const colors = (draft.selectedColors as Array<{ title: string }>) || [];
  const colorNames = colors.map((c) => c.title);
  const placementObj = (draft.placement as { position?: string }) || {};

  const input = {
    designName: draft.design.name,
    productType: draft.productType,
    colors: colorNames.length > 0 ? colorNames : ["Default"],
    placement: placementObj.position || "Front",
  };

  try {
    const { generator, config } = await getAiProvider(session.tenantId);

    // Check cache
    const cacheKey = generateCacheKey(input, config.provider, config.model, config.promptVersion);
    const cached = await getCachedContent(cacheKey);

    if (cached) {
      await prisma.wizardDraft.update({
        where: { id: draftId },
        data: { aiContent: cached as any },
      });
      return NextResponse.json({ content: cached, cached: true });
    }

    // Call provider with retry (handles 503, 502, 500 transiently)
    const result = await withRetry(() => generator.generate(input), { maxAttempts: 3 });

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

    return NextResponse.json({ content: result, cached: false });
  } catch (error) {
    console.error("[Wizard] AI Content Generation Error:", error);

    // Parse into user-friendly error — NEVER expose raw error.message or JSON
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


