import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getAiProvider } from "@/lib/ai/factory";
import { generateCacheKey, getCachedContent, saveToCache } from "@/lib/ai/cache";

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
      // Update draft with cached DB info
      await prisma.wizardDraft.update({
        where: { id: draftId },
        data: { aiContent: cached as any },
      });

      return NextResponse.json({
        content: cached,
        cached: true,
      });
    }

    // Call Provider
    const result = await generator.generate(input);

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

    return NextResponse.json({
      content: result,
      cached: false,
    });
  } catch (error) {
    console.error("[Wizard] AI Content Generation Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate content" },
      { status: 500 },
    );
  }
}
