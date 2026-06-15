import { NextResponse } from "next/server";
import { parseAIError } from "@/lib/ai/errors";
import { getAiProvider } from "@/lib/ai/factory";
import type { ProductOrganizationInput, ProductOrganizationOptimizer } from "@/lib/ai/types";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { normalizeProductType } from "@/lib/publish/shopify";
import { normalizeOrganizationCollections } from "@/lib/wizard/product-organization";

type RequestBody = {
  title?: string;
  descriptionHtml?: string;
  productType?: string;
  canonicalProductType?: string | null;
  currentTags?: unknown[];
  currentCollections?: unknown[];
  selectedColors?: unknown[];
  designContext?: string | null;
  niche?: string | null;
};

function isOrganizationOptimizer(value: unknown): value is ProductOrganizationOptimizer {
  return Boolean(
    value &&
      typeof value === "object" &&
      "optimizeProductOrganization" in value &&
      typeof (value as ProductOrganizationOptimizer).optimizeProductOrganization === "function",
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId } = await params;
  const body = (await request.json().catch(() => ({}))) as RequestBody;

  const draft = await prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId: session.tenantId },
    include: {
      design: true,
      draftDesigns: {
        orderBy: { sortOrder: "asc" },
        include: { design: true },
      },
      store: { include: { colors: true } },
      template: true,
    },
  });

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  const aiContent = (draft.aiContent ?? {}) as {
    title?: string;
    description?: string;
    tags?: string[];
    collections?: string[];
  };
  const productType = draft.template?.blueprintTitle || body.productType || "T-Shirt";
  const canonicalProductType = body.canonicalProductType ?? normalizeProductType(productType);
  const selectedColors =
    draft.store?.colors
      ?.filter((color) => (draft.enabledColorIds ?? []).includes(color.id))
      .map((color) => color.name) ?? [];
  const primaryDesign = draft.draftDesigns[0]?.design ?? draft.design;

  const input: ProductOrganizationInput = {
    title: body.title ?? aiContent.title ?? "",
    descriptionHtml: body.descriptionHtml ?? aiContent.description ?? "",
    productType,
    canonicalProductType,
    currentTags: Array.isArray(body.currentTags)
      ? body.currentTags.map((tag) => String(tag ?? "").trim()).filter(Boolean)
      : aiContent.tags ?? [],
    currentCollections: normalizeOrganizationCollections(
      Array.isArray(body.currentCollections) ? body.currentCollections : aiContent.collections ?? [],
    ),
    selectedColors:
      selectedColors.length > 0
        ? selectedColors
        : Array.isArray(body.selectedColors)
          ? body.selectedColors.map((color) => String(color ?? "").trim()).filter(Boolean)
          : [],
    designContext: body.designContext ?? primaryDesign?.name ?? null,
    niche: body.niche ?? null,
  };

  try {
    const { generator } = await getAiProvider(session.tenantId);
    if (!isOrganizationOptimizer(generator)) {
      return NextResponse.json(
        { error: "optimizer_unavailable", message: "AI provider không hỗ trợ tối ưu organization." },
        { status: 500 },
      );
    }

    const result = await generator.optimizeProductOrganization(input);
    return NextResponse.json({ tags: result.tags, collections: result.collections });
  } catch (error) {
    const parsed = parseAIError(error);
    return NextResponse.json(
      { error: parsed.code, message: parsed.userMessage, retryable: parsed.retryable },
      { status: parsed.retryable ? 503 : 500 },
    );
  }
}
