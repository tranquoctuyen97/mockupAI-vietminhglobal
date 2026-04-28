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
      store: { include: { colors: true, template: true } },
    },
  });

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  // Pre-requisite checks
  if (!draft.design) {
    return NextResponse.json({ error: "Design not selected" }, { status: 400 });
  }

  // Cast JsonValue to structured fallback
  const colors = draft.store?.colors?.filter((c: any) => draft.enabledColorIds.includes(c.id)).map((c: any) => c.name) || [];
  const placementObj = (draft.placementOverride as { position?: string }) || {};
  const productType = draft.store?.template?.blueprintTitle || draft.store?.name || "T-Shirt";

  const input = {
    designName: draft.design.name,
    productType,
    colors: colors.length > 0 ? colors : ["Default"],
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


